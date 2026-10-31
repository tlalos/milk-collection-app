import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || undefined})
await mkdir('work/bank-export-history',{recursive:true})
const batches=[88852.30,45341.25,42135.04,58395.61,51673.17,55668.28].map((totalAmount,index)=>({batchId:`batch-${index}`,month:'2026-09',exportNumber:6-index,totalAmount,paymentCount:[57,23,32,48,36,52][index],status:index===5?'CANCELLED':'EXPORTED',createdAt:'2026-10-31T10:00:00Z',createdBy:'audit-user',currency:'RON',lines:[]}))
try {
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'})
    await context.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname
      if(!path.startsWith('/api/')) return route.continue()
      if(path==='/api/auth/session') return route.fulfill({json:{user:{username:'test',isAdmin:true}}})
      if(path==='/api/bank-exports') return route.fulfill({json:{batches,payments:[]}})
      if(path.startsWith('/api/bank-exports/')) return route.fulfill({json:batches[0]})
      return route.fulfill({json:{rows:[],selectedMonth:'2026-09',monthOptions:['2026-09'],invoices:[],producers:[],centers:[]}})
    })
    const page=await context.newPage()
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/bank-note?month=2026-09`)
    await page.getByRole('button',{name:'Export history',exact:true}).click()
    const dialog=page.locator('.bank-history-dialog')
    await dialog.getByRole('button',{name:'Export 6',exact:true}).waitFor()
    assert.deepEqual(await dialog.locator('th').allTextContents(),['Export','Payments','Total (RON)','Status'])
    assert.equal(await dialog.locator('tbody tr').count(),6)
    assert.equal((await dialog.innerText()).includes('audit-user'),false)
    const layout=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,inView:el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth,overflow:el.querySelector('.bank-history-table').scrollWidth>el.querySelector('.bank-history-table').clientWidth,cells:[...el.querySelectorAll('th,td')].map(cell=>getComputedStyle(cell).textAlign)}))
    assert.ok(layout.width<=722);assert.ok(layout.inView);assert.equal(layout.overflow,false);assert.ok(layout.cells.every(value=>value==='center'))
    await page.screenshot({path:`work/bank-export-history/compact-list-${width}.png`})
    await dialog.getByRole('button',{name:'Export 6',exact:true}).click()
    await dialog.getByRole('heading',{name:'Export 6 / 2026-09'}).waitFor()
    await dialog.getByRole('button',{name:'Back to exports'}).click()
    await dialog.getByRole('button',{name:'Export 6',exact:true}).waitFor()
    assert.deepEqual(errors,[])
    await context.close()
    console.log(`Compact bank history layout passed at ${width}px`)
  }
} finally {await browser.close()}
