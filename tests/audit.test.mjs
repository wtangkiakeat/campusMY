// Permission audit on the isolated database: exact browser-callable surface, table/sequence grants,
// RLS coverage, SECURITY DEFINER hygiene and ID-substitution across identities.
import assert from 'node:assert/strict';
import { bootDatabase } from './dbkit.mjs';

const kit = await bootDatabase();
const { db } = kit;
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const denied = (fn, pattern) => assert.rejects(fn, pattern ? { message: pattern } : undefined);

// The complete set of functions a signed-in browser may call. Anything else executable by
// `authenticated` or `anon` is a finding.
const ALLOWED = new Set([
  'campusmy_save_planner(jsonb,bigint)',
  'cm_find_person(text)', 'cm_my_invite(boolean)', 'cm_resolve_invite(uuid)', 'cm_request_friend(uuid)', 'cm_friend_action(uuid,text)',
  'cm_block_person(uuid,boolean)', 'cm_publish_plan(jsonb)', 'cm_pause_sharing()', 'cm_get_friend_plan(uuid)', 'cm_friends()',
  'cm_messages(uuid,timestamp with time zone)', 'cm_messages(uuid,timestamp with time zone,bigint)', 'cm_send_message(uuid,text)', 'cm_send_message(uuid,text,uuid)',
  'cm_course_social(text,text)', 'cm_save_review(text,text,text,integer,integer,text,text[],text,text,boolean)', 'cm_delete_review(uuid)',
  'cm_report_review(uuid,text)', 'cm_recent_reviews()', 'cm_my_reviews()', 'cm_classmate(text,text,text,text,text,boolean)',
  'cm_create_group(text,text,text,text,text,text,text,integer)', 'cm_group_action(uuid,text,uuid)',
  'cm_room_list(text,text,text,text,boolean)', 'cm_room_detail(uuid)', 'cm_room_create(text,text,text,text,text,integer)', 'cm_room_join(uuid)',
  'cm_room_leave(uuid)', 'cm_room_messages(uuid,bigint)', 'cm_room_send(uuid,text)', 'cm_room_send(uuid,text,uuid)', 'cm_room_members(uuid)',
  'cm_room_manage(uuid,text,uuid)', 'cm_room_mute(uuid,boolean)', 'cm_room_report(uuid,text)',
  'cm_posting_status()', 'cm_mod_posting(text,uuid,integer,text)', 'cm_record_health(text,text,text)', 'cm_health_summary()', 'cm_is_staff()', 'cm_mod_queue(text,integer)', 'cm_mod_action(text,uuid,text,text)', 'cm_mod_log(integer)',
]);

