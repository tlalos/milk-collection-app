import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalCandidates, approvalReviewReason } from './monthlyAvizPricingService.js'

const refs = { centers: [{code:'c1',name:'Single center'}], producers:[{producerCode:'p1',producerName:'Producer',centerCode:'c1'}] }
function group() { return {id:'aug',month:'2026-08',center:'Single center',milkType:'MILK-COW',monthlyRowCount:0,monthlyRows:[],
  avizRows:[{jobId:'j1',rowNumber:1,centerCode:'c1',documentDate:'2026-08-01',liters:100,noticeNumber:'001'}]} }

test('single ERP producer is eligible by center code without fuzzy name matching',()=>{
 const row=group()
 const result=approvalCandidates([row],refs)[0]
 assert.equal(result.producerCode,'p1'); assert.equal(result.approvedLiters,100)
 row.center='OCR spelling'
 assert.match(approvalCandidates([row],refs)[0].reason,/correct ERP center/)
 row.avizRows[0].centerCode=null
 assert.match(approvalCandidates([row],refs)[0].reason,/unique ERP center/)
})
test('unmatched or conflicting aviz names cannot be approved',()=>{
 const row=group(); row.avizRows[0].centerName='OSORHEL'
 assert.ok(approvalCandidates([row],refs)[0].reason)
 delete row.avizRows[0].centerName
 row.avizRows[0].centerCode=null
 assert.ok(approvalCandidates([row],refs)[0].reason)
})
test('missing reference data or multiple producers blocks approval',()=>{
 assert.ok(approvalCandidates([group()],null)[0].reason)
 assert.ok(approvalCandidates([group()],{...refs,producers:[...refs.producers,{producerCode:'p2',centerCode:'c1'}]})[0].reason)
})
test('journal on same center or producer elsewhere blocks approval',()=>{
 const row=group(); row.monthlyRowCount=1
 assert.ok(approvalCandidates([row],refs)[0].reason)
 const other={...group(),id:'other',center:'Other',avizRows:[],monthlyRowCount:1,monthlyRows:[{producerCode:'p1'}]}
 assert.ok(approvalCandidates([group(),other],refs)[0].reason)
})
test('changed quantities, new journal, missing aviz, and changed ERP producer require review',()=>{
 const approval=approvalCandidates([group()],refs)[0]
 assert.equal(approvalReviewReason(approval,[approval]),null)
 const row=group();row.avizRows[0].liters=101
 assert.ok(approvalReviewReason(approval,approvalCandidates([row],refs)))
 row.monthlyRowCount=1
 assert.ok(approvalReviewReason(approval,approvalCandidates([row],refs)))
 assert.ok(approvalReviewReason(approval,[]))
 assert.ok(approvalReviewReason(approval,approvalCandidates([group()],{...refs,producers:[{...refs.producers[0],producerCode:'p2'}]})))
})
test('split aliases and mixed center codes do not silently approve partial totals',()=>{
 const row=group();const other={...group(),id:'alias',center:'Alias'}
 assert.ok(approvalCandidates([row,other],refs).every(c=>c.reason))
 row.avizRows.push({...row.avizRows[0],jobId:'j2',centerCode:'c2'})
 assert.ok(approvalCandidates([row],refs)[0].reason)
})
