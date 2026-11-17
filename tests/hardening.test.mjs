import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bootDatabase, REPO } from './dbkit.mjs';
const k=await bootDatabase(),{db}=k,rpc=k.rpcAs;
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
try{
 const a=await k.newUser('securealice@test.local'),b=await k.newUser('securebob@test.local'),c=await k.newUser('securecharlie@test.local'),staff=await k.newUser('securestaff@test.local');
 for(const u of [a,b,c,staff])await k.createProfile(u);
 const f=await rpc(a,'request_friend',b.id);await rpc(b,'friend_action',f,'accept');
 const f2=await rpc(a,'request_friend',c.id);await rpc(c,'friend_action',f2,'accept');
 const room=await rpc(a,'room_create','local','Kampar','Study','Security fixture','Isolated test only',5);await rpc(b,'room_join',room);
 const key=randomUUID(),message=await rpc(a,'send_message',f,'retry me',key);
 await test('a retry returns one DM and cannot reuse a key for different content or thread',async()=>{
  assert.equal(await rpc(a,'send_message',f,'retry me',key),message);
  await assert.rejects(()=>rpc(a,'send_message',f,'changed body',key),/different content/);
  await assert.rejects(()=>rpc(a,'send_message',f2,'retry me',key),/different content/);
  assert.equal((await db.query('select count(*)::int n from public.campusmy_messages where client_id=$1',[key])).rows[0].n,1);
 });
 await test('retry authorization is checked again after a friendship ends',async()=>{
  await rpc(b,'friend_action',f,'remove');await assert.rejects(()=>rpc(a,'send_message',f,'retry me',key),/accepted friends/);
  await rpc(a,'request_friend',b.id);await rpc(b,'friend_action',f,'accept');
  await rpc(b,'block_person',a.id,true);await assert.rejects(()=>rpc(a,'send_message',f,'retry me',key),/accepted friends/);await rpc(b,'block_person',a.id,false);
 });
 const rkey=randomUUID(),rid=await rpc(b,'room_send',room,'room retry',rkey);
 await test('a room retry requires current membership, an open room and the same content',async()=>{
  assert.equal(await rpc(b,'room_send',room,'room retry',rkey),rid);
  await assert.rejects(()=>rpc(b,'room_send',room,'changed',rkey),/different content/);
  await rpc(a,'room_manage',room,'close',null);await assert.rejects(()=>rpc(b,'room_send',room,'room retry',rkey),/closed/);
  await rpc(a,'room_manage',room,'reopen',null);await rpc(b,'room_leave',room);await assert.rejects(()=>rpc(b,'room_send',room,'room retry',rkey),/Join this room/);await rpc(b,'room_join',room);
 });
 await test('the server rejects tabs and newlines without relying on form validation',async()=>{
  await assert.rejects(()=>rpc(a,'send_message',f2,'\n\t',randomUUID()),/Write a message/);
  await assert.rejects(()=>rpc(b,'room_send',room,'\n\t',randomUUID()),/Write a message/);
 });
 await test('equal timestamps use a stable cursor and an unread sequence watermark',async()=>{
  for(let i=0;i<120;i++)await db.query("insert into public.campusmy_messages(friendship,sender,body,created_at) values($1,$2,$3,'2026-01-01')",[f2,c.id,'page '+i]);
  const latest=await rpc(a,'messages',f2,null,null),older=await rpc(a,'messages',f2,null,latest[0].seq);
  assert.equal(latest.length,50);assert.equal(older.length,50);assert.equal(new Set([...latest,...older].map(x=>x.id)).size,100);
  await db.query("insert into public.campusmy_messages(friendship,sender,body,created_at) values($1,$2,'committed later','2026-01-01')",[f2,c.id]);
  assert.equal((await rpc(a,'friends')).items.find(x=>x.id===f2).unread,1);
  await rpc(a,'messages',f2,null,older[0].seq);assert.equal((await rpc(a,'friends')).items.find(x=>x.id===f2).unread,1,'older pages do not mark new messages read');
  await rpc(a,'messages',f2,null,null);assert.equal((await rpc(a,'friends')).items.find(x=>x.id===f2).unread,0);
 });
 const course=(await db.query('select course_key,term from public.campusmy_social_teachers limit 1')).rows[0];
 const review=await rpc(a,'save_review',course.course_key,course.term,'',4,4,'Moderate',[],'Useful isolated review','',true);
 await rpc(b,'report_review',review,'Please review this content');await rpc(a,'room_report',rid,'Please review this room message');
 await db.query('insert into public.campusmy_staff(user_id) values($1)',[staff.id]);
 await test('staff receive bounded report context without reporter identities or anonymous authors',async()=>{
  const queue=await rpc(staff,'mod_queue','open',50);assert.equal(queue.length,2);
  const text=JSON.stringify(queue);assert.ok(!text.includes(b.id)&&!text.includes(a.id)&&!text.includes('@test.local'));
  assert.equal(queue.find(x=>x.id===review).context.author,'anonymous student');
  assert.equal(await rpc(a,'is_staff'),false);await assert.rejects(()=>rpc(a,'mod_queue','open',50),/Staff only/);
 });
 await test('hide and restore change visibility and each decision is audited with a reason',async()=>{
  await assert.rejects(()=>rpc(staff,'mod_action','review',review,'hide',''),/decision reason/);
  await rpc(staff,'mod_action','review',review,'hide','Isolated policy decision');
  assert.ok(!(await rpc(b,'course_social',course.course_key,course.term)).reviews.some(x=>x.id===review));
  await rpc(staff,'mod_action','review',review,'restore','Isolated appeal decision');
  assert.ok((await rpc(b,'course_social',course.course_key,course.term)).reviews.some(x=>x.id===review));
  await rpc(staff,'mod_action','room_message',rid,'hide','Isolated room decision');
  assert.ok(!(await rpc(a,'room_messages',room,null)).some(x=>x.id===rid));
  await rpc(staff,'mod_action','room_message',rid,'restore','Isolated room appeal');
  assert.ok((await rpc(a,'room_messages',room,null)).some(x=>x.id===rid));
  const log=await rpc(staff,'mod_log',50);assert.equal(log.length,4);assert.ok(log.every(x=>x.reason.length>3));
 });
 await test('dismissal requires an existing reported target and does not hide content',async()=>{
  await assert.rejects(()=>rpc(staff,'mod_action','review',randomUUID(),'dismiss','No such target'),/not found/);
  await rpc(b,'report_review',review,'Another report after restore');
  await rpc(staff,'mod_action','review',review,'dismiss','No violation found');
  assert.equal((await rpc(staff,'mod_queue','dismissed',50)).length,1);
  assert.ok((await rpc(b,'course_social',course.course_key,course.term)).reviews.some(x=>x.id===review));
  await assert.rejects(()=>rpc(staff,'mod_action','review',review,'dismiss','Repeat dismissal'),/No open reports/);
 });
 await test('health counters accept fixed categories, expose aggregates only to staff and reject arbitrary text',async()=>{
  await rpc(a,'record_health','dm','connection','4.3.0');await rpc(b,'record_health','dm','connection','4.3.0');
  await assert.rejects(()=>rpc(a,'record_health','private@email.test','connection','4.3.0'),/Invalid health/);
  await assert.rejects(()=>rpc(a,'record_health','dm','secret message','4.3.0'),/Invalid health/);
  await assert.rejects(()=>rpc(a,'health_summary'),/Staff only/);
  const summary=await rpc(staff,'health_summary');assert.equal(summary[0].count,2);
  assert.deepEqual(Object.keys(summary[0]).sort(),['area','count','hour','kind','version']);
 });
 await test('community posting pauses are server-enforced, reversible and preserve privacy controls',async()=>{
  await assert.rejects(()=>rpc(a,'mod_posting','review',review,7,'Not staff'),/Staff only/);
  await rpc(staff,'mod_posting','review',review,7,'Temporary isolated posting pause');
  assert.equal((await rpc(a,'posting_status')).reason,'Temporary isolated posting pause');
  await assert.rejects(()=>rpc(a,'save_review',course.course_key,course.term,'',4,4,'Moderate',[],'An edit while paused','',true),/posting is paused/);
  await assert.rejects(()=>rpc(a,'room_send',room,'Paused post',randomUUID()),/posting is paused/);
  await rpc(a,'pause_sharing');await rpc(a,'send_message',f2,'Privacy and friend DMs stay available',randomUUID());
  await rpc(staff,'mod_posting','review',review,0,'Posting access restored');assert.equal(await rpc(a,'posting_status'),null);
  await rpc(staff,'mod_posting','review',review,1,'Isolated expiry test');await db.query("update public.campusmy_posting_pauses set until_at=now()-interval '1 second' where user_id=$1",[a.id]);
  await rpc(a,'room_send',room,'Expired posting pause',randomUUID());
 });
 await test('reapplying versioned migrations preserves messages, decisions and exact privileges',async()=>{
  const before=await db.query('select id,seq,body from public.campusmy_messages order by seq');
  for(const f of ['supabase/20261117_security_hardening.sql','supabase/20261117_operational_metrics.sql'])await db.exec(readFileSync(`${REPO}/${f}`,'utf8'));
  assert.deepEqual((await db.query('select id,seq,body from public.campusmy_messages order by seq')).rows,before.rows);
  assert.equal((await rpc(staff,'mod_log',50)).length,8);
  assert.equal(await rpc(staff,'is_staff'),true);
 });
 await test('removing staff privileges immediately denies all moderation and metrics calls',async()=>{
  await db.query('delete from public.campusmy_staff where user_id=$1',[staff.id]);
  for(const [fn,...args] of [['mod_queue','open',50],['mod_log',50],['mod_action','review',review,'hide','No longer staff'],['health_summary']])await assert.rejects(()=>rpc(staff,fn,...args),/Staff only/);
 });
 console.log(`\n${count}/${count} hardening checks passed`);
}catch(e){console.error(e.message);process.exitCode=1;}finally{await db.close();}
