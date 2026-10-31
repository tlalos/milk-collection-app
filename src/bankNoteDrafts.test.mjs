import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({entryPoints:['src/bankNoteDrafts.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const { loadBankNoteDrafts, saveBankNoteField, resolveBankNoteDraft, bankNoteStorageKey, isBankNoteStorageKey } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
function storage() {
  const data = new Map()
  return { get length() {return data.size},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)) }
}
test('a stale tab editing another producer cannot erase a September export marker or another month',()=>{
  const s=storage()
  loadBankNoteDrafts(s,'2026-09') // tab B loads before tab A exports
  const original=JSON.stringify({'2026-09':{p1:{status:'sent',exportedAmount:150,exportedLiters:100}},'2026-08':{p2:{status:'sent'}}})
  s.setItem(bankNoteStorageKey,original)
  const after=saveBankNoteField(s,'2026-09','p2','comment','Another payment')
  assert.equal(after.p1.status,'sent');assert.equal(after.p2.comment,'Another payment')
  assert.equal(s.getItem(bankNoteStorageKey),original)
  assert.equal(loadBankNoteDrafts(s,'2026-08').p2.status,'sent')
})
test('independent edits across tabs preserve other rows, fields, and deliberately empty comments',()=>{
  const s=storage()
  saveBankNoteField(s,'2026-09','row1','comment','A')
  saveBankNoteField(s,'2026-09','row1','connectedAccount','B')
  saveBankNoteField(s,'2026-09','row2','comment','C')
  saveBankNoteField(s,'2026-09','row1','comment','')
  assert.deepEqual({...loadBankNoteDrafts(s,'2026-09')},{row1:{comment:'',connectedAccount:'B'},row2:{comment:'C'}})
  assert.equal(s.getItem(bankNoteStorageKey),null)
})
test('row comment cannot hide producer-level sent evidence; grouped milk payments remain ambiguous',()=>{
  const drafts={p1:{status:'sent',exportedAmount:150,exportedLiters:100},row1:{comment:'Changed comment'}}
  assert.equal(resolveBankNoteDraft(drafts,'row1','P1',false).status,'sent')
  assert.equal(resolveBankNoteDraft(drafts,'row1','P1',false).comment,'Changed comment')
  assert.equal(resolveBankNoteDraft(drafts,'row1','P1',true).status,undefined)
})
test('invalid storage and failed writes surface errors instead of silently resetting statuses',()=>{
  for(const value of ['broken','null','[]','{"2026-09": []}','{"2026-09":{"p1":{"status":"bad"}}}']) {
    const s=storage();s.setItem(bankNoteStorageKey,value)
    assert.throws(()=>loadBankNoteDrafts(s,'2026-09'))
    assert.throws(()=>saveBankNoteField(s,'2026-09','row1','comment','test'))
    assert.equal(s.getItem(bankNoteStorageKey),value)
  }
  const s=storage();s.setItem=()=>{throw new Error('Storage full')}
  assert.throws(()=>saveBankNoteField(s,'2026-09','row1','comment','test'),/Storage full/)
  assert.equal(isBankNoteStorageKey(bankNoteStorageKey),true)
  assert.equal(isBankNoteStorageKey(null),true)
  assert.equal(isBankNoteStorageKey('unrelated'),false)
})