async function surfaceCheck() {
  const { rows } = await db.query(`
    select p.proname||'('||array_to_string(p.proargtypes::regtype[], ',')||')' as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('anon', p.oid, 'execute') as anon_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
  const anonExec = rows.filter(r => r.anon_ok).map(r => r.sig);
  assert.deepEqual(anonExec, [], 'anonymous visitors must not execute any function: ' + anonExec.join(', '));
  const unexpected = rows.filter(r => r.auth_ok && !ALLOWED.has(r.sig)).map(r => r.sig);
  assert.deepEqual(unexpected, [], 'unexpected browser-callable functions: ' + unexpected.join(', '));
  const retired=new Set(['cm_messages(uuid,timestamp with time zone)','cm_send_message(uuid,text)','cm_room_send(uuid,text)']);
  assert.deepEqual(rows.filter(r=>r.auth_ok).map(r=>r.sig).sort(), [...ALLOWED].filter(s=>!retired.has(s)).sort(), 'every documented RPC must retain its execute grant');
  const internal = rows.filter(r => !r.auth_ok).map(r => r.sig);
  for (const must of ['cm_verified()', 'cm_require_user()', 'cm_blocked(uuid,uuid)', 'cm_person(uuid)', 'cm_clean_plan(jsonb)', 'cm_room_access(uuid,boolean)', 'cm_room_json(campusmy_rooms,uuid)', 'cm_review_json(campusmy_reviews)', 'cm_rate_limit(uuid,text,integer,interval,text)', 'cm_require_staff()'])
    assert.ok(internal.includes(must), must + ' must stay internal');
  const overloads = rows.filter(r => /^(cm_messages|cm_send_message|cm_room_send)\(/.test(r.sig)).map(r => r.sig);
  assert.deepEqual(overloads.sort(), ['cm_messages(uuid,timestamp with time zone,bigint)', 'cm_room_send(uuid,text,uuid)', 'cm_send_message(uuid,text,uuid)'], 'exactly one overload each: ' + overloads.join(', '));
}
await test('only the documented RPC surface is executable by browser roles', surfaceCheck);
await test('older bootstrap files fail closed without replacing hardened functions', async () => {
  const { readFileSync } = await import('node:fs');
  const { REPO } = await import('./dbkit.mjs');
  const definitions = async () => (await db.query(`select proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`)).rows;
  const before=await definitions();
  for (const f of ['CampusMY-supabase-setup.sql','CampusMY-social-setup.sql','supabase/20261116_chat_rooms.sql']) {
    await assert.rejects(()=>db.exec(readFileSync(`${REPO}/${f}`,'utf8')), /already installed/);
    await db.exec('rollback');
    assert.deepEqual(await definitions(),before);
  }
  await surfaceCheck();
});

await test('no table or sequence is directly readable or writable by browser roles except the three owner-only tables', async () => {
  const { rows } = await db.query(`
    select c.relname, c.relkind, c.relrowsecurity,
      has_table_privilege('authenticated', c.oid, 'select') as a_sel, has_table_privilege('authenticated', c.oid, 'insert') as a_ins,
      has_table_privilege('authenticated', c.oid, 'update') as a_upd, has_table_privilege('authenticated', c.oid, 'delete') as a_del,
      has_table_privilege('anon', c.oid, 'select') as anon_sel
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S') order by 1`);
  const tables = rows.filter(r => r.relkind === 'r');
  assert.ok(tables.length >= 20, 'expected the full schema');
  for (const t of tables) {
    assert.equal(t.relrowsecurity, true, `RLS must be enabled on ${t.relname}`);
    assert.equal(t.anon_sel, false, `anon must not read ${t.relname}`);
    const direct = ['campusmy_profiles', 'campusmy_planners', 'campusmy_todos'].includes(t.relname);
    assert.equal(t.a_sel || t.a_ins || t.a_upd || t.a_del, direct, `${t.relname} direct grants: ${JSON.stringify(t)}`);
  }
  for (const s of rows.filter(r => r.relkind === 'S')) {
    const priv = await db.query(`select has_sequence_privilege('authenticated', $1, 'usage') u, has_sequence_privilege('authenticated', $1, 'select') s`, ['public.' + s.relname]);
    assert.equal(priv.rows[0].u || priv.rows[0].s, false, `sequence ${s.relname} must not be usable by browser roles`);
  }
});

await test('every SECURITY DEFINER function pins an empty search_path', async () => {
  const { rows } = await db.query(`
    select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef order by 1`);
  assert.ok(rows.length >= 30);
  for (const r of rows) assert.ok((r.proconfig || []).some(c => c==='search_path=' || c==='search_path=""'), `${r.proname} must set search_path`);
});

