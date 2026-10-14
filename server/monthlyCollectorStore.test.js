import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { isCollectorName, collectorReference, collectorPricingRows } from './monthlyCollectorStore.js'
import { buildInvoicePreview } from './monthlyInvoiceSend.js'

const reference = { producerCode:'p515', producerName:'BIZO MARIANA (colector)', centerName:'Example center' }
const supplier = { sup_code:'p515', sup_name:reference.producerName, sup_id:515, sup_bool01:0, sup_bool02:0, sup_payment:3030, sup_vatstatus_name:'Is exempted' }
const collector = { ...collectorPricingRows([{...reference,monthKey:'2026-08'}],{producers:[reference]})[0], readyForPricing:true, price:0.1, commission:300, electricity:100 }
const preview = (row=collector, producer=supplier) => buildInvoicePreview(row,producer,'2026-08-31','zg-test')

test('collector names match ERP spelling and exact codes, with a collection center', () => {
  for(const name of ['BIZO (colector)','TEST COLLECTOR','test Colector']) assert.ok(isCollectorName(name))
  for(const name of ['TEST PRODUCER','NONCOLLECTOR','COLLECTORS','']) assert.equal(isCollectorName(name),false)
  assert.equal(collectorReference([reference],'P515'),reference)
  assert.throws(()=>collectorReference([reference,reference],'p515'),/Choose/)
  assert.throws(()=>collectorReference([{...reference,producerName:'Ordinary producer'}],'p515'),/Choose/)
  assert.throws(()=>collectorReference([{...reference,centerName:''}],'p515'),/center/)
  assert.ok(collectorPricingRows([{...reference,monthKey:'2026-08'}],{producers:[]})[0].producerWarning)
})

test('collector payment uses one ERP unit without creating milk liters', () => {
  const result=preview()
  assert.equal(result.payload[0].qty1,1)
  assert.equal(result.payload[0].item_code,'MF0010')
  assert.equal(result.payload[0].price,400)
  assert.equal(result.snapshot.liters,0)
  assert.equal(result.snapshot.invoiceQuantity,1)
  assert.equal(result.snapshot.subtotal,400)
  assert.equal(result.snapshot.total,400)
  assert.equal(preview({...collector,price:null}).snapshot.total,400)
  assert.equal(preview({...collector,price:9999}).snapshot.total,400)
  assert.equal(preview(collector,{...supplier,sup_bool01:1}).snapshot.total,432)
  assert.equal(preview(collector,{...supplier,sup_vatstatus_name:'Regular'}).snapshot.total,444)
})

test('invalid collector payments and ordinary zero-liter invoices remain blocked', () => {
  for(const change of [{liters:1},{milkType:'MILK-SHEEP'},{commission:0,electricity:0},{commission:-1},{producerWarning:'Mismatch'},{source:'journal'},{readyForPricing:false}]) assert.throws(()=>preview({...collector,...change}))
  assert.throws(()=>preview(collector,{...supplier,sup_name:'Ordinary producer'}))
})

test('browser collector amounts agree with server including rounding and tax', async () => {
  const source=await readFile(new URL('../src/monthlyInvoiceAmounts.ts',import.meta.url),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
  const {monthlyInvoiceAmounts}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  for(const [commission,electricity,extra,regular] of [[300,100,false,false],[15.1234,23.4567,true,false],[1.005,0,false,true]]) {
    const front=monthlyInvoiceAmounts(0,0.1,commission,electricity,extra,regular,true)
    const back=preview({...collector,commission,electricity},{...supplier,sup_bool01:extra?1:0,sup_vatstatus_name:regular?'Regular':'Is exempted'})
    assert.equal(front.result,back.snapshot.subtotal)
    assert.equal(front.finalResult,back.snapshot.total)
  }
  assert.ok(monthlyInvoiceAmounts(0,0.1,300,100,false,false).blockReason)
  assert.ok(monthlyInvoiceAmounts(0,0.1,0,0,false,false,true).blockReason)
})
