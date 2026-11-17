import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { REPO } from './dbkit.mjs';
const dom=new JSDOM('',{runScripts:'outside-only',url:'https://test.invalid/'}),w=dom.window;
let handler,calls=[];w.CampusAccount={state:{user:{id:'alice'}},rpc:async(name,args)=>{calls.push({name,args});return handler(name,args);}};
Object.defineProperty(w,'crypto',{value:globalThis.crypto});w.eval(readFileSync(`${REPO}/reliability.js`,'utf8'));
const R=w.CampusReliability;let count=0;
async function test(name,fn){calls=[];await fn();count++;console.log('PASS '+name);}
try{
 await test('a lost response is never automatically resent and the manual retry reuses its key',async()=>{
  let n=0;handler=()=>{if(!n++)throw Object.assign(Error('Failed to fetch'),{code:''});return 'committed-id';};
  await assert.rejects(()=>R.send('cm_send_message',{p_friendship:'one',p_body:'hello'}));assert.equal(calls.length,1);
  assert.equal(await R.send('cm_send_message',{p_friendship:'one',p_body:'hello'}),'committed-id');assert.equal(calls[0].args.p_client_id,calls[1].args.p_client_id);
  await R.send('cm_send_message',{p_friendship:'one',p_body:'hello'});assert.notEqual(calls[1].args.p_client_id,calls[2].args.p_client_id,'a new successful identical message is a new intent');
 });
 await test('fallback is allowed only for a missing signature and is specific to that RPC',async()=>{
  handler=(name,args)=>{if('p_client_id'in args)throw Object.assign(Error('Missing signature'),{code:'PGRST202'});return 'old-id';};
  await R.send('cm_room_send',{p_room:'r',p_body:'hello'});assert.equal(calls.length,2);assert.ok(!('p_client_id'in calls[1].args));
  handler=()=>[];await R.messages('one',{seq:'9007199254740993',created_at:'2026-01-01'});assert.equal(calls.at(-1).args.p_before_seq,'9007199254740993','room capability does not downgrade DM pagination');
 });
 await test('access denial is not retried through a legacy method',async()=>{
  handler=()=>{throw Object.assign(Error('No longer friends'),{code:'42501'});};
  await assert.rejects(()=>R.send('cm_send_message',{p_friendship:'other',p_body:'hello'}));assert.equal(calls.length,1);
 });
 await test('changing accounts discards retry identities and API capability caches',async()=>{
  handler=()=>{throw Error('Offline');};await assert.rejects(()=>R.send('cm_send_message',{p_friendship:'one',p_body:'draft'}));const key=calls[0].args.p_client_id;
  w.CampusAccount.state.user={id:'bob'};w.dispatchEvent(new w.Event('campusmy:account-changed'));
  handler=()=>true;await R.send('cm_send_message',{p_friendship:'one',p_body:'draft'});assert.notEqual(calls[1].args.p_client_id,key);
  await R.send('cm_room_send',{p_room:'r',p_body:'hello'});assert.ok(calls.at(-1).args.p_client_id);
 });
 await test('large sequence values sort without converting to lossy JavaScript numbers',()=>{
  assert.ok(R.compare({seq:'9007199254740993'},{seq:'9007199254740992'})>0);
 });
 console.log(`\n${count}/${count} retry and compatibility checks passed`);
}finally{w.close();}
