// Shared helpers: boot the CampusMY schema on PGlite with a Supabase-style auth shim and
// call cm_* functions as a given user, the way PostgREST would (set role + JWT subject claim).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '');

export const SIG = {
  find_person: ['text'], my_invite: ['boolean'], resolve_invite: ['uuid'], request_friend: ['uuid'], friend_action: ['uuid', 'text'],
  block_person: ['uuid', 'boolean'], publish_plan: ['jsonb'], pause_sharing: [], get_friend_plan: ['uuid'], friends: [],
  messages: ['uuid', 'timestamptz'], send_message: ['uuid', 'text'], course_social: ['text', 'text'],
  save_review: ['text', 'text', 'text', 'int', 'int', 'text', 'text[]', 'text', 'text', 'boolean'], delete_review: ['uuid'],
  report_review: ['uuid', 'text'], recent_reviews: [], my_reviews: [], classmate: ['text', 'text', 'text', 'text', 'text', 'boolean'],
  create_group: ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'int'], group_action: ['uuid', 'text', 'uuid'], clean_plan: ['jsonb'],
};
// PostgREST parameter names, in signature order, so the app's {p_x: ...} objects can be mapped.
export const PARAMS = {
  find_person: ['p_username'], my_invite: ['p_rotate'], resolve_invite: ['p_token'], request_friend: ['p_target'], friend_action: ['p_friendship', 'p_action'],
  block_person: ['p_target', 'p_block'], publish_plan: ['p_plan'], pause_sharing: [], get_friend_plan: ['p_target'], friends: [],
  messages: ['p_friendship', 'p_before'], send_message: ['p_friendship', 'p_body'], course_social: ['p_course', 'p_term'],
  save_review: ['p_course', 'p_term', 'p_lecturer', 'p_overall', 'p_teaching', 'p_workload', 'p_assessments', 'p_body', 'p_advice', 'p_anonymous'], delete_review: ['p_id'],
  report_review: ['p_id', 'p_reason'], recent_reviews: [], my_reviews: [], classmate: ['p_course', 'p_term', 'p_groups', 'p_looking', 'p_note', 'p_visible'],
  create_group: ['p_course', 'p_term', 'p_title', 'p_purpose', 'p_mode', 'p_meeting', 'p_language', 'p_capacity'], group_action: ['p_group', 'p_action', 'p_person'], clean_plan: ['p_plan'],
};

const roomRpcs = {
  room_list: [['text','text','text','text','boolean'], ['p_scope','p_campus','p_category','p_query','p_mine']],
  room_detail: [['uuid'], ['p_room']],
  room_create: [['text','text','text','text','text','int'], ['p_scope','p_campus','p_category','p_title','p_description','p_capacity']],
  room_join: [['uuid'], ['p_room']], room_leave: [['uuid'], ['p_room']],
  room_messages: [['uuid','bigint'], ['p_room','p_before']], room_send: [['uuid','text'], ['p_room','p_body']],
  room_members: [['uuid'], ['p_room']], room_manage: [['uuid','text','uuid'], ['p_room','p_action','p_target']],
  room_mute: [['uuid','boolean'], ['p_room','p_muted']], room_report: [['uuid','text'], ['p_message','p_reason']],
};
for (const [name, [types, params]] of Object.entries(roomRpcs)) { SIG[name] = types; PARAMS[name] = params; }

export const lit = (v, type) => {
  if (v === null || v === undefined) return `null::${type}`;
  if (type === 'jsonb') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  if (type === 'text[]') return `array[${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(',')}]::text[]`;
  if (type === 'int') return `${Number(v)}::int`;
  if (type === 'boolean') return `${v ? 'true' : 'false'}`;
  return `'${String(v).replace(/'/g, "''")}'::${type}`;
};

export async function bootDatabase() {
  const db = new PGlite();
  await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`);
  await db.exec(readFileSync(`${REPO}/CampusMY-supabase-setup.sql`, 'utf8'));
  await db.exec(readFileSync(`${REPO}/CampusMY-social-setup.sql`, 'utf8'));
  await db.exec(readFileSync(`${REPO}/supabase/20261116_chat_rooms.sql`, 'utf8'));

  // identity: null = no role switch (test code acting as the database owner), ANON = anonymous web visitor,
  // a user object = that signed-in account.
  const ANON = Symbol('anon');
  let active = null;
  async function identify(user) {
    active = user;
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user && user !== ANON ? user.id : '']);
    if (user === ANON) await db.exec('set role anon');
    else if (user) await db.exec('set role authenticated');
  }
  // One connection is shared by the test code and the app under test, so identity switches are serialised.
  let chain = Promise.resolve();
  const lock = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  async function as(user, fn) {
    return lock(async () => {
      const prev = active;
      await identify(user);
      try { return await fn(); } finally { await identify(prev); }
    });
  }
  async function rpcAs(user, name, ...args) {
    const types = SIG[name];
    if (!types) throw new Error(`unknown rpc cm_${name}`);
    const sql = `select public.cm_${name}(${args.map((a, i) => lit(a, types[i])).join(', ')}) as r`;
    return as(user, async () => (await db.query(sql)).rows[0].r);
  }
  // PostgREST-style call with a named-argument object, as the app sends it.
  async function rpcNamedAs(user, fullName, args = {}) {
    const name = fullName.replace(/^cm_/, '');
    const order = PARAMS[name];
    if (!order) throw new Error(`unknown rpc ${fullName}`);
    return rpcAs(user, name, ...order.map(k => (k in args ? args[k] : null)));
  }
  async function newUser(email, confirmed = true) {
    const { rows } = await db.query(`insert into auth.users(email, email_confirmed_at) values ($1, ${confirmed ? 'now()' : 'null'}) returning id`, [email]);
    return { id: rows[0].id, email, name: email.split('@')[0], confirmed };
  }
  async function createProfile(user, display = '') {
    return as(user, () => db.query(`insert into public.campusmy_profiles(user_id, username, display_name) values ($1, $2, $3)`, [user.id, user.name, display]));
  }
  return { db, as, identify, rpcAs, rpcNamedAs, newUser, createProfile, ANON, get active() { return active; } };
}
