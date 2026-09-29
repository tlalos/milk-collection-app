import test from 'node:test'
import assert from 'node:assert/strict'
import { journalAvizIssues } from './journalAvizIssues.js'
const group = {id:'cow', month:'2026-08',center:'SUCIU DE JOS',milkType:'MILK-COW',monthlyRowCount:0,avizLineCount:3,monthlyLiters:0,avizLiters:2656}
test('flags both unmatched sides and identifies other milk types in the same month', () => {
 const issues = journalAvizIssues([group,{...group,id:'buff',milkType:'MILK-BUFF',monthlyRowCount:6,avizLineCount:0,monthlyLiters:1376}],[],()=>null)
 assert.equal(issues.length,2)
 assert.match(issues[0].problem,/MILK-BUFF/)
 assert.match(issues[1].problem,/MILK-COW/)
})
test('matched groups do not warn and other months are not suggested', () => {
 const issues = journalAvizIssues([group,{...group,id:'next',month:'2026-09',milkType:'MILK-BUFF',monthlyRowCount:1}],[],()=>null)
 assert.equal(issues.length,1)
 assert.doesNotMatch(issues[0].problem,/MILK-BUFF/)
})
test('header conflicts warn without changing journal data', () => {
 const job={id:'j1',documentCategory:'journal_monthly_settlement',data:{headerCenterName:'SUCIU DE JOS 1'},headerCenterMatch:{selectedName:'SUCIU DE JOS',selectedCode:'c1'}}
 const issues=journalAvizIssues([], [job], ()=>'2026-08')
 assert.equal(issues[0].type,'journal_header_center_conflict')
 assert.equal(job.data.headerCenterName,'SUCIU DE JOS 1')
})