// ---------- identities ----------
const alice = await kit.newUser('auditalice@test.local'), bob = await kit.newUser('auditbob@test.local'), mallory = await kit.newUser('auditmallory@test.local');
const unconfirmed = await kit.newUser('auditunconfirmed@test.local', false), blocked = await kit.newUser('auditblocked@test.local'), sl = await kit.newUser('auditsl@test.local');
for (const u of [alice, bob, mallory, unconfirmed, blocked, sl]) await kit.createProfile(u);
await db.query(`update public.campusmy_profiles set campus='Sungai Long' where user_id=$1`, [sl.id]);
const rpc = (u, n, ...a) => kit.rpcAs(u, n, ...a);
const fid = await rpc(alice, 'request_friend', bob.id); await rpc(bob, 'friend_action', fid, 'accept');
await rpc(alice, 'publish_plan', { name: 'Alice plan', campus: 'Kampar', term: 'October 2026', entries: [{ name: 'Secret class', code: 'SEC101', groups: 'L1', meetings: [{ day: 'Mon', start: 540, end: 600, room: 'Hidden room', lecturer: 'Dr X', weekNumbers: [] }] }] });
const msgId = await rpc(alice, 'send_message', fid, 'private to bob');
const course = (await db.query(`select t.course_key, t.term, t.name from public.campusmy_social_teachers t join public.campusmy_social_courses c using(course_key) where c.campus='Kampar' limit 1`)).rows[0];
const reviewId = await rpc(alice, 'save_review', course.course_key, course.term, course.name, 4, 4, 'Light', [], 'Audit review body text here.', '', false);
await rpc(bob, 'report_review', reviewId, 'audit report reason');
const groupId = await rpc(alice, 'create_group', course.course_key, course.term, 'Audit group', 'Study partner', 'Online', '', '', 3);
const room = await rpc(alice, 'room_create', 'campus', 'Kampar', 'Study', 'Audit room', 'members only', 5);
await rpc(bob, 'room_join', room);
const roomMsg = await rpc(alice, 'room_send', room, 'room secret');
await rpc(bob, 'room_report', roomMsg, 'audit room report reason');
await rpc(alice, 'block_person', blocked.id, true);
await kit.as(alice, () => db.query(`insert into public.campusmy_todos(user_id, title) values ($1, 'alice todo')`, [alice.id]));
await kit.as(alice, () => db.query(`select public.campusmy_save_planner('{"k":1}'::jsonb, 0)`));

await test('an unrelated confirmed account cannot read another student\'s plan, thread, room or details by guessing IDs', async () => {
  await denied(() => rpc(mallory, 'get_friend_plan', alice.id), /Accept a friend request/);
  await denied(() => rpc(mallory, 'messages', fid, null), /accepted friends only/);
  await denied(() => rpc(mallory, 'send_message', fid, 'intruder'), /accepted friends only/);
  await denied(() => rpc(mallory, 'friend_action', fid, 'remove'), /not found/);
  await denied(() => rpc(mallory, 'room_messages', room, null), /Join this room/);
  await denied(() => rpc(mallory, 'room_members', room), /Join this room/);
  await denied(() => rpc(mallory, 'room_manage', room, 'close', null));
  await denied(() => rpc(mallory, 'group_action', groupId, 'approve', bob.id), /Only the organiser/);
  const space = await rpc(mallory, 'course_social', course.course_key, course.term);
  assert.ok(space.reviews.every(r => r.mine === false && !('owner' in r)), 'review projection must not expose owner ids');
  await rpc(mallory, 'delete_review', reviewId);
  assert.ok((await rpc(alice, 'course_social', course.course_key, course.term)).reviews.some(r => r.id === reviewId), 'foreign delete must be a no-op');
  await denied(() => kit.as(mallory, () => db.query(`select * from public.campusmy_messages where id=$1`, [msgId])), /permission denied/);
  await denied(() => kit.as(mallory, () => db.query(`select * from public.campusmy_review_reports`)), /permission denied/);
  await denied(() => kit.as(mallory, () => db.query(`select * from public.campusmy_room_reports`)), /permission denied/);
  assert.equal((await kit.as(mallory, () => db.query(`select count(*)::int n from public.campusmy_todos`))).rows[0].n, 0);
  assert.equal((await kit.as(mallory, () => db.query(`select count(*)::int n from public.campusmy_planners`))).rows[0].n, 0);
  assert.equal((await kit.as(mallory, () => db.query(`select count(*)::int n from public.campusmy_profiles where user_id<>$1`, [mallory.id]))).rows[0].n, 0, 'profiles are not a public directory');
});

await test('anonymous and unconfirmed identities are refused everywhere', async () => {
  for (const [n, ...a] of [['friends'], ['room_list', 'local', 'Kampar', '', '', false], ['course_social', course.course_key, course.term], ['messages', fid, null], ['get_friend_plan', alice.id], ['room_messages', room, null]]) {
    await denied(() => rpc(kit.ANON, n, ...a), /permission denied/);
    await denied(() => rpc(unconfirmed, n, ...a), /confirmed email/);
  }
});

