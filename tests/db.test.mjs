// Isolated database tests for CampusMY's Supabase SQL, run on PGlite (PostgreSQL 17 in WebAssembly).
// dbkit.mjs provides an `auth` schema shim for Supabase Auth; each scenario runs as a separate test
// user through `set role authenticated` + a JWT subject claim, the way PostgREST does.
import { bootDatabase, lit, SIG } from './dbkit.mjs';

const kit = await bootDatabase();
const { db } = kit;
const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log(`\n== ${name}`); }
function check(name, ok, detail = '') {
  results.push({ suite: currentSuite, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  -> ' + detail}`);
}
async function expectError(name, fn, pattern) {
  try { await fn(); check(name, false, 'no error raised'); }
  catch (e) { const ok = pattern ? pattern.test(e.message) : true; check(name, ok, ok ? '' : `unexpected error: ${e.message}`); return e; }
}

console.log('schema loaded');

// ---------- identity helpers ----------
const as = (user, fn) => kit.as(user ?? kit.ANON, fn);
async function rpc(name, ...args) {
  const types = SIG[name];
  const { rows } = await db.query(`select public.cm_${name}(${args.map((x, i) => lit(x, types[i])).join(', ')}) as r`);
  return rows[0].r;
}
const newUser = kit.newUser, createProfile = kit.createProfile;

const alice = await newUser('alice@test.local'), bob = await newUser('bob@test.local'), carol = await newUser('carol@test.local', false), dave = await newUser('dave@test.local'), eve = await newUser('eve@test.local');
for (const u of [alice, bob, carol, dave, eve]) await createProfile(u, u === bob ? 'Bob Tan' : '');

// ---------- A. accounts, private rows and plan separation ----------
suite('A. Private rows, RLS and optimistic plan saves');
const plan = { 'Kampar|October 2026': { active: 'plan-1', plans: [{ id: 'plan-1', name: 'Alice plan', entries: [] }] } };
await as(alice, async () => {
  const v1 = (await db.query(`select public.campusmy_save_planner($1::jsonb, 0) as v`, [JSON.stringify(plan)])).rows[0].v;
  check('first online save creates version 1', String(v1) === '1', `got ${v1}`);
  const v2 = (await db.query(`select public.campusmy_save_planner($1::jsonb, 1) as v`, [JSON.stringify(plan)])).rows[0].v;
  check('save with expected version 1 bumps to 2', String(v2) === '2', `got ${v2}`);
  await expectError('stale save (expected 1 after 2) is rejected', () => db.query(`select public.campusmy_save_planner($1::jsonb, 1)`, [JSON.stringify(plan)]), /Planner changed online/);
  await expectError('second initial save (expected 0) is rejected once a copy exists', () => db.query(`select public.campusmy_save_planner($1::jsonb, 0)`, [JSON.stringify(plan)]), /Planner changed online/);
  await db.query(`insert into public.campusmy_todos(user_id, title) values ($1, 'Alice task')`, [alice.id]);
  const own = (await db.query(`select count(*)::int as n from public.campusmy_planners`)).rows[0].n;
  check('owner sees own planner row', own === 1, `rows ${own}`);
});
await as(bob, async () => {
  const planners = (await db.query(`select count(*)::int as n from public.campusmy_planners`)).rows[0].n;
  const todos = (await db.query(`select count(*)::int as n from public.campusmy_todos`)).rows[0].n;
  const profiles = (await db.query(`select count(*)::int as n from public.campusmy_profiles`)).rows[0].n;
  check('other user sees no planner rows', planners === 0, `rows ${planners}`);
  check('other user sees no todo rows', todos === 0, `rows ${todos}`);
  check('other user sees only own profile', profiles === 1, `rows ${profiles}`);
  const upd = await db.query(`update public.campusmy_planners set payload='{}'::jsonb where user_id=$1`, [alice.id]);
  check('other user cannot update a foreign planner (0 rows)', upd.affectedRows === 0, `affected ${upd.affectedRows}`);
  await expectError('other user cannot insert a planner for someone else', () => db.query(`insert into public.campusmy_planners(user_id,payload) values ($1,'{}'::jsonb)`, [alice.id]), /row-level security/);
  await expectError('other user cannot spoof a save for someone else via the save function', () => db.query(`update public.campusmy_todos set title='x' where user_id=$1 returning 1`, [alice.id]).then(r => { if (r.rows.length) throw Error('updated'); else throw Error('row-level security hid the row'); }), /row-level security/);
  const v = (await db.query(`select public.campusmy_save_planner('{}'::jsonb, 0) as v`)).rows[0].v;
  check('other user gets an independent planner (version 1)', String(v) === '1', `got ${v}`);
});
await as(null, async () => {
  await expectError('anonymous cannot read profiles', () => db.query(`select * from public.campusmy_profiles`), /permission denied/);
  await expectError('anonymous cannot call social functions', () => rpc('friends'), /permission denied/);
  await expectError('anonymous cannot save a planner', () => db.query(`select public.campusmy_save_planner('{}'::jsonb, 0)`), /permission denied|Sign in required/);
});
await as(carol, async () => {
  await expectError('unconfirmed email cannot use social functions', () => rpc('friends'), /confirmed email/);
});

// ---------- B. friend requests ----------
suite('B. Friend requests, acceptance, invitations, blocking');
let fAB;
await as(alice, async () => {
  const p = await rpc('find_person', 'bob');
  check('find_person by exact user ID returns the person', p && p.id === bob.id && p.name === 'Bob Tan', JSON.stringify(p));
  check('find_person is case-insensitive and trims', (await rpc('find_person', '  BOB '))?.id === bob.id);
  check('find_person never returns yourself', (await rpc('find_person', 'alice')) === null);
  check('find_person returns null for unknown', (await rpc('find_person', 'nobody')) === null);
  fAB = await rpc('request_friend', bob.id);
  const mine = await rpc('friends');
  const row = mine.items.find(i => i.id === fAB);
  check('requester sees pending outgoing request', row && row.status === 'pending' && row.incoming === false, JSON.stringify(row));
  await expectError('requester cannot accept their own request', () => rpc('friend_action', fAB, 'accept'), /cannot be accepted/);
  await expectError('cannot befriend yourself', () => rpc('request_friend', alice.id), /unavailable/);
});
await as(bob, async () => {
  const row = (await rpc('friends')).items.find(i => i.id === fAB);
  check('recipient sees the request as incoming', row && row.incoming === true && row.status === 'pending', JSON.stringify(row));
  await expectError('recipient cannot chat before accepting', () => rpc('send_message', fAB, 'hi'), /accepted friends only/);
  await rpc('friend_action', fAB, 'accept');
  const after = (await rpc('friends')).items.find(i => i.id === fAB);
  check('acceptance makes the friendship accepted for the recipient', after?.status === 'accepted');
});
await as(dave, async () => {
  await expectError('a third party cannot act on someone else\'s friendship', () => rpc('friend_action', fAB, 'remove'), /not found/);
});
await as(alice, async () => {
  const after = (await rpc('friends')).items.find(i => i.id === fAB);
  check('acceptance is visible to the requester', after?.status === 'accepted');
  const again = await rpc('request_friend', bob.id);
  check('re-requesting an accepted friend returns the same friendship unchanged', again === fAB && (await rpc('friends')).items.find(i => i.id === fAB).status === 'accepted');
});
// invitation link flow
let token;
await as(alice, async () => { const inv = await rpc('my_invite', false); token = inv.token; check('my_invite returns a token with an expiry', !!inv.token && new Date(inv.expires_at) > new Date()); });
await as(dave, async () => {
  const p = await rpc('resolve_invite', token);
  check('a friend can resolve the invitation to the owner', p?.id === alice.id, JSON.stringify(p));
});
await as(alice, async () => {
  await expectError('owner cannot use their own invitation', () => rpc('resolve_invite', token), /your own invitation/);
  const rotated = await rpc('my_invite', true);
  check('rotating issues a new token', rotated.token !== token);
});
await as(dave, async () => {
  await expectError('old token is invalid after rotation', () => rpc('resolve_invite', token), /expired or was replaced/);
  await expectError('random token is rejected', () => rpc('resolve_invite', '00000000-0000-4000-8000-000000000000'), /expired or was replaced/);
});
// decline, re-request, remove
let fDA;
await as(dave, async () => { fDA = await rpc('request_friend', alice.id); });
await as(alice, async () => {
  await rpc('friend_action', fDA, 'decline');
  check('declined request disappears from the recipient list', !(await rpc('friends')).items.some(i => i.id === fDA));
});
await as(dave, async () => {
  check('declined request disappears from the requester list', !(await rpc('friends')).items.some(i => i.id === fDA));
  const again = await rpc('request_friend', alice.id);
  const row = (await rpc('friends')).items.find(i => i.id === again);
  check('re-request after decline reuses the row as a fresh pending request', again === fDA && row?.status === 'pending' && row.incoming === false, JSON.stringify(row));
});
// the dead end: bob sends alice a request? (already friends) -> use dave/eve instead
let fED;
await as(eve, async () => { fED = await rpc('request_friend', dave.id); });
await as(dave, async () => {
  const r = await rpc('request_friend', eve.id);
  const row = (await rpc('friends')).items.find(i => i.id === r);
  check('UI dead end: requesting someone who already requested you does NOT accept (stays pending incoming)', r === fED && row.status === 'pending' && row.incoming === true, JSON.stringify(row));
  await rpc('friend_action', fED, 'accept');
});
// blocking
await as(bob, async () => {
  const fBE = await rpc('request_friend', eve.id);
  await rpc('block_person', eve.id, true);
  check('blocking removes the friendship from the blocker\'s list', !(await rpc('friends')).items.some(i => i.id === fBE));
});
await as(eve, async () => {
  await expectError('a blocked person cannot request the blocker', () => rpc('request_friend', bob.id), /unavailable/);
  check('a blocked person cannot find the blocker', (await rpc('find_person', 'bob')) === null);
});

// ---------- C. sharing ----------
suite('C. Optional reciprocal sharing and revocation');
const alicePlan = { name: 'Alice week', campus: 'Kampar', term: 'October 2026', entries: [{ name: 'Calculus', code: 'UCCM1153', groups: 'Lecture 1', meetings: [{ day: 'Mon', start: 540, end: 660, room: 'KB101', lecturer: 'Dr A', weekNumbers: [1, 2, 3] }] }] };
await as(alice, async () => {
  await rpc('publish_plan', alicePlan);
  const me = await rpc('friends');
  check('publishing enables sharing for the owner', me.sharing?.enabled === true && me.sharing.plan.name === 'Alice week');
  check('owner sees nothing from a friend who has not shared', (await rpc('get_friend_plan', bob.id)) === null);
});
await as(bob, async () => {
  const shared = await rpc('get_friend_plan', alice.id);
  check('accepted friend can read the shared plan (read-only payload with person)', shared?.plan?.entries?.length === 1 && shared.person?.id === alice.id, JSON.stringify(shared)?.slice(0, 120));
  { const m = shared.plan.entries[0].meetings[0]; check('shared payload keeps day/start/end/room/lecturer/weeks', m.day === 'Mon' && m.start === 540 && m.end === 660 && m.room === 'KB101' && m.lecturer === 'Dr A' && JSON.stringify(m.weekNumbers) === '[1,2,3]', JSON.stringify(m)); }
  await rpc('publish_plan', { ...alicePlan, name: 'Bob week' });
});
await as(alice, async () => {
  check('sharing is reciprocal but independent: alice now sees bob\'s plan', (await rpc('get_friend_plan', bob.id))?.plan?.name === 'Bob week');
  await rpc('friend_action', fAB, 'pause');
});
await as(bob, async () => {
  check('per-friend pause hides the plan from that friend immediately', (await rpc('get_friend_plan', alice.id)) === null);
  const row = (await rpc('friends')).items.find(i => i.id === fAB);
  check('friend list reports their_sharing=false after the pause', row.their_sharing === false && row.my_sharing === true, JSON.stringify(row));
});
await as(alice, async () => {
  check('pausing one friend does not affect what alice can see', (await rpc('get_friend_plan', bob.id))?.plan?.name === 'Bob week');
  await rpc('friend_action', fAB, 'resume');
});
await as(bob, async () => check('resume restores access', (await rpc('get_friend_plan', alice.id))?.plan?.name === 'Alice week'));
await as(alice, async () => { await rpc('pause_sharing'); check('stop sharing with everyone flips enabled=false', (await rpc('friends')).sharing.enabled === false); });
await as(bob, async () => check('global stop hides the plan immediately', (await rpc('get_friend_plan', alice.id)) === null));
await as(alice, async () => { await rpc('publish_plan', alicePlan); });
await as(dave, async () => {
  await expectError('a non-friend cannot read a shared plan', () => rpc('get_friend_plan', alice.id), /Accept a friend request/);
});
let fCarolLike;
await as(eve, async () => { fCarolLike = await rpc('request_friend', alice.id); });
await as(eve, async () => {
  await expectError('a pending (not accepted) requester cannot read the plan', () => rpc('get_friend_plan', alice.id), /Accept a friend request/);
});
await as(alice, async () => { await rpc('friend_action', fCarolLike, 'decline'); });
await as(bob, async () => {
  await rpc('friend_action', fAB, 'remove');
  await expectError('after removal the plan is no longer readable', () => rpc('get_friend_plan', alice.id), /Accept a friend request/);
  await expectError('after removal chat is closed', () => rpc('send_message', fAB, 'still there?'), /accepted friends only/);
});
// restore friendship for the chat tests
await as(bob, async () => { fAB = await rpc('request_friend', alice.id); });
await as(alice, async () => { await rpc('friend_action', fAB, 'accept'); });
// payload validation
await as(alice, async () => {
  await expectError('plan with an invalid campus is rejected', () => rpc('publish_plan', { ...alicePlan, campus: 'Mars' }), /Invalid timetable/);
  await expectError('meeting with end before start is rejected', () => rpc('publish_plan', { ...alicePlan, entries: [{ name: 'x', meetings: [{ day: 'Mon', start: 600, end: 540 }] }] }), /Invalid class time/);
  await expectError('meeting with an invalid day is rejected', () => rpc('publish_plan', { ...alicePlan, entries: [{ name: 'x', meetings: [{ day: 'Funday', start: 540, end: 600 }] }] }), /Invalid meeting/);
  await expectError('teaching week 99 is rejected', () => rpc('publish_plan', { ...alicePlan, entries: [{ name: 'x', meetings: [{ day: 'Mon', start: 540, end: 600, weekNumbers: [99] }] }] }), /Invalid teaching week/);
  await expectError('more than 80 entries is rejected', () => rpc('publish_plan', { ...alicePlan, entries: Array.from({ length: 81 }, () => ({ name: 'x', meetings: [] })) }), /too large/);
  await expectError('internal cm_clean_plan is not callable by users', () => rpc('clean_plan', alicePlan), /permission denied/);
});
{ const cleaned = await rpc('clean_plan', { ...alicePlan, entries: [{ name: 'x', code: 'c'.repeat(200), meetings: [{ day: 'Mon', start: 540, end: 600, room: 'r'.repeat(200) }] }] });
  check('oversized room/code strings are truncated, not rejected', cleaned.entries[0].code.length === 80 && cleaned.entries[0].meetings[0].room.length === 100); }

// ---------- D. chat ----------
suite('D. Private chat and unread counts');
await as(alice, async () => { await rpc('send_message', fAB, 'Hi Bob, free on Tuesday?'); });
await as(bob, async () => {
  const row = (await rpc('friends')).items.find(i => i.id === fAB);
  check('recipient sees 1 unread', Number(row.unread) === 1, `unread ${row.unread}`);
  const msgs = await rpc('messages', fAB, null);
  check('messages come back oldest-first with mine=false for the other side', msgs.length === 1 && msgs[0].mine === false && msgs[0].body.startsWith('Hi Bob'));
  check('opening the thread clears the unread count', Number((await rpc('friends')).items.find(i => i.id === fAB).unread) === 0);
});
await as(alice, async () => {
  check('sender has no unread for own messages', Number((await rpc('friends')).items.find(i => i.id === fAB).unread) === 0);
  await rpc('send_message', fAB, 'second'); await rpc('send_message', fAB, 'third');
});
await as(bob, async () => {
  check('unread accumulates (2)', Number((await rpc('friends')).items.find(i => i.id === fAB).unread) === 2);
  const all = await rpc('messages', fAB, null);
  const older = await rpc('messages', fAB, all[0].created_at);
  check('loading older messages does not fail when none remain', Array.isArray(older) && older.length === 0);
});
await as(dave, async () => {
  await expectError('a non-participant cannot read a thread', () => rpc('messages', fAB, null), /accepted friends only/);
  await expectError('a non-participant cannot post into a thread', () => rpc('send_message', fAB, 'intrude'), /accepted friends only/);
});
await as(alice, async () => {
  const e = await expectError('whitespace-only message is rejected by the database', () => rpc('send_message', fAB, '   '));
  check('whitespace-only message error is a raw check-constraint message (UI shows it verbatim)', /check constraint/.test(e?.message || ''), e?.message);
  for (let i = 0; i < 27; i++) await rpc('send_message', fAB, 'msg ' + i); // 3 already sent this minute
  await expectError('31st message within a minute is rate limited', () => rpc('send_message', fAB, 'one too many'), /wait before sending/);
});
await as(bob, async () => {
  const page = await rpc('messages', fAB, null);
  check('a thread longer than 50 returns the newest 50 ascending', page.length === 30 || page.length === 50, `got ${page.length}`);
});

// ---------- E. reviews ----------
suite('E. Course reviews by the correct author');
const course = (await db.query(`select t.course_key, t.term, t.name from public.campusmy_social_teachers t join public.campusmy_social_courses c using(course_key) where c.campus='Kampar' order by t.course_key, t.term limit 1`)).rows[0];
console.log('review course:', course);
let reviewId;
await as(alice, async () => {
  reviewId = await rpc('save_review', course.course_key, course.term, course.name, 5, 4, 'Moderate', ['Tests', 'Assignments'], 'Clear lectures, fair workload overall.', 'Start the assignment early.', true);
  const space = await rpc('course_social', course.course_key, course.term);
  const r = space.reviews.find(x => x.id === reviewId);
  check('author sees own review with mine=true and anonymous author label', r && r.mine === true && r.author === 'Anonymous student', JSON.stringify(r)?.slice(0, 160));
  check('average is withheld below five reviews', space.stats.count === 1 && space.stats.average === null, JSON.stringify(space.stats));
  const again = await rpc('save_review', course.course_key, course.term, course.name, 3, 3, 'Heavy', ['Final exam'], 'Edited: heavier than expected.', '', false);
  const edited = (await rpc('course_social', course.course_key, course.term)).reviews.find(x => x.id === again);
  check('saving again for the same course/term/lecturer edits in place (same id)', again === reviewId && edited.body.startsWith('Edited') && edited.overall === 3);
  check('turning anonymous off shows the display name/username', edited.author === 'alice', edited.author);
  const second = await rpc('save_review', course.course_key, course.term, '', 4, 4, 'Light', [], 'Course-level experience without a lecturer.', '', true);
  check('a course-level review (no lecturer) is a separate review', second !== reviewId);
  await expectError('unknown lecturer is rejected', () => rpc('save_review', course.course_key, course.term, 'Prof Nobody', 4, 4, 'Light', [], 'text long enough here', '', true), /published lecturer/);
  await expectError('invalid assessment label is rejected', () => rpc('save_review', course.course_key, course.term, '', 4, 4, 'Light', ['Vibes'], 'text long enough here', '', true), /Invalid assessment/);
  await expectError('too-short body is rejected', () => rpc('save_review', course.course_key, 'June 2026', '', 4, 4, 'Light', [], 'short', '', true), /check constraint|violates/);
  await expectError('unknown course key is rejected', () => rpc('course_social', 'Kampar|NOPE0000', course.term), /not in the reviewed catalogue/);
  await expectError('author cannot report own review', () => rpc('report_review', reviewId, 'testing'), /cannot be reported/);
});
await as(bob, async () => {
  const space = await rpc('course_social', course.course_key, course.term);
  const r = space.reviews.find(x => x.id === reviewId);
  check('another student sees the review with mine=false', r && r.mine === false);
  await rpc('delete_review', reviewId);
  check('another student cannot delete someone else\'s review', (await rpc('course_social', course.course_key, course.term)).reviews.some(x => x.id === reviewId));
  await rpc('report_review', reviewId, 'Contains a lecturer\'s phone number');
  await expectError('students cannot read the moderation report table', () => db.query(`select count(*) from public.campusmy_review_reports`), /permission denied/);
});
const reportRows = (await db.query(`select count(*)::int as n from public.campusmy_review_reports where review_id=$1`, [reviewId])).rows[0].n;
check('report row exists in the database', reportRows === 1, `rows ${reportRows}`);
await db.query(`update public.campusmy_reviews set hidden=true where id=$1`, [reviewId]);
await as(bob, async () => check('a hidden review is not shown to other students', !(await rpc('course_social', course.course_key, course.term)).reviews.some(x => x.id === reviewId)));
await as(alice, async () => check('a hidden review is still visible to its author (flagged)', (await rpc('course_social', course.course_key, course.term)).reviews.find(x => x.id === reviewId)?.hidden === true));
await db.query(`update public.campusmy_reviews set hidden=false where id=$1`, [reviewId]);
for (const [i, u] of [bob, dave, eve].entries()) await as(u, () => rpc('save_review', course.course_key, course.term, course.name, 4 + (i % 2), 4, 'Moderate', [], `Review number ${i} with enough words.`, '', true));
await as(alice, async () => {
  const stats = (await rpc('course_social', course.course_key, course.term)).stats;
  check('average appears once five reviews exist', stats.count === 5 && typeof stats.average === 'number', JSON.stringify(stats));
  const recent = await rpc('recent_reviews');
  check('recent reviews carry course code/name for the home page', recent.length >= 1 && recent[0].code && recent[0].course);
  const mine = await rpc('my_reviews');
  check('my_reviews lists only the caller\'s reviews', mine.length === 2 && mine.every(r => r.mine));
  await rpc('delete_review', reviewId);
  check('author can delete own review', !(await rpc('course_social', course.course_key, course.term)).reviews.some(x => x.id === reviewId));
});

// ---------- F. study groups ----------
suite('F. Study groups: requests, approval, capacity');
let groupId;
await as(alice, async () => {
  groupId = await rpc('create_group', course.course_key, course.term, 'Tuesday revision', 'Revision sessions', 'On campus', 'Library L2', 'English', 2);
  const g = (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId);
  check('organiser is counted as the first accepted member', g.count === 1 && g.mine === true && g.my_status === 'accepted', JSON.stringify(g)?.slice(0, 200));
  await expectError('organiser cannot leave their own group', () => rpc('group_action', groupId, 'leave'), /Close your group/);
});
await as(bob, async () => {
  await rpc('group_action', groupId, 'request');
  const g = (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId);
  check('requester sees my_status=pending and no member list', g.my_status === 'pending' && g.members.length === 0, JSON.stringify(g.members));
  await expectError('a non-organiser cannot approve', () => rpc('group_action', groupId, 'approve', bob.id), /Only the organiser/);
});
await as(dave, () => rpc('group_action', groupId, 'request'));
await as(alice, async () => {
  const g = (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId);
  check('organiser sees pending requests in the member list', g.members.filter(m => m.status === 'pending').length === 2);
  await rpc('group_action', groupId, 'approve', bob.id);
  await expectError('approving beyond capacity (2 incl. organiser) is refused', () => rpc('group_action', groupId, 'approve', dave.id), /full/);
});
await as(eve, async () => {
  await expectError('requesting to join a full group is refused', () => rpc('group_action', groupId, 'request'), /full/);
});
await as(carol, async () => {
  await expectError('unconfirmed account cannot touch groups', () => rpc('group_action', groupId, 'request'), /confirmed email/);
});
await as(bob, async () => {
  const g = (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId);
  check('accepted member sees accepted members only (not pending)', g.my_status === 'accepted' && g.members.every(m => m.status === 'accepted') && g.members.length === 2, JSON.stringify(g.members));
  await rpc('group_action', groupId, 'leave');
});
await as(alice, async () => {
  check('leaving frees a seat', (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId).count === 1);
  await rpc('group_action', groupId, 'approve', dave.id);
  check('a pending request can then be approved', (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId).count === 2);
  await rpc('group_action', groupId, 'close');
});
await as(eve, async () => {
  await expectError('joining a closed group is refused', () => rpc('group_action', groupId, 'request'), /closed/);
  check('closed groups are hidden from non-members', !(await rpc('course_social', course.course_key, course.term)).groups.some(x => x.id === groupId));
});
await as(alice, async () => {
  await rpc('group_action', groupId, 'reopen');
  check('reopen restores an active group with a fresh 30-day window', (await rpc('course_social', course.course_key, course.term)).groups.find(x => x.id === groupId).active === true);
  for (let i = 0; i < 4; i++) await rpc('create_group', course.course_key, course.term, `Group ${i}`, 'Study partner', 'Online', '', '', 3);
  await expectError('a sixth active group is refused', () => rpc('create_group', course.course_key, course.term, 'Sixth', 'Study partner', 'Online', '', '', 3), /up to five/);
});
// classmates
await as(bob, async () => {
  await rpc('classmate', course.course_key, course.term, 'Lecture 1', 'Study partner', 'Evenings', true);
  const c = (await rpc('course_social', course.course_key, course.term)).classmates;
  check('opt-in classmate listing appears with mine=true', c.some(x => x.mine && x.looking_for === 'Study partner'));
  await rpc('classmate', course.course_key, course.term, '', 'Study partner', '', false);
  check('hiding the listing removes it', !(await rpc('course_social', course.course_key, course.term)).classmates.some(x => x.mine));
});

// ---------- summary ----------
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log(` - [${f.suite}] ${f.name} ${f.detail ? '-> ' + f.detail : ''}`); }
await db.close();
process.exit(failed.length ? 1 : 0);
