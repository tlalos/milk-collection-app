import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validateBankExportInput, buildBankExportSnapshot } from './bankExportSnapshot.js'

const source = { id:'2026-09|p1|MILK-COW', month:'2026-09', producerCode:'p1', producer:'Ana', center:'Valea Lunga', liters:100, price:1.5, commission:10, electricity:0, milkType:'MILK-COW', source:'journal' }
const producers = [{ producerCode:'p1',producerName:'Ana Pop',iban:'RO1',vatStatusName:'Regular',extra:'0' }, { producerCode:'p2',producerName:'Recipient',iban:'RO2' }]
const input = () => ({ month:'2026-09', requestKey:randomUUID(), rows:[{ id:source.id, recipientCode:'p2',recipientName:'Recipient',iban:'RO2',comment:'Lapte septembrie 2026 - Ana',amount:177.6,totalLiters:100,centers:['Wrong center'],producerName:'Wrong producer' }] })
test('snapshot uses authoritative center, original producer, connected recipient and shared invoice calculation', () => {
  const request=input(); validateBankExportInput(request)
  const [row]=buildBankExportSnapshot(request,[source],producers)
  assert.deepEqual(row.centers,['Valea Lunga']); assert.equal(row.producerName,'Ana Pop'); assert.equal(row.recipientCode,'p2'); assert.equal(row.iban,'RO2')
  assert.equal(row.amount,177.6); assert.equal(row.milkType,'COW'); assert.equal(row.comment,request.rows[0].comment)
})
test('rejects changed amounts, liters, bank account, absent rows, and blocked approval', () => {
  for(const patch of [{amount:10},{totalLiters:999},{iban:'changed'},{recipientCode:'missing'}]) {
    const request=input();Object.assign(request.rows[0],patch)
    assert.throws(()=>buildBankExportSnapshot(request,[source],producers))
  }
  assert.throws(()=>buildBankExportSnapshot(input(),[],producers))
  assert.throws(()=>buildBankExportSnapshot(input(),[{...source,approvalReviewRequired:true}],producers))
})
test('validates month, idempotency key, nonempty unique selection and positive finite amount', () => {
  for(const patch of [{month:'2026-13'},{requestKey:'no'},{rows:[]},{rows:[...input().rows,...input().rows]}]) assert.throws(()=>validateBankExportInput({...input(),...patch}))
  for(const patch of [{amount:0},{amount:-1},{amount:NaN},{amount:null},{recipientName:null},{comment:'a'.repeat(71)},{totalLiters:-1}]) {
    const request=input();Object.assign(request.rows[0],patch);assert.throws(()=>validateBankExportInput(request))
  }
})