await test('a blocked account cannot reach the blocker through any path', async () => {
  assert.equal(await rpc(blocked, 'find_person', 'auditalice'), null);
  await denied(() => rpc(blocked, 'request_friend', alice.id), /unavailable/);
  await denied(() => rpc(blocked, 'room_detail', room), /unavailable/);
  await denied(() => rpc(blocked, 'room_join', room), /unavailable/);
  await denied(() => rpc(blocked, 'group_action', groupId, 'request', null), /unavailable/);
});

await test('a removed friend loses plan, chat and sharing access immediately', async () => {
  const f2 = await rpc(alice, 'request_friend', mallory.id); await rpc(mallory, 'friend_action', f2, 'accept');
  assert.ok(await rpc(mallory, 'get_friend_plan', alice.id));
  await rpc(alice, 'friend_action', f2, 'remove');
  await denied(() => rpc(mallory, 'get_friend_plan', alice.id), /Accept a friend request/);
  await denied(() => rpc(mallory, 'messages', f2, null), /accepted friends only/);
  assert.ok(!(await rpc(mallory, 'friends')).items.some(i => i.id === f2));
});

await test('changing the self-declared campus changes campus-room access (documented, not a verified boundary)', async () => {
  await denied(() => rpc(sl, 'room_detail', room), /unavailable/);
  await kit.as(sl, () => db.query(`update public.campusmy_profiles set campus='Kampar' where user_id=$1`, [sl.id]));
  assert.equal((await rpc(sl, 'room_detail', room)).title, 'Audit room');
  await rpc(sl, 'room_join', room);
  await kit.as(sl, () => db.query(`update public.campusmy_profiles set campus='Sungai Long' where user_id=$1`, [sl.id]));
  await denied(() => rpc(sl, 'room_messages', room, null), /unavailable/);
  assert.ok(!(await rpc(sl, 'room_list', 'local', 'Kampar', '', '', true)).some(r => r.id === room), 'a campus room disappears from My Chats after switching campus');
});

await test('projections never include emails, owner ids or reporter identities', async () => {
  const everything = JSON.stringify([await rpc(bob, 'friends'), await rpc(bob, 'room_detail', room), await rpc(bob, 'room_members', room), await rpc(bob, 'room_messages', room, null), await rpc(bob, 'course_social', course.course_key, course.term), await rpc(bob, 'get_friend_plan', alice.id), await rpc(bob, 'recent_reviews')]);
  assert.ok(!everything.includes('@test.local'), 'an email leaked into an API projection');
  assert.ok(!everything.includes('"reporter"'), 'reporter identity leaked');
});

await test('profile and metadata fields grant no moderator or staff powers', async () => {
  await kit.as(mallory, () => db.query(`update public.campusmy_profiles set display_name='Moderator', preferences='{"role":"staff","admin":true}'::jsonb where user_id=$1`, [mallory.id]));
  await denied(() => kit.as(mallory, () => db.query(`update public.campusmy_reviews set hidden=true where id=$1`, [reviewId])), /permission denied/);
  await denied(() => kit.as(mallory, () => db.query(`update public.campusmy_room_messages set hidden=true where id=$1`, [roomMsg])), /permission denied/);
  const staffFn = (await db.query(`select count(*)::int n from pg_proc where proname='cm_is_staff'`)).rows[0].n;
  if (staffFn) {
    assert.equal(await rpc(mallory, 'is_staff'), false);
    await denied(() => rpc(mallory, 'mod_queue', 'open', 50), /Staff only/);
    await denied(() => rpc(mallory, 'mod_action', 'review', reviewId, 'hide', 'self-promotion attempt'), /Staff only/);
    await denied(() => kit.as(mallory, () => db.query(`insert into public.campusmy_staff(user_id) values ($1)`, [mallory.id])), /permission denied/);
  }
});

console.log(`\n${count}/${count} permission-audit checks passed`);
await db.close();
