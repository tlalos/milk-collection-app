import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/bank-export-history',{recursive:true})
const month='2026-09'
const rows=['Valea Lunga','Sighisoara'].map((center,index)=>({id:`row-${index}`,month,center,producer:`Producer ${index}`,producerCode:`p${index}`,milkType:'MILK-COW',liters:100+index,price:1.5,commission:0,electricity:0,readyForPricing:true,pricingStatus:'saved',source:'journal',reconciliationStatus:'ok',sourceRowCount:1}))
const producers=rows.map(row=>({producerCode:row.producerCode,producerName:row.producer,iban:`RO123${row.producerCode}`,vatStatusName:'Is exempted',paymentTerms:'3030',centerName:row.center}))
try {
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'})
    let batches=[], failDownload=true, failHistory=false
    const posts=[], errors=[]
    await context.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname
      if(!path.startsWith('/api/')) return route.continue()
      if(path==='/api/auth/session') return route.fulfill({json:{user:{username:'test',isAdmin:true}}})
      if(path==='/api/month-closure/pricing-rows') return route.fulfill({json:{rows,selectedMonth:month,monthOptions:[month],summary:{},journalProducers:[],receptionFactors:[]}})
      if(path==='/api/bank-exports' && request.method()==='POST') {
        const input=request.postDataJSON();posts.push(input)
        let batch=batches.find(batch=>batch.requestKey===input.requestKey)
        if(!batch) {
          batch={batchId:randomUUID(),requestKey:input.requestKey,month:input.month,exportNumber:batches.length+1,createdAt:'2026-10-31T10:00:00Z',createdBy:'test',status:'EXPORTED',paymentCount:input.rows.length,totalAmount:input.rows.reduce((sum,row)=>sum+row.amount,0),totalLiters:input.rows.reduce((sum,row)=>sum+row.totalLiters,0),currency:'RON',filename:'test-bank.xlsx',lines:input.rows.map((row,index)=>({...row,lineNumber:index+1}))}
          batches.push(batch)
        }
        return route.fulfill({status:201,json:batch})
      }
      if(path==='/api/bank-exports') {
        if(failHistory) return route.fulfill({status:503,json:{error:'Test unavailable'}})
        const found=batches.filter(batch=>batch.month===url.searchParams.get('month'))
        return route.fulfill({json:{batches:found,payments:found.filter(batch=>batch.status==='EXPORTED').flatMap(batch=>batch.lines.map(row=>({...row,batchId:batch.batchId,exportNumber:batch.exportNumber,createdAt:batch.createdAt})))}})
      }
      if(path.startsWith('/api/bank-exports/')) {
        const batch=batches.find(batch=>path.includes(batch.batchId))
        assert.ok(batch)
        if(path.endsWith('/file')) {
          if(failDownload) {failDownload=false;return route.fulfill({status:500,json:{error:'Test download failed'}})}
          return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:'test-file-bytes'})
        }
        if(path.endsWith('/cancel')) Object.assign(batch,{status:'CANCELLED',cancelledBy:'test',cancelledAt:'2026-10-31T11:00:00Z',cancelReason:request.postDataJSON().reason})
        return route.fulfill({json:batch})
      }
      return route.fulfill({json:{invoices:[],producers,centers:[],fetchedAt:new Date().toISOString()}})
    })
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/bank-note?month=${month}`)
    const select=page.getByLabel('Select all eligible bank rows on this page')
    await select.check()
    await page.getByRole('button',{name:/Export Excel \(/}).click()
    const review=page.getByRole('dialog',{name:'Review bank export'})
    await review.getByText('Valea Lunga',{exact:true}).waitFor()
    await review.getByRole('button',{name:'Export Excel',exact:true}).click()
    await review.getByRole('alert').filter({hasText:'download failed'}).waitFor()
    assert.equal(batches.length,1)
    const download=page.waitForEvent('download')
    await review.getByRole('button',{name:'Download saved export'}).click()
    assert.equal((await download).suggestedFilename(),'test-bank.xlsx')
    assert.equal(posts.length,1)
    await page.reload()
    await page.getByRole('button',{name:'Export 1',exact:true}).first().waitFor()
    assert.equal(await select.isDisabled(),true)
    await page.getByRole('button',{name:'Export history',exact:true}).click()
    const history=page.locator('.bank-history-dialog')
    await history.getByRole('button',{name:'Export 1',exact:true}).click()
    await history.getByRole('columnheader',{name:'Center',exact:true}).waitFor()
    assert.equal(await history.locator('tbody tr').count(),2)
    await history.getByLabel('Center',{exact:true}).selectOption('Valea Lunga')
    assert.equal(await history.locator('tbody tr').count(),1)
    await history.getByLabel('Center',{exact:true}).selectOption('')
    await history.getByLabel('Search',{exact:true}).fill('Producer 1')
    assert.equal(await history.locator('tbody tr').count(),1)
    await history.getByLabel('Search',{exact:true}).fill('')
    assert.equal(await history.evaluate(el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth),true)
    await page.screenshot({path:`work/bank-export-history/detail-${width}.png`})
    await history.getByRole('button',{name:'Cancel export',exact:true}).click()
    await history.getByLabel('Cancellation reason').fill('Not sent to bank')
    assert.equal(await history.getByRole('button',{name:'Confirm cancellation'}).isDisabled(),true)
    await history.getByRole('checkbox').check()
    await history.getByRole('button',{name:'Confirm cancellation'}).click()
    await history.getByText(/Cancelled by test/).waitFor()
    await history.getByRole('button',{name:'Close export history'}).click()
    await select.check()
    await page.reload()
    await page.getByRole('button',{name:'Export history',exact:true}).click()
    await history.getByText('Cancelled',{exact:true}).waitFor()
    await history.getByRole('button',{name:'Export 1',exact:true}).click()
    await history.getByRole('columnheader',{name:'Center',exact:true}).waitFor()
    assert.equal(await history.locator('tbody tr').count(),2)
    await history.getByRole('button',{name:'Close export history'}).click()
    const secondTab=await context.newPage()
    await secondTab.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/bank-note?month=${month}`)
    await secondTab.getByLabel('Bank comment for Producer 1').waitFor()
    const legacy=JSON.stringify({[month]:{p0:{status:'sent',exportedAmount:150,exportedLiters:100}}})
    await page.evaluate(value=>localStorage.setItem('milk-collection-bank-note-v1',value),legacy)
    await secondTab.getByText('Legacy export (this browser)',{exact:true}).waitFor()
    await secondTab.getByLabel('Bank comment for Producer 1').fill('Second tab comment')
    assert.equal(await page.evaluate(()=>localStorage.getItem('milk-collection-bank-note-v1')),legacy)
    await page.waitForFunction(()=>document.querySelector('[aria-label="Bank comment for Producer 1"]')?.value==='Second tab comment')
    await page.reload()
    await page.getByText('Legacy export (this browser)',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('Select bank payment for Producer 0').isDisabled(),true)
    await secondTab.close()
    failHistory=true
    await page.reload()
    await page.getByRole('alert').filter({hasText:'Export history unavailable'}).waitFor()
    assert.equal(await select.isDisabled(),true)
    assert.deepEqual(errors,[])
    await context.close()
    console.log(`Bank history ${width}px passed: save, file retry, centers, search, cancellation, persistence, failure protection`)
  }
} finally { await browser.close() }
