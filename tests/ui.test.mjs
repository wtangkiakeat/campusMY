// Browser-side tests: the real index.html and scripts run in jsdom. A Supabase client stand-in
// translates the app's auth / from() / rpc() calls into SQL on the PGlite test database, as the
// signed-in user, so RLS and the cm_* functions behave as they do behind PostgREST.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { bootDatabase, REPO } from './dbkit.mjs';

const kit = await bootDatabase();
const { db } = kit;
const results = [];
let currentSuite = '';
const suite = n => { currentSuite = n; console.log(`\n== ${n}`); };
const check = (name, ok, detail = '') => { results.push({ suite: currentSuite, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  -> ' + detail}`); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const PASSWORD = 'correct horse battery staple';

// ---------- test accounts ----------
const alice = await kit.newUser('alice@test.local'), bob = await kit.newUser('bob@test.local'), nometa = await kit.newUser('nometa@test.local');
alice.metadata = { username: 'alice' };
const accounts = new Map([[alice.email, alice], [bob.email, bob], [nometa.email, nometa]]);
await kit.createProfile(bob, 'Bob Tan');

// ---------- Supabase client stand-in ----------
let currentUser = null;
const listeners = [];
const sessionOf = u => u ? { user: { id: u.id, email: u.email, email_confirmed_at: u.confirmed ? '2026-01-01T00:00:00Z' : null, user_metadata: u.metadata || {} }, access_token: 'test-token' } : null;
function pgError(e) { return { message: e.message, code: e.code || null, details: e.detail || null, hint: e.hint || null }; }
function builder(table) {
  const q = { table, op: 'select', columns: '*', values: null, filters: [], order: null, mode: 'many' };
  const api = {
    select(cols = '*') { if (q.op === 'select') q.columns = cols; q.returning = true; return api; },
    insert(v) { q.op = 'insert'; q.values = v; return api; },
    upsert(v) { q.op = 'upsert'; q.values = v; return api; },
    update(v) { q.op = 'update'; q.values = v; return api; },
    delete() { q.op = 'delete'; return api; },
    eq(col, val) { q.filters.push([col, val]); return api; },
    order(col, { ascending = true } = {}) { q.order = `${col} ${ascending ? 'asc' : 'desc'}`; return api; },
    single() { q.mode = 'single'; return api; },
    maybeSingle() { q.mode = 'maybe'; return api; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    const params = [];
    const p = v => { params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); return `$${params.length}`; };
    const where = q.filters.length ? ' where ' + q.filters.map(([c, v]) => `${c} = ${p(v)}`).join(' and ') : '';
    let stmt;
    if (q.op === 'select') stmt = `select ${q.columns} from public.${table}${where}${q.order ? ' order by ' + q.order : ''}`;
    else if (q.op === 'insert' || q.op === 'upsert') {
      const cols = Object.keys(q.values);
      const conflict = q.op === 'upsert' ? ` on conflict (user_id) do update set ${cols.filter(c => c !== 'user_id').map(c => `${c} = excluded.${c}`).join(', ')}` : '';
      stmt = `insert into public.${table}(${cols.join(',')}) values (${cols.map(c => p(q.values[c])).join(',')})${conflict} returning *`;
    } else if (q.op === 'update') stmt = `update public.${table} set ${Object.keys(q.values).map(c => `${c} = ${p(q.values[c])}`).join(', ')}${where} returning *`;
    else stmt = `delete from public.${table}${where} returning *`;
    const sql = q.op === 'select' ? `select to_jsonb(x) as row from (${stmt}) x` : `with r as (${stmt}) select to_jsonb(r) as row from r`;
    try {
      const rows = (await kit.as(currentUser ?? kit.ANON, () => db.query(sql, params))).rows.map(r => r.row);
      if (q.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `JSON object requested, multiple (or no) rows returned`, code: 'PGRST116' } };
      if (q.mode === 'maybe') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    } catch (e) { console.error(`   [sql error] ${q.op} ${table}: ${e.message}`); return { data: null, error: pgError(e) }; }
  }
  return api;
}
function rpc(name, args = {}) {
  const promise = (async () => {
    try {
      if (name === 'campusmy_save_planner') {
        const { rows } = await kit.as(currentUser ?? kit.ANON, () => db.query(`select public.campusmy_save_planner($1::jsonb, $2::bigint) as v`, [JSON.stringify(args.p_payload), args.p_expected_version]));
        return { data: Number(rows[0].v), error: null };
      }
      return { data: await kit.rpcNamedAs(currentUser ?? kit.ANON, name, args), error: null };
    } catch (e) { return { data: null, error: pgError(e) }; }
  })();
  promise.setHeader = () => promise;
  return promise;
}
function emit(event) { for (const cb of listeners) cb(event, sessionOf(currentUser)); }
const fakeClient = {
  auth: {
    async getSession() { return { data: { session: sessionOf(currentUser) }, error: null }; },
    async getUser() { return { data: { user: sessionOf(currentUser)?.user ?? null }, error: null }; },
    async signInWithPassword({ email, password }) {
      const u = accounts.get(email);
      if (!u || password !== PASSWORD) return { data: { session: null }, error: { message: 'Invalid login credentials' } };
      currentUser = u; emit('SIGNED_IN'); return { data: { session: sessionOf(u) }, error: null };
    },
    async signOut() { currentUser = null; emit('SIGNED_OUT'); return { error: null }; },
    async signUp({ email, options }) { const u = await kit.newUser(email, false); u.metadata = options?.data; accounts.set(email, u); return { data: { session: null, user: { id: u.id } }, error: null }; },
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async resend() { return { error: null }; }, async resetPasswordForEmail() { return { error: null }; }, async updateUser() { return { error: null }; },
  },
  from: builder, rpc,
};

// ---------- jsdom boot ----------
const html = readFileSync(`${REPO}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:4173/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
if (!window.crypto?.randomUUID) Object.defineProperty(window, 'crypto', { value: globalThis.crypto });
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
Object.defineProperty(window.HTMLDialogElement.prototype, 'open', { get() { return this.hasAttribute('open'); }, set(v) { v ? this.setAttribute('open', '') : this.removeAttribute('open'); }, configurable: true });
window.qrcode = () => ({ addData() {}, make() {}, createSvgTag: () => '<svg></svg>' });
window.supabase = { createClient: () => fakeClient };
for (const f of ['data.js', 'core.js', 'config.js', 'account-core.js', 'app.js', 'account.js', 'shell.js', 'social-core.js', 'chat.js', 'social.js']) window.eval(readFileSync(`${REPO}/${f}`, 'utf8'));
await tick(50);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const A = window.CampusAccount, P = window.CampusPlanner, D = window.CAMPUS_DATA, C = window.CampusCore;
const sectionMap = new Map(D.sections.map(s => [s.id, s]));
const modalTitle = () => $('#modal[open] #modal-title')?.textContent || '';
const toastText = () => $('#toast').textContent;
const go = async hash => { window.location.hash = hash; await tick(30); };
const click = sel => { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) throw new Error(`no element ${sel}`); el.click(); };
const submit = form => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const planKey = id => 'campusmy-timetable-v2' + (id ? ':' + id : '');
const storedEntries = id => { try { return Object.values(JSON.parse(window.localStorage.getItem(planKey(id)) || '{}')).flatMap(s => s.plans.flatMap(p => p.entries)); } catch { return []; } };
const offeringsOf = term => D.offerings.filter(o => o.term === term && o.campus === 'Kampar');
const firstSections = o => { const by = {}; for (const id of o.sectionIds) { const s = sectionMap.get(id); if (!by[s.type]) by[s.type] = s; } return Object.values(by); };
const meetingsOf = o => firstSections(o).flatMap(s => s.meetings);
const overlapsAny = (a, b) => a.some(x => b.some(y => C.overlaps(x, y)));
const ensureListed = async id => { for (let i = 0; i < 10 && !$(`[data-action="expand"][data-value="${id}"]`); i++) { const more = $('[data-action="more"]'); if (!more) break; more.click(); await tick(20); } if (!$(`[data-action="expand"][data-value="${id}"]`)) throw new Error('offering not listed: ' + id); };
const expandOffering = async id => { await ensureListed(id); if (!$(`[data-action="add"][data-value="${id}"]`)) { click(`[data-action="expand"][data-value="${id}"]`); await tick(20); } };
const addOffering = async id => { await expandOffering(id); click(`[data-action="add"][data-value="${id}"]`); await tick(30); };

// ---------- 1. guest planner and account separation ----------
suite('1. Sign-in, sign-out and separation of saved plans');
await go('#timetable');
check('app boots as a guest on the timetable page', document.body.dataset.page === 'timetable' && !A.state.user);
const oct = offeringsOf('October 2026');
const base = oct[0];
click('[data-social="explorer"]'); await tick(20);
await addOffering(base.id);
check('guest can add a class from the explorer', $('#class-count').textContent === '1 class' && storedEntries(null).length === 1, $('#class-count').textContent);
check('guest storage key is the device key', !!window.localStorage.getItem(planKey(null)));
await A.signIn(alice.email, 'wrong password').then(() => check('wrong password is rejected', false), e => check('wrong password is rejected', /Invalid login/.test(e.message), e.message));
await A.signIn(alice.email, PASSWORD); await tick(60);
check('sign-in loads the account and creates its profile row', A.state.user?.id === alice.id && A.state.profile?.user_id === alice.id, `profile=${JSON.stringify(A.state.profile)} problem=${A.state.problem}`);
check('after sign-in the planner shows the account\'s own (empty) plan, not the guest plan', $('#class-count').textContent === '0 classes', $('#class-count').textContent);
check('guest plan is untouched in storage', storedEntries(null).length === 1);
const aliceCourse = oct.find(o => o.id !== base.id && !overlapsAny(meetingsOf(o), meetingsOf(base)));
await addOffering(aliceCourse.id);
check('alice\'s class is stored under her own key', storedEntries(alice.id).length === 1 && storedEntries(null).length === 1, `alice ${storedEntries(alice.id).length}, guest ${storedEntries(null).length}`);
const v = await A.saveOnline().then(() => 'ok', e => e.message);
check('Save online stores a private copy', v === 'ok' && (await db.query(`select count(*)::int as n from public.campusmy_planners where user_id=$1`, [alice.id])).rows[0].n === 1, v);
await A.signOut(); await tick(60);
check('sign-out returns to the guest plan (1 class) and clears the user', !A.state.user && $('#class-count').textContent === '1 class', $('#class-count').textContent);
await A.signIn(bob.email, PASSWORD); await tick(60);
check('a second account starts with its own empty plan', A.state.user?.id === bob.id && $('#class-count').textContent === '0 classes', $('#class-count').textContent);
const bobLoad = await A.loadOnline().then(r => r, e => 'error: ' + e.message);
check('Load online for bob does not return alice\'s copy', bobLoad === null, JSON.stringify(bobLoad)?.slice(0, 80));
await A.signOut(); await tick(60);
await A.signIn(alice.email, PASSWORD); await tick(60);
check('signing back in restores alice\'s own class', $('#class-count').textContent === '1 class', $('#class-count').textContent);
const loaded = await A.loadOnline();
check('Load online returns alice\'s own saved copy', loaded && JSON.stringify(loaded).includes(aliceCourse.id));
await A.signOut(); await tick(60);
await A.signIn(nometa.email, PASSWORD); await tick(80);
check('regression: an account without a username in its auth metadata still gets a profile at sign-in', !!A.state.profile && !A.state.problem, `profile=${JSON.stringify(A.state.profile)} problem=${A.state.problem}`);
await A.signOut(); await tick(60);
await A.signIn(alice.email, PASSWORD); await tick(60);

// ---------- 2. clashes, teaching weeks, group selection ----------
suite('2. Timetable clashes, teaching weeks and group selection');
const have = meetingsOf(aliceCourse);
const clashing = oct.find(o => o.id !== aliceCourse.id && overlapsAny(meetingsOf(o), have));
check('test data contains an overlapping course to try', !!clashing, 'none found');
if (clashing) {
  await addOffering(clashing.id);
  check('adding an overlapping class opens the clash dialog instead of adding', modalTitle() === 'Timetable clash' && $('#class-count').textContent === '1 class', `${modalTitle()} / ${$('#class-count').textContent}`);
  click('[data-action="close"]'); await tick(10);
  check('choosing another group keeps the timetable unchanged', $('#class-count').textContent === '1 class');
  await addOffering(clashing.id);
  click('[data-action="confirm-add"]'); await tick(20);
  check('Add anyway adds the class and marks the overlap', $('#class-count').textContent === '2 classes' && $$('.event.conflict').length >= 2, `${$('#class-count').textContent}, conflicts ${$$('.event.conflict').length}`);
  click(`[data-action="remove"][data-value="${P.getCurrent().plan.entries.find(e => e.offering === clashing.id).id}"]`); await tick(20);
  check('removing the class clears the conflict marks', $$('.event.conflict').length === 0 && $('#class-count').textContent === '1 class');
}
// teaching weeks: a manual class at the same slot but in disjoint weeks must not clash
const m0 = have[0];
const mins = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const otherWeeks = m0.weekNumbers?.length ? (m0.weekNumbers.includes(14) ? '15-16' : '14-16') : '';
click('[data-action="manual"]'); await tick(10);
const form = $('#manual-form');
form.elements.name.value = 'Weeks test'; form.elements.day.value = m0.day; form.elements.start.value = mins(m0.start); form.elements.end.value = mins(m0.end); form.elements.weeks.value = otherWeeks;
submit(form); await tick(20);
check('same slot in disjoint teaching weeks is added without a clash dialog', modalTitle() === '' && $('#class-count').textContent === '2 classes', `${modalTitle()} / ${$('#class-count').textContent} (weeks ${otherWeeks} vs ${m0.weeks})`);
check('and it is not marked as a conflict', $$('.event.conflict').length === 0, `conflicts ${$$('.event.conflict').length}`);
click('[data-action="manual"]'); await tick(10);
const form2 = $('#manual-form');
form2.elements.name.value = 'Overlap test'; form2.elements.day.value = m0.day; form2.elements.start.value = mins(m0.start); form2.elements.end.value = mins(m0.end); form2.elements.weeks.value = String(m0.weekNumbers?.[0] || '');
submit(form2); await tick(20);
check('same slot in a shared teaching week is flagged as a clash', modalTitle() === 'Timetable clash', modalTitle());
click('[data-action="close"]'); await tick(10);
// week filter
click('[data-action="plan-menu"]'); await tick(10); click('[data-action="week-picker"]'); await tick(10);
const weekRadio = $$('input[name="week"]').find(r => r.value === String(otherWeeks.split('-')[0]));
if (weekRadio) { weekRadio.checked = true; weekRadio.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(20); }
const shownCodes = $$('.event strong').map(e => e.textContent);
check('teaching-week filter shows only classes meeting in that week', weekRadio && shownCodes.includes('Weeks test') && !shownCodes.includes(aliceCourse.code), JSON.stringify(shownCodes));
click('[data-action="plan-menu"]'); await tick(10); click('[data-action="week-picker"]'); await tick(10);
const allRadio = $$('input[name="week"]').find(r => r.value === 'all'); allRadio.checked = true; allRadio.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(20);
check('All weeks restores every class block', $$('.event strong').map(e => e.textContent).includes(aliceCourse.code));
// group selection
const multi = oct.find(o => { const byType = {}; for (const id of o.sectionIds) { const s = sectionMap.get(id); byType[s.type] = (byType[s.type] || 0) + 1; } return Object.values(byType).some(n => n > 1); });
if (multi) {
  await expandOffering(multi.id);
  const options = $$(`.section-option[data-offering="${multi.id}"]`);
  const selectedBefore = options.find(o => o.classList.contains('selected'));
  const alternative = options.find(o => !o.classList.contains('selected') && sectionMap.get(o.dataset.value).type === sectionMap.get(selectedBefore.dataset.value).type);
  click(alternative); await tick(20);
  const nowSelected = $$(`.section-option[data-offering="${multi.id}"].selected`).map(o => o.dataset.value);
  check('choosing another group moves the selection', nowSelected.includes(alternative.dataset.value) && !nowSelected.includes(selectedBefore.dataset.value));
  const detailTimes = $$('.meeting-detail .meeting-main strong').map(e => e.textContent);
  const expected = sectionMap.get(alternative.dataset.value).meetings.map(m => `${C.time(m.start)}–${C.time(m.end)}`);
  check('meeting details follow the chosen group', expected.every(t => detailTimes.some(d => d.startsWith(t))), JSON.stringify({ detailTimes, expected }));
  click(`[data-action="add"][data-value="${multi.id}"]`); await tick(20);
  if (modalTitle() === 'Timetable clash') { click('[data-action="confirm-add"]'); await tick(20); }
  const entry = P.getCurrent().plan.entries.find(e => e.offering === multi.id);
  check('the added entry carries the chosen group', entry && entry.sectionIds.includes(alternative.dataset.value), JSON.stringify(entry));
  click(`[data-action="entry"][data-value="${entry.id}"]`); await tick(10);
  check('clicking a saved class opens its details with Change group / Rate & review / Classmates', modalTitle() === multi.code && !!$('[data-action="edit-entry"]') && !!$('[data-social="course"][data-tab="groups"]'));
  click('[data-action="close"]'); await tick(10);
}

// ---------- 3. friends, sharing revocation, chat unread through the UI ----------
suite('3. Friends panel, read-only sharing and chat in the UI');
await A.signOut(); await tick(60); await A.signIn(alice.email, PASSWORD); await tick(60);
await go('#timetable'); await tick(400);
check('friends panel renders for a confirmed account', /Friends/.test($('#friends-panel').textContent) && !!$('#friend-search'));
// bob requests alice from his device
const fBA = await kit.rpcAs(bob, 'request_friend', alice.id);
await tick(5200);
check('polling shows the incoming request within 5s', /Wants to be your friend/.test($('#friends-panel').textContent), $('#friends-panel').textContent.slice(0, 160));
// dead end: alice looks bob up and "adds" him
click('[data-social="add-friend"]'); await tick(10);
const findForm = $('form[data-social-form="find-person"]'); findForm.elements.username.value = 'bob'; submit(findForm); await tick(80);
check('Find student resolves bob', modalTitle() === 'Add friend', modalTitle());
submit($('form[data-social-form="request"]')); await tick(150);
const statusAfter = (await db.query(`select status, recipient from public.campusmy_friendships where id=$1`, [fBA])).rows[0];
const deadEnd = statusAfter.status === 'pending';
check('regression: adding someone who already requested you leaves the request pending (toast claims it was sent)', !deadEnd, `status=${statusAfter.status}, toast="${toastText()}"`);
if (deadEnd) await kit.rpcAs(alice, 'friend_action', fBA, 'accept');
await kit.rpcAs(bob, 'publish_plan', { name: 'Bob week', campus: 'Kampar', term: 'October 2026', entries: [{ name: 'Networks', code: 'UCCN1004', groups: 'L1', meetings: [{ day: 'Tue', start: 600, end: 720, room: 'N105', lecturer: 'Dr B', weekNumbers: [] }] }] });
await tick(5200);
check('accepted friend appears with View timetable / Chat / Manage', !!$('[data-social="view-friend"]') && !!$('[data-social="chat"]') && !!$('[data-social="manage-friend"]'));
click('[data-social="view-friend"]'); await tick(150);
check('friend\'s timetable opens read-only with the shared class', /VIEW ONLY/.test($('#modal').textContent) && /UCCN1004/.test($('#modal').textContent) && !$('#modal [data-action="remove"]'), $('#modal').textContent.slice(0, 120));
await kit.rpcAs(bob, 'pause_sharing');
await tick(5200);
check('revocation reaches the open read-only view within one poll', /sharing is paused/i.test($('#modal').textContent), $('#modal').textContent.slice(0, 120));
click('[data-action="close"]'); await tick(10);
// chat
await kit.rpcAs(bob, 'send_message', fBA, 'Hey Alice, library at 3?');
await tick(5200);
check('unread badge shows 1 after bob messages', $$('.chat-badge').some(b => !b.hidden && b.textContent === '1'), $$('.chat-badge').map(b => b.hidden + ':' + b.textContent).join(','));
await go('#chat/' + fBA); await tick(300);
check('opening the thread shows the message as theirs', $$('#message-list .message').length === 1 && !$('#message-list .message').classList.contains('mine'));
check('and clears the unread badge', $$('.chat-badge').every(b => b.hidden), $$('.chat-badge').map(b => b.hidden + ':' + b.textContent).join(','));
const msgForm = $('form[data-social-form="message"]'); msgForm.elements.body.value = 'Yes! See you there.'; submit(msgForm); await tick(200);
check('sending a reply renders it as mine', $$('#message-list .message.mine').length === 1, `mine ${$$('#message-list .message.mine').length}`);
const unreadForBob = (await kit.rpcAs(bob, 'friends')).items.find(i => i.id === fBA).unread;
check('bob now has 1 unread', Number(unreadForBob) === 1, `unread ${unreadForBob}`);
msgForm.elements.body.value = '   '; submit(msgForm); await tick(200);
const err = $('form[data-social-form="message"] .form-error')?.textContent || '';
check('regression: whitespace-only message shows a raw database constraint error', !/check constraint/.test(err), err.slice(0, 120));

// ---------- 4. Community chat: actual browser scripts + isolated room RPCs ----------
suite('4. Local, Campus and My Chats rooms');
await go('#chat/local'); await tick(150);
check('chat hub has Local, Campus and My Chats without advertising', $$('.chat-hub-tabs a').length===3 && !$('.chat-hub [data-ad]') && /Your people/.test($('#chat-content').textContent));
click('[data-chat="search"]');
check('chat search opens and receives focus', !$('.chat-search-wrap').hidden && document.activeElement.id==='chat-search');
click('[data-chat="settings"]');
check('settings explain campus selection, privacy and room controls', /not verified university enrolment/.test($('#modal').textContent) && /not end-to-end encrypted/.test($('#modal').textContent));
click('[data-action="close"]');
click('[data-chat="create"]');
const roomForm=$('[data-chat-form="create"]');
roomForm.elements.title.value='Browser study circle';roomForm.elements.description.value='Isolated test room';roomForm.elements.category.value='Study';roomForm.elements.capacity.value='3';
submit(roomForm);await tick(250);
const roomId=window.location.hash.split('/')[2];
check('creating a room opens its real conversation as a joined owner', !!roomId && !!$('[data-chat-form="send"]') && /Browser study circle/.test($('#chat-content').textContent));
await kit.rpcAs(bob,'room_join',roomId);
await kit.rpcAs(bob,'room_send',roomId,'Browser test from Bob');await tick(5200);
check('room polling displays another member message without navigation', /Browser test from Bob/.test($('#room-messages').textContent));
const roomSend=$('[data-chat-form="send"]');roomSend.elements.body.value='<img src=x onerror=alert(1)>';submit(roomSend);await tick(150);
check('room messages render HTML as text, not executable markup', !$('#room-messages img') && $('#room-messages').textContent.includes('<img src=x onerror=alert(1)>'));
roomSend.elements.body.value='   ';submit(roomSend);await tick(100);
check('blank room messages show a helpful local validation error', /Type a message/.test(roomSend.querySelector('.form-error').textContent));
click('[data-chat="report"]');const reportForm=$('[data-chat-form="report"]');reportForm.elements.reason.value='Isolated browser report test';submit(reportForm);await tick(150);
check('report action records a private moderation report', modalTitle()==='Report received' && (await db.query('select count(*)::int n from public.campusmy_room_reports')).rows[0].n===1);
click('[data-action="close"]');click('[data-chat="room-menu"]');click('[data-chat="mute"]');await tick(150);
check('mute persists to this member record', (await kit.rpcAs(alice,'room_detail',roomId)).muted===true);
await go('#chat/'+fBA);await tick(150);await kit.rpcAs(alice,'room_manage',roomId,'close',null);await tick(5200);
check('room polling cannot overwrite a private friend thread after navigation', !!$('#message-list') && !$('#room-messages'));
await kit.rpcAs(alice,'room_manage',roomId,'reopen',null);
await go('#chat/my');await tick(200);
check('My Chats contains joined room and existing friend conversation', !!$(`.room-card[href="#chat/room/${roomId}"]`) && !!$(`.dm-card[href="#chat/${fBA}"]`));
await go('#chat/local');await tick(150);click('[data-chat="topic"][data-topic="Gaming"]');await tick(150);
check('topic filtering removes rooms in another category', !$('.room-card'));
click('[data-chat="topic"][data-topic="All"]');await tick(150);click('[data-chat="search"]');
if($('.chat-search-wrap').hidden)click('[data-chat="search"]');
const chatSearch=$('#chat-search');chatSearch.value='does not exist';chatSearch.dispatchEvent(new window.Event('input',{bubbles:true}));await tick(400);
check('search filters actual rooms and preserves typed input', !$('.room-card') && $('#chat-search').value==='does not exist');
await go('#chat/room/'+roomId);await tick(200);click('[data-chat="members"]');await tick(150);
check('member view uses profile names without emails', /Bob Tan/.test($('#modal').textContent) && !$('#modal').textContent.includes(bob.email));
click('[data-chat="confirm-remove"]');click('[data-chat="remove"]');await tick(150);
check('organiser removal blocks the removed account on the server', await kit.rpcAs(bob,'room_messages',roomId,null).then(()=>false,()=>true));
await A.signOut();await tick(100);await A.signIn(bob.email,PASSWORD);await tick(150);
check('switching accounts clears previous room messages and denies removed member', !$('#room-message-input') && !$('#chat-content').textContent.includes('<img src=x onerror=alert(1)>') && /unavailable/.test($('#chat-content').textContent));
await A.signOut();await tick(100);await go('#chat/campus');await tick(100);
check('signed-out students still see the chat navigation but no private data', $$('.chat-hub-tabs a').length===3 && /Sign in/.test($('#room-list').textContent) && !$('#chat-content').textContent.includes('Browser study circle'));

// ---------- summary ----------
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log(` - [${f.suite}] ${f.name} ${f.detail ? '-> ' + f.detail : ''}`); }
window.close();
await db.close();
process.exit(failed.length ? 1 : 0);
