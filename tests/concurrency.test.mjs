// Real PostgreSQL, independent connections, synthetic accounts only. Never accepts a database URL.
// Retains its unique ignored .runtime directory; it never recursively deletes any directory.
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync,mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './dbkit.mjs';
const runtime=join(REPO,'.runtime');mkdirSync(runtime,{recursive:true});
const dir=mkdtempSync(join(runtime,'pg-audit-')),password=randomUUID(),connections=new Set();
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const server=new EmbeddedPostgres({databaseDir:dir,port,user:'postgres',password,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let admin,count=0;
async function connect(user,database='postgres'){
 const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database});await c.connect();connections.add(c);
 await c.query("set statement_timeout='20s'");
 if(user){await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]);await c.query('set role authenticated');}return c;
}
async function release(c){connections.delete(c);await c.end();}
async function call(user,sql,args=[]){const c=await connect(user);try{return(await c.query(sql,args)).rows[0]?.r;}finally{await release(c);}}
async function burst(user,n,sql,args){const clients=await Promise.all(Array.from({length:n},()=>connect(user)));try{return await Promise.allSettled(clients.map((c,i)=>c.query(sql,args(i))));}finally{await Promise.all(clients.map(release));}}
async function user(name){const id=randomUUID();await admin.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,name+'@test.local']);await admin.query('insert into public.campusmy_profiles(user_id,username) values($1,$2)',[id,name]);return{id};}
const migrations=['CampusMY-supabase-setup.sql','CampusMY-social-setup.sql','supabase/20261116_chat_rooms.sql','supabase/20261117_security_hardening.sql','supabase/20261117_operational_metrics.sql'];
async function schema(c){await c.query(`create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);for(const file of migrations)await c.query(readFileSync(join(REPO,file),'utf8'));}
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
try{
 await server.initialise();await server.start();admin=await connect();await admin.query('create role anon nologin;create role authenticated nologin');await schema(admin);
 const actor=await user('burstactor'),targets=[];for(let i=0;i<30;i++)targets.push(await user('target'+i));
 const course=(await admin.query('select course_key,term from public.campusmy_social_teachers limit 1')).rows[0];
 await test('30 concurrent friend requests from separate connections commit exactly 20',async()=>{
  const r=await burst(actor,30,'select public.cm_request_friend($1) r',i=>[targets[i].id]);assert.equal(r.filter(x=>x.status==='fulfilled').length,20);assert.ok(r.filter(x=>x.status==='rejected').every(x=>/limit reached/.test(x.reason.message)));
 });
 const accepted=(await admin.query('select id,recipient from public.campusmy_friendships where requester=$1 limit 1',[actor.id])).rows[0],friend={id:accepted.recipient};await call(friend,"select public.cm_friend_action($1,'accept') r",[accepted.id]);
 await test('45 concurrent DM sends commit exactly 30 across connections',async()=>{
  const r=await burst(actor,45,'select public.cm_send_message($1,$2,$3) r',i=>[accepted.id,'burst '+i,randomUUID()]);assert.equal(r.filter(x=>x.status==='fulfilled').length,30);
 });
 await test('12 concurrent group creations respect five active groups',async()=>{
  const r=await burst(actor,12,"select public.cm_create_group($1,$2,$3,'Study partner','Online','','',4) r",i=>[course.course_key,course.term,'Group '+i]);assert.equal(r.filter(x=>x.status==='fulfilled').length,5);
 });
 await test('30 concurrent distinct review creations respect 20 per day',async()=>{
  const courses=(await admin.query('select distinct course_key,term from public.campusmy_social_teachers limit 30')).rows;
  const r=await burst(actor,30,"select public.cm_save_review($1,$2,'',4,4,'Moderate','{}','Concurrent isolated review','',true) r",i=>[courses[i].course_key,courses[i].term]);assert.equal(r.filter(x=>x.status==='fulfilled').length,20);
 });
 await test('simultaneous mutual friend requests return one relationship without constraint errors',async()=>{
  const [a,b]=targets.slice(26,28),result=await Promise.all([call(a,'select public.cm_request_friend($1) r',[b.id]),call(b,'select public.cm_request_friend($1) r',[a.id])]);assert.equal(result[0],result[1]);
 });
 const roomOwner=await user('raceowner'),room=await call(roomOwner,"select public.cm_room_create('local','Kampar','Study','Race fixture','',3) r");
 await test('ten concurrent room joins never exceed room capacity',async()=>{
  const r=await Promise.allSettled(targets.slice(10,20).map(t=>call(t,'select public.cm_room_join($1) r',[room])));assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
 });
 await test('45 room sends and concurrent room creations respect their existing limits',async()=>{
  const sends=await burst(roomOwner,45,'select public.cm_room_send($1,$2,$3) r',i=>[room,'room burst '+i,randomUUID()]);assert.equal(sends.filter(x=>x.status==='fulfilled').length,30);
  const creates=await burst(roomOwner,8,"select public.cm_room_create('local','Kampar','Study',$1,'',5) r",i=>['Room '+i]);assert.equal(creates.filter(x=>x.status==='fulfilled').length,2);
 });
 await test('eight simultaneous retries commit exactly one message for a single request key',async()=>{
  const key=randomUUID(),r=await burst(friend,8,'select public.cm_send_message($1,$2,$3) r',()=>[accepted.id,'same intent',key]);assert.equal(r.filter(x=>x.status==='fulfilled').length,8);assert.equal(new Set(r.map(x=>x.value.rows[0].r)).size,1);assert.equal((await admin.query('select count(*)::int n from public.campusmy_messages where client_id=$1',[key])).rows[0].n,1);
 });
 await test('concurrent report spam and expensive reads share server-side budgets',async()=>{
  const key=randomUUID(),msg=await call(friend,'select public.cm_send_message($1,$2,$3) r',[accepted.id,'report fixture',key]);
  // Seed near each boundary, then race independent transactions over the final two slots.
  await admin.query("insert into public.campusmy_rate_events(user_id,action) select $1,'social_read' from generate_series(1,298)",[targets[29].id]);
  const reads=await burst(targets[29],6,'select public.cm_friends() r',()=>[]);assert.equal(reads.filter(x=>x.status==='fulfilled').length,2);
  assert.ok(msg);
  const review=(await admin.query('select id from public.campusmy_reviews limit 1')).rows[0].id;
  await admin.query("insert into public.campusmy_rate_events(user_id,action) select $1,'report' from generate_series(1,18)",[targets[28].id]);
  const reports=await burst(targets[28],6,"select public.cm_report_review($1,'Concurrent report fixture') r",()=>[review]);assert.equal(reports.filter(x=>x.status==='fulfilled').length,2);
 });
 await test('simultaneous first invitation requests return one current token',async()=>{
  const r=await burst(targets[25],8,'select public.cm_my_invite(false) r',()=>[]);assert.equal(r.filter(x=>x.status==='fulfilled').length,8);assert.equal(new Set(r.map(x=>x.value.rows[0].r.token)).size,1);
 });
 const plan=await admin.query('explain (analyze,buffers,format json) select id,seq,body from public.campusmy_messages where friendship=$1 order by seq desc limit 50',[accepted.id]);writeFileSync(join(dir,'dm-query-plan.json'),JSON.stringify(plan.rows));
 await test('isolated logical fixture backup restores every row and private-access contracts in a fresh database',async()=>{
  // This is an application-schema/data drill, not a full Supabase Auth/Storage/PITR backup.
  const tables=(await admin.query("select table_schema s,table_name t from information_schema.tables where table_type='BASE TABLE' and (table_schema='auth' or table_schema='public' and table_name like 'campusmy_%') order by table_schema,table_name")).rows;
  const snapshot=[];for(const {s,t} of tables){const rows=(await admin.query(`select to_jsonb(r) row from "${s}"."${t}" r`)).rows.map(x=>x.row);snapshot.push({s,t,rows});}
  writeFileSync(join(dir,'fixture-backup.json'),JSON.stringify(snapshot));
  await admin.query('create database campusmy_fixture_restore');const restored=await connect(null,'campusmy_fixture_restore');await schema(restored);
  await restored.query('begin');await restored.query('truncate '+tables.map(x=>`"${x.s}"."${x.t}"`).join(',')+' restart identity cascade');
  const remaining=[...snapshot];while(remaining.length){let progress=false;for(let i=remaining.length-1;i>=0;i--){const t=remaining[i];await restored.query('savepoint one_table');try{for(const row of t.rows)await restored.query(`insert into "${t.s}"."${t.t}" overriding system value select (jsonb_populate_record(null::"${t.s}"."${t.t}",$1::jsonb)).*`,[JSON.stringify(row)]);await restored.query('release savepoint one_table');remaining.splice(i,1);progress=true;}catch(e){await restored.query('rollback to savepoint one_table');await restored.query('release savepoint one_table');if(e.code!=='23503')throw e;}}if(!progress)throw Error('Cannot restore table dependency order');}
  const seqs=(await restored.query("select table_schema s,table_name t,column_name c,pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name) seq from information_schema.columns where table_schema='public' and (is_identity='YES' or column_default like 'nextval%')")).rows;
  for(const x of seqs)if(x.seq)await restored.query(`select setval($1,greatest(coalesce(max("${x.c}"),0),1),count(*)>0) from "${x.s}"."${x.t}"`,[x.seq]);
  await restored.query('commit');
  const canonical=rows=>rows.map(x=>JSON.stringify(x)).sort();for(const t of snapshot)assert.deepEqual(canonical((await restored.query(`select to_jsonb(r) row from "${t.s}"."${t.t}" r`)).rows.map(x=>x.row)),canonical(t.rows),t.t);
  await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[friend.id]);await restored.query('set role authenticated');const msgs=(await restored.query('select public.cm_messages($1,null,null) r',[accepted.id])).rows[0].r;assert.ok(msgs.some(x=>x.body==='same intent'));
  await assert.rejects(()=>restored.query('select * from public.campusmy_messages'),/permission denied/);
  await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[targets[28].id]);await assert.rejects(()=>restored.query('select public.cm_messages($1,null,null)',[accepted.id]),/accepted friends/);
  await release(restored);console.log('  Restored '+snapshot.length+' tables; fixture backup retained under ignored .runtime.');
 });
 console.log(`\n${count}/${count} real PostgreSQL concurrency/recovery checks passed`);
}catch(e){console.error(e?.message||String(e));process.exitCode=1;}
finally{await Promise.allSettled([...connections].map(release));if(process.platform==='win32'&&server.process){
 // The package uses taskkill on Windows, which is unavailable in managed sandboxes.
 // pg_ctl targets only this run's retained, unique cluster directory and shuts it down cleanly.
 const {pg_ctl}=await import('@embedded-postgres/windows-x64');
 await promisify(execFile)(pg_ctl,['stop','-D',dir,'-m','fast','-w','-t','15'],{windowsHide:true});
 server.process=undefined;
 }else await server.stop();}
