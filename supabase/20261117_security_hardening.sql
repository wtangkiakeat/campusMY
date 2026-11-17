-- CampusMY security and reliability hardening. Apply AFTER the account, social and chat-room setup.
-- Additive and safe to reapply: no existing rows are deleted, no policy is weakened, no grant is widened
-- beyond the functions listed at the end. Rollback notes are in docs/SECURITY.md.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Shared, atomic rate accounting. Each check takes a per-user, per-action transaction lock,
--    so simultaneous requests from many connections cannot exceed the limit.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.campusmy_rate_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 action text not null check(length(action) between 1 and 40),
 created_at timestamptz not null default now()
);
create index if not exists campusmy_rate_events_idx on public.campusmy_rate_events(user_id,action,created_at desc);
alter table public.campusmy_rate_events enable row level security;
revoke all on public.campusmy_rate_events from public,anon,authenticated;
revoke all on sequence public.campusmy_rate_events_id_seq from public,anon,authenticated;

create or replace function public.cm_rate_limit(p_user uuid,p_action text,p_max integer,p_window interval,p_message text)
returns void language plpgsql security definer set search_path='' as $$
declare n integer; oldest timestamptz; wait interval; hint text; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-rate:'||p_action||':'||p_user::text,0));
 delete from public.campusmy_rate_events where user_id=p_user and action=p_action and created_at<now()-p_window;
 select count(*),min(created_at) into n,oldest from public.campusmy_rate_events where user_id=p_user and action=p_action;
 if n>=p_max then
  wait:=greatest(oldest+p_window-now(),interval '1 minute');
  hint:=case when wait<interval '2 minutes' then 'about a minute' when wait<interval '1 hour' then (ceil(extract(epoch from wait)/60))::int||' minutes' else (ceil(extract(epoch from wait)/3600))::int||' hours' end;
  raise exception '% Try again in %.',p_message,hint using errcode='P0001';
 end if;
 insert into public.campusmy_rate_events(user_id,action) values(p_user,p_action);
end $$;
revoke all on function public.cm_rate_limit(uuid,text,integer,interval,text) from public,anon,authenticated;

-- Friend requests: 20 a day, atomic; concurrent A->B and B->A can no longer create duplicate rows or
-- fail with a raw unique-violation.
create or replace function public.cm_request_friend(p_target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;begin
 if p_target=me or public.cm_blocked(me,p_target) or not exists(select 1 from public.campusmy_profiles where user_id=p_target) then raise exception 'That person is unavailable.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-pair:'||least(me,p_target)::text||':'||greatest(me,p_target)::text,0));
 select * into r from public.campusmy_friendships where least(requester,recipient)=least(me,p_target) and greatest(requester,recipient)=greatest(me,p_target) for update;
 if r.id is null then
  perform public.cm_rate_limit(me,'friend_request',20,interval '1 day','Friend request limit reached (20 a day).');
  insert into public.campusmy_friendships(requester,recipient) values(me,p_target) returning * into r;
 elsif r.status='removed' then
  perform public.cm_rate_limit(me,'friend_request',20,interval '1 day','Friend request limit reached (20 a day).');
  update public.campusmy_friendships set requester=me,recipient=p_target,status='pending',requester_shares=true,recipient_shares=true,created_at=now(),responded_at=null where id=r.id returning * into r;
 end if;
 return r.id;
end $$;

-- Account discovery and invitation resolution are bounded.
create or replace function public.cm_find_person(p_username text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();target uuid;begin
 perform public.cm_rate_limit(me,'lookup',60,interval '10 minutes','Too many user ID lookups.');
 select user_id into target from public.campusmy_profiles where lower(username)=lower(trim(p_username));
 if target is null or target=me or public.cm_blocked(me,target) then return null;end if;
 return public.cm_person(target);
end $$;
create or replace function public.cm_resolve_invite(p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();target uuid;begin
 perform public.cm_rate_limit(me,'invite_resolve',30,interval '10 minutes','Too many invitation attempts.');
 select owner into target from public.campusmy_friend_invites where token=p_token and expires_at>now();
 if target is null then raise exception 'This invitation expired or was replaced. Ask your friend for a new link.';end if;
 if target=me then raise exception 'This is your own invitation.';end if;
 if public.cm_blocked(me,target) then raise exception 'This invitation is unavailable.';end if;
 return public.cm_person(target);
end $$;
create or replace function public.cm_my_invite(p_rotate boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friend_invites;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-invite:'||me::text,0));
 select * into r from public.campusmy_friend_invites where owner=me for update;
 if r.owner is null then insert into public.campusmy_friend_invites(owner) values(me) returning * into r;
 elsif p_rotate or r.expires_at<now() then
  perform public.cm_rate_limit(me,'invite_rotate',20,interval '1 day','Invitation link limit reached (20 new links a day).');
  update public.campusmy_friend_invites set token=gen_random_uuid(),expires_at=now()+interval '7 days' where owner=me returning * into r;end if;
 return jsonb_build_object('token',r.token,'expires_at',r.expires_at);
end $$;

-- Reports: bounded per account so a report queue cannot be flooded.
create or replace function public.cm_report_review(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if not exists(select 1 from public.campusmy_reviews where id=p_id and not hidden and owner<>me) then raise exception 'This review cannot be reported.';end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Please give a reason between 3 and 500 characters.';end if;
 perform public.cm_rate_limit(me,'report',20,interval '1 day','Report limit reached (20 a day).');
 insert into public.campusmy_review_reports(review_id,reporter,reason) values(p_id,me,trim(p_reason)) on conflict(review_id,reporter) do update set reason=excluded.reason,status='open',resolved_at=null;
end $$;
create or replace function public.cm_room_report(p_message uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); m public.campusmy_room_messages; begin
 select * into m from public.campusmy_room_messages where id=p_message and not hidden;
 if m.id is null or m.sender=me then raise exception 'This message cannot be reported.'; end if;
 perform public.cm_room_access(m.room_id,true);
 if public.cm_blocked(me,m.sender) then raise exception 'This message is unavailable.'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Please give a reason between 10 and 500 characters.'; end if;
 perform public.cm_rate_limit(me,'report',20,interval '1 day','Report limit reached (20 a day).');
 insert into public.campusmy_room_reports(message_id,reporter,reason) values(m.id,me,btrim(p_reason)) on conflict(message_id,reporter) do update set reason=excluded.reason,status='open',resolved_at=null;
end $$;

-- Reviews: 20 new reviews a day, atomic; edits of an existing review are not rate limited.
create or replace function public.cm_save_review(p_course text,p_term text,p_lecturer text,p_overall int,p_teaching int,p_workload text,p_assessments text[],p_body text,p_advice text,p_anonymous boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();result uuid;begin
 if length(trim(p_term)) not between 1 and 100 then raise exception 'Choose a trimester.';end if;
 if p_lecturer<>'' and not exists(select 1 from public.campusmy_social_teachers where course_key=p_course and term=p_term and name=p_lecturer) then raise exception 'Choose a published lecturer, or review the course without a lecturer.';end if;
 if not (p_assessments <@ array['Assignments','Group work','Presentations','Tests','Practical work','Final exam']::text[]) then raise exception 'Invalid assessment type.';end if;
 if not exists(select 1 from public.campusmy_reviews where owner=me and course_key=p_course and term=p_term and lower(trim(lecturer))=lower(trim(p_lecturer))) then
  perform public.cm_rate_limit(me,'review_create',20,interval '1 day','Review limit reached (20 new reviews a day).');
 end if;
 insert into public.campusmy_reviews(owner,course_key,term,lecturer,overall,teaching,workload,assessments,body,advice,anonymous)
 values(me,p_course,trim(p_term),p_lecturer,p_overall,p_teaching,p_workload,p_assessments,trim(p_body),coalesce(p_advice,''),p_anonymous)
 on conflict(owner,course_key,term,lower(trim(lecturer))) do update set overall=excluded.overall,teaching=excluded.teaching,workload=excluded.workload,assessments=excluded.assessments,body=excluded.body,advice=excluded.advice,anonymous=excluded.anonymous,updated_at=now()
 returning id into result;return result;
end $$;

-- Study groups: the five-active-groups rule is now atomic, plus a creation budget per day.
create or replace function public.cm_create_group(p_course text,p_term text,p_title text,p_purpose text,p_mode text,p_meeting text,p_language text,p_capacity int) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();result uuid;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-groups:'||me::text,0));
 if (select count(*) from public.campusmy_study_groups where owner=me and active and expires_at>now())>=5 then raise exception 'You can organise up to five active groups.';end if;
 perform public.cm_rate_limit(me,'group_create',10,interval '1 day','Study group creation limit reached (10 a day).');
 insert into public.campusmy_study_groups(owner,course_key,term,title,purpose,mode,meeting_text,language,capacity)
 values(me,p_course,p_term,trim(p_title),p_purpose,p_mode,p_meeting,p_language,p_capacity) returning id into result;
 insert into public.campusmy_group_members(group_id,user_id,status) values(result,me,'accepted');return result;
end $$;

-- Classmate listings, room joins and plan publishing get generous ceilings against scripted abuse.
create or replace function public.cm_classmate(p_course text,p_term text,p_groups text,p_looking text,p_note text,p_visible boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if p_visible then
 perform public.cm_rate_limit(me,'classmate',30,interval '1 day','Listing update limit reached (30 a day).');
 insert into public.campusmy_classmates(user_id,course_key,term,group_label,looking_for,note) values(me,p_course,p_term,p_groups,p_looking,p_note)
 on conflict(user_id,course_key,term) do update set group_label=excluded.group_label,looking_for=excluded.looking_for,note=excluded.note,updated_at=now(),expires_at=now()+interval '90 days';
 else delete from public.campusmy_classmates where user_id=me and course_key=p_course and term=p_term;end if;
end $$;
create or replace function public.cm_room_join(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-room-user:'||me::text,0));
 perform 1 from public.campusmy_rooms where id=p_room for update;
 r:=public.cm_room_access(p_room);
 if exists(select 1 from public.campusmy_room_members where room_id=p_room and user_id=me and status='active') then return; end if;
 if r.closed then raise exception 'This room is closed.'; end if;
 if (select count(*) from public.campusmy_room_members where room_id=p_room and status='active')>=r.capacity then raise exception 'This room is full.'; end if;
 if (select count(*) from public.campusmy_room_members where user_id=me and status='active')>=30 then raise exception 'Leave a room before joining another (30 room limit).'; end if;
 perform public.cm_rate_limit(me,'room_join',60,interval '1 day','Room join limit reached (60 a day).');
 insert into public.campusmy_room_members(room_id,user_id,last_read_seq) values(p_room,me,coalesce((select max(seq) from public.campusmy_room_messages where room_id=p_room),0))
 on conflict(room_id,user_id) do update set status='active',joined_at=now(),last_read_seq=excluded.last_read_seq;
end $$;
create or replace function public.cm_publish_plan(p_plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();clean jsonb:=public.cm_clean_plan(p_plan);begin
 perform public.cm_rate_limit(me,'publish_plan',120,interval '1 hour','Timetable sharing update limit reached.');
 insert into public.campusmy_shared_plans(user_id,payload,enabled) values(me,clean,true)
 on conflict(user_id) do update set payload=excluded.payload,enabled=true,updated_at=now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Direct messages: a stable sequence cursor (no equal-timestamp skips), an idempotency key so a
--    retried send cannot duplicate, and the 30-a-minute limit made atomic.
-- ---------------------------------------------------------------------------------------------
alter table public.campusmy_messages add column if not exists seq bigint;
alter table public.campusmy_messages add column if not exists client_id uuid;
create sequence if not exists public.campusmy_messages_seq_seq as bigint;
alter sequence public.campusmy_messages_seq_seq owned by public.campusmy_messages.seq;
do $$ declare base bigint; begin
 select coalesce(max(seq),0) into base from public.campusmy_messages;
 with o as (select id,row_number() over (order by created_at,id) rn from public.campusmy_messages where seq is null)
 update public.campusmy_messages m set seq=base+o.rn from o where o.id=m.id;
 perform setval('public.campusmy_messages_seq_seq',greatest(coalesce((select max(seq) from public.campusmy_messages),0),1),(select count(*)>0 from public.campusmy_messages));
end $$;
alter table public.campusmy_messages alter column seq set default nextval('public.campusmy_messages_seq_seq');
alter table public.campusmy_messages alter column seq set not null;
create unique index if not exists campusmy_messages_seq_key on public.campusmy_messages(seq);
create index if not exists campusmy_messages_thread_seq on public.campusmy_messages(friendship,seq desc);
create unique index if not exists campusmy_messages_client_key on public.campusmy_messages(sender,client_id) where client_id is not null;
revoke all on sequence public.campusmy_messages_seq_seq from public,anon,authenticated;

-- A timestamp watermark can mark an equal-timestamp or concurrently committed message read.
alter table public.campusmy_chat_reads add column if not exists last_read_seq bigint;
update public.campusmy_chat_reads r set last_read_seq=coalesce((select max(m.seq) from public.campusmy_messages m where m.friendship=r.friendship and m.created_at<=r.last_read),0) where last_read_seq is null;
alter table public.campusmy_chat_reads alter column last_read_seq set default 0;
alter table public.campusmy_chat_reads alter column last_read_seq set not null;
create or replace function public.cm_friends() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 return jsonb_build_object('sharing',(select jsonb_build_object('enabled',enabled,'plan',payload,'updated_at',updated_at) from public.campusmy_shared_plans where user_id=me),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'status',f.status,'incoming',f.recipient=me,'person',public.cm_person(case when f.requester=me then f.recipient else f.requester end),
 'my_sharing',case when f.requester=me then f.requester_shares else f.recipient_shares end,
 'their_sharing',case when f.requester=me then f.recipient_shares else f.requester_shares end,
 'unread',(select count(*) from public.campusmy_messages m where m.friendship=f.id and m.sender<>me and m.seq>coalesce((select last_read_seq from public.campusmy_chat_reads where friendship=f.id and user_id=me),0))))
 from public.campusmy_friendships f where me in(f.requester,f.recipient) and f.status<>'removed' and not public.cm_blocked(f.requester,f.recipient)),'[]'));
end $$;
drop function if exists public.cm_messages(uuid,timestamptz);
create or replace function public.cm_messages(p_friendship uuid,p_before timestamptz default null,p_before_seq bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result jsonb;begin
 select * into r from public.campusmy_friendships where id=p_friendship;
 if r.id is null or me not in(r.requester,r.recipient) or r.status<>'accepted' or public.cm_blocked(r.requester,r.recipient) then raise exception 'Chat is available to accepted friends only.' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'seq',seq::text,'body',body,'mine',sender=me,'created_at',created_at) order by seq),'[]') into result
 from (select * from public.campusmy_messages where friendship=p_friendship and (p_before_seq is null or seq<p_before_seq) and (p_before is null or created_at<p_before) order by seq desc limit 50) m;
 if p_before is null and p_before_seq is null then insert into public.campusmy_chat_reads(friendship,user_id,last_read,last_read_seq) values(p_friendship,me,now(),coalesce((select max((v->>'seq')::bigint) from jsonb_array_elements(result) v),0)) on conflict(friendship,user_id) do update set last_read=excluded.last_read,last_read_seq=greatest(campusmy_chat_reads.last_read_seq,excluded.last_read_seq);end if;
 return result;
end $$;

drop function if exists public.cm_send_message(uuid,text);
create or replace function public.cm_send_message(p_friendship uuid,p_body text,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;prior public.campusmy_messages;result uuid;begin
 select * into r from public.campusmy_friendships where id=p_friendship for update;
 if r.id is null or me not in(r.requester,r.recipient) or r.status<>'accepted' or public.cm_blocked(r.requester,r.recipient) then raise exception 'Chat is available to accepted friends only.' using errcode='42501';end if;
 if p_body is null or length(trim(p_body)) not between 1 and 2000 or p_body !~ '[^[:space:]]' then raise exception 'Write a message between 1 and 2000 characters.';end if;
 if p_client_id is not null then
  -- Serialize this sender's retry key even when two requests target different threads.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-send-key:'||me::text||':'||p_client_id::text,0));
  select * into prior from public.campusmy_messages where sender=me and client_id=p_client_id;
  if prior.id is not null then
   if prior.friendship<>p_friendship or prior.body<>trim(p_body) then raise exception 'This message request key was already used for different content.';end if;
   return prior.id;
  end if;
 end if;
 perform public.cm_rate_limit(me,'dm_send',30,interval '1 minute','Please wait before sending more messages (30 a minute).');
 insert into public.campusmy_messages(friendship,sender,body,client_id) values(r.id,me,trim(p_body),p_client_id)
 on conflict(sender,client_id) where client_id is not null do nothing returning id into result;
 if result is null then raise exception 'Message retry could not be completed. Try again.';end if;
 return result;
end $$;

-- Community rooms: the same idempotency key for retried sends.
alter table public.campusmy_room_messages add column if not exists client_id uuid;
create unique index if not exists campusmy_room_messages_client_key on public.campusmy_room_messages(sender,client_id) where client_id is not null;
drop function if exists public.cm_room_send(uuid,text);
create or replace function public.cm_room_send(p_room uuid,p_body text,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; prior public.campusmy_room_messages; result uuid; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-room-user:'||me::text,0));
 perform 1 from public.campusmy_rooms where id=p_room for update; r:=public.cm_room_access(p_room,true);
 if r.closed then raise exception 'This room is closed.'; end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 or p_body !~ '[^[:space:]]' then raise exception 'Write a message between 1 and 2000 characters.'; end if;
 if p_client_id is not null then
  select * into prior from public.campusmy_room_messages where sender=me and client_id=p_client_id;
  if prior.id is not null then
   if prior.room_id<>p_room or prior.body<>btrim(p_body) then raise exception 'This message request key was already used for different content.';end if;
   return prior.id;
  end if;
 end if;
 if (select count(*) from public.campusmy_room_messages where sender=me and created_at>now()-interval '1 minute')>=30 then raise exception 'Please wait before sending more messages (30 a minute). Try again in about a minute.'; end if;
 insert into public.campusmy_room_messages(room_id,sender,body,client_id) values(p_room,me,btrim(p_body),p_client_id)
 on conflict(sender,client_id) where client_id is not null do nothing returning id into result;
 if result is null then raise exception 'Message retry could not be completed. Try again.';end if;
 update public.campusmy_rooms set updated_at=now() where id=p_room; return result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes for the queries the social functions actually run.
-- ---------------------------------------------------------------------------------------------
create index if not exists campusmy_reviews_course_idx on public.campusmy_reviews(course_key,term,updated_at desc);
create index if not exists campusmy_classmates_course_idx on public.campusmy_classmates(course_key,term,expires_at);
create index if not exists campusmy_study_groups_course_idx on public.campusmy_study_groups(course_key,term,created_at desc);
create index if not exists campusmy_blocks_blocked_idx on public.campusmy_blocks(blocked);
create index if not exists campusmy_friendships_recipient_idx on public.campusmy_friendships(recipient,status);
create index if not exists campusmy_friendships_requester_idx on public.campusmy_friendships(requester,status);

-- ---------------------------------------------------------------------------------------------
-- 4. Staff-only moderation queue with an audit trail. Staff are appointed only by the operator in
--    SQL (insert into public.campusmy_staff); no browser call can grant staff rights.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.campusmy_staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 note text not null default '' check(length(note)<=200),
 created_at timestamptz not null default now()
);
create table if not exists public.campusmy_moderation_log (
 id bigint generated always as identity primary key,
 actor uuid references auth.users(id) on delete set null,
 target_type text not null check(target_type in ('review','room_message')),
 target_id uuid not null,
 action text not null check(action in ('hide','restore','dismiss')),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now()
);
create index if not exists campusmy_moderation_log_target_idx on public.campusmy_moderation_log(target_type,target_id,created_at desc);
alter table public.campusmy_review_reports add column if not exists status text not null default 'open' check(status in ('open','actioned','dismissed'));
alter table public.campusmy_review_reports add column if not exists resolved_at timestamptz;
alter table public.campusmy_room_reports add column if not exists status text not null default 'open' check(status in ('open','actioned','dismissed'));
alter table public.campusmy_room_reports add column if not exists resolved_at timestamptz;
create index if not exists campusmy_review_reports_status_idx on public.campusmy_review_reports(status,created_at desc);
create index if not exists campusmy_room_reports_status_idx on public.campusmy_room_reports(status,created_at desc);
alter table public.campusmy_staff enable row level security;
alter table public.campusmy_moderation_log enable row level security;
revoke all on public.campusmy_staff,public.campusmy_moderation_log from public,anon,authenticated;
revoke all on sequence public.campusmy_moderation_log_id_seq from public,anon,authenticated;

create or replace function public.cm_is_staff() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.campusmy_staff s join auth.users u on u.id=s.user_id where s.user_id=auth.uid() and u.email_confirmed_at is not null)
$$;
create or replace function public.cm_require_staff() returns uuid language plpgsql stable security definer set search_path='' as $$
begin if not public.cm_is_staff() then raise exception 'Staff only.' using errcode='42501';end if;return auth.uid();end $$;

-- Queue entries never include reporter identities; context is the minimum needed for a decision.
create or replace function public.cm_mod_queue(p_status text default 'open',p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_staff();begin
 if p_status not in ('open','actioned','dismissed') then raise exception 'Invalid queue filter.';end if;
 return coalesce((select jsonb_agg(entry order by latest desc) from (
  select jsonb_build_object('type','room_message','id',m.id,'reports',count(*),'latest',max(rp.created_at),'status',p_status,
   'reasons',(select coalesce(jsonb_agg(x.reason order by x.created_at desc),'[]') from (select reason,created_at from public.campusmy_room_reports where message_id=m.id and status=p_status order by created_at desc limit 5) x),
   'context',jsonb_build_object('body',m.body,'created_at',m.created_at,'hidden',m.hidden,'author',coalesce(p.username,'deleted account'),
    'room',jsonb_build_object('id',r.id,'title',r.title,'scope',r.scope,'campus',r.campus))) entry,max(rp.created_at) latest
  from public.campusmy_room_reports rp join public.campusmy_room_messages m on m.id=rp.message_id join public.campusmy_rooms r on r.id=m.room_id
  left join public.campusmy_profiles p on p.user_id=m.sender where rp.status=p_status group by m.id,m.body,m.created_at,m.hidden,p.username,r.id,r.title,r.scope,r.campus
  union all
  select jsonb_build_object('type','review','id',v.id,'reports',count(*),'latest',max(rp.created_at),'status',p_status,
   'reasons',(select coalesce(jsonb_agg(x.reason order by x.created_at desc),'[]') from (select reason,created_at from public.campusmy_review_reports where review_id=v.id and status=p_status order by created_at desc limit 5) x),
   'context',jsonb_build_object('body',v.body,'advice',v.advice,'created_at',v.created_at,'hidden',v.hidden,'author',case when v.anonymous then 'anonymous student' else coalesce(p.username,'deleted account') end,
    'course',jsonb_build_object('key',v.course_key,'term',v.term,'lecturer',v.lecturer))) entry,max(rp.created_at) latest
  from public.campusmy_review_reports rp join public.campusmy_reviews v on v.id=rp.review_id left join public.campusmy_profiles p on p.user_id=v.owner
  where rp.status=p_status group by v.id,v.body,v.advice,v.created_at,v.hidden,v.anonymous,p.username,v.course_key,v.term,v.lecturer
  order by latest desc limit greatest(1,least(coalesce(p_limit,50),200))) q),'[]');
end $$;

create or replace function public.cm_mod_action(p_type text,p_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_staff();hit integer;begin
 if p_type not in ('review','room_message') or p_action not in ('hide','restore','dismiss') then raise exception 'Invalid moderation action.';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Give a decision reason between 3 and 500 characters.';end if;
 if p_type='review' then
  perform 1 from public.campusmy_reviews where id=p_id for update; if not found then raise exception 'Review not found.';end if;
  if p_action='dismiss' and not exists(select 1 from public.campusmy_review_reports where review_id=p_id and status='open') then raise exception 'No open reports for this review.';end if;
  if p_action<>'dismiss' then update public.campusmy_reviews set hidden=(p_action='hide'),updated_at=updated_at where id=p_id;get diagnostics hit=row_count;if hit=0 then raise exception 'Review not found.';end if;end if;
  update public.campusmy_review_reports set status=case when p_action='dismiss' then 'dismissed' else 'actioned' end,resolved_at=now() where review_id=p_id and status='open';
 else
  perform 1 from public.campusmy_room_messages where id=p_id for update; if not found then raise exception 'Message not found.';end if;
  if p_action='dismiss' and not exists(select 1 from public.campusmy_room_reports where message_id=p_id and status='open') then raise exception 'No open reports for this message.';end if;
  if p_action<>'dismiss' then update public.campusmy_room_messages set hidden=(p_action='hide') where id=p_id;get diagnostics hit=row_count;if hit=0 then raise exception 'Message not found.';end if;end if;
  update public.campusmy_room_reports set status=case when p_action='dismiss' then 'dismissed' else 'actioned' end,resolved_at=now() where message_id=p_id and status='open';
 end if;
 insert into public.campusmy_moderation_log(actor,target_type,target_id,action,reason) values(me,p_type,p_id,p_action,btrim(p_reason));
end $$;

create or replace function public.cm_mod_log(p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_staff();begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'actor',coalesce(p.username,'former staff'),'type',l.target_type,'target',l.target_id,'action',l.action,'reason',l.reason,'at',l.created_at) order by l.id desc)
  from (select * from public.campusmy_moderation_log order by id desc limit greatest(1,least(coalesce(p_limit,100),500))) l left join public.campusmy_profiles p on p.user_id=l.actor),'[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Bounded reads (also covers polling from several tabs). Invalid calls roll back their counters.
create or replace function public.cm_get_friend_plan(p_target uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result jsonb;begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 select * into r from public.campusmy_friendships where least(requester,recipient)=least(me,p_target) and greatest(requester,recipient)=greatest(me,p_target) and status='accepted';
 if r.id is null or public.cm_blocked(me,p_target) then raise exception 'Accept a friend request before viewing a shared timetable.' using errcode='42501';end if;
 if (p_target=r.requester and not r.requester_shares) or (p_target=r.recipient and not r.recipient_shares) then return null;end if;
 select jsonb_build_object('plan',payload,'updated_at',updated_at,'person',public.cm_person(p_target)) into result from public.campusmy_shared_plans where user_id=p_target and enabled;
 return result;
end $$;
create or replace function public.cm_friends() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 return jsonb_build_object('sharing',(select jsonb_build_object('enabled',enabled,'plan',payload,'updated_at',updated_at) from public.campusmy_shared_plans where user_id=me),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'status',f.status,'incoming',f.recipient=me,'person',public.cm_person(case when f.requester=me then f.recipient else f.requester end),
 'my_sharing',case when f.requester=me then f.requester_shares else f.recipient_shares end,
 'their_sharing',case when f.requester=me then f.recipient_shares else f.requester_shares end,
 'unread',(select count(*) from public.campusmy_messages m where m.friendship=f.id and m.sender<>me and m.seq>coalesce((select last_read_seq from public.campusmy_chat_reads where friendship=f.id and user_id=me),0))))
 from public.campusmy_friendships f where me in(f.requester,f.recipient) and f.status<>'removed' and not public.cm_blocked(f.requester,f.recipient)),'[]'));
end $$;
create or replace function public.cm_messages(p_friendship uuid,p_before timestamptz default null,p_before_seq bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result jsonb;begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 select * into r from public.campusmy_friendships where id=p_friendship;
 if r.id is null or me not in(r.requester,r.recipient) or r.status<>'accepted' or public.cm_blocked(r.requester,r.recipient) then raise exception 'Chat is available to accepted friends only.' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'seq',seq::text,'body',body,'mine',sender=me,'created_at',created_at) order by seq),'[]') into result
 from (select * from public.campusmy_messages where friendship=p_friendship and (p_before_seq is null or seq<p_before_seq) and (p_before is null or created_at<p_before) order by seq desc limit 50) m;
 if p_before is null and p_before_seq is null then insert into public.campusmy_chat_reads(friendship,user_id,last_read,last_read_seq) values(p_friendship,me,now(),coalesce((select max((v->>'seq')::bigint) from jsonb_array_elements(result) v),0)) on conflict(friendship,user_id) do update set last_read=excluded.last_read,last_read_seq=greatest(campusmy_chat_reads.last_read_seq,excluded.last_read_seq);end if;
 return result;
end $$;
create or replace function public.cm_course_social(p_course text,p_term text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 if not exists(select 1 from public.campusmy_social_courses where course_key=p_course) then raise exception 'This course is not in the reviewed catalogue yet.';end if;
 return jsonb_build_object(
 'reviews',coalesce((select jsonb_agg(public.cm_review_json(r) order by r.updated_at desc) from (select * from public.campusmy_reviews where course_key=p_course and term=p_term and (not hidden or owner=me) order by updated_at desc limit 100) r),'[]'),
 'stats',(select jsonb_build_object('count',count(*),'average',case when count(*)>=5 then round(avg(overall),1) else null end) from public.campusmy_reviews where course_key=p_course and term=p_term and not hidden),
 'teachers',coalesce((select jsonb_agg(name order by name) from public.campusmy_social_teachers where course_key=p_course and term=p_term),'[]'),
 'classmates',coalesce((select jsonb_agg(jsonb_build_object('person',public.cm_person(c.user_id),'groups',c.group_label,'looking_for',c.looking_for,'note',c.note,'mine',c.user_id=me))
 from (select * from public.campusmy_classmates where course_key=p_course and term=p_term and expires_at>now() and not public.cm_blocked(me,user_id) order by updated_at desc limit 100) c),'[]'),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'person',public.cm_person(g.owner),'title',g.title,'purpose',g.purpose,'mode',g.mode,'meeting_text',g.meeting_text,'language',g.language,'capacity',g.capacity,
 'count',(select count(*) from public.campusmy_group_members where group_id=g.id and status='accepted'),
 'mine',g.owner=me,'active',g.active,'expires_at',g.expires_at,
 'my_status',(select status from public.campusmy_group_members where group_id=g.id and user_id=me),
 'members',case when g.owner=me or exists(select 1 from public.campusmy_group_members where group_id=g.id and user_id=me and status='accepted') then
 coalesce((select jsonb_agg(jsonb_build_object('person',public.cm_person(user_id),'status',status)) from public.campusmy_group_members where group_id=g.id and (status='accepted' or g.owner=me)),'[]') else '[]'::jsonb end) order by g.created_at desc)
 from (select * from public.campusmy_study_groups where course_key=p_course and term=p_term and ((active and expires_at>now()) or owner=me) and not public.cm_blocked(me,owner) order by created_at desc limit 50) g),'[]'));
end $$;
create or replace function public.cm_recent_reviews() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 return coalesce((select jsonb_agg(public.cm_review_json(r)||jsonb_build_object('course',c.name,'code',c.code,'campus',c.campus) order by r.updated_at desc)
 from (select * from public.campusmy_reviews where not hidden order by updated_at desc limit 5) r join public.campusmy_social_courses c using(course_key)),'[]');
end $$;
create or replace function public.cm_my_reviews() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 return coalesce((select jsonb_agg(public.cm_review_json(r)||jsonb_build_object('course',c.name,'code',c.code,'campus',c.campus) order by r.updated_at desc)
 from public.campusmy_reviews r join public.campusmy_social_courses c using(course_key) where r.owner=me),'[]');
end $$;
create or replace function public.cm_room_list(p_scope text default 'local',p_campus text default 'Kampar',p_category text default '',p_query text default '',p_mine boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); result jsonb; begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 if p_scope not in ('local','campus') or p_campus not in ('Kampar','Sungai Long') or char_length(p_query)>80 then raise exception 'Invalid room filters.'; end if;
 select coalesce(jsonb_agg(public.cm_room_json(r,me) order by r.updated_at desc,r.id),'[]') into result from (
 select x.* from public.campusmy_rooms x where
 (case when p_mine then exists(select 1 from public.campusmy_room_members where room_id=x.id and user_id=me and status='active') else x.scope=p_scope and x.campus=p_campus and not x.closed end)
 and (x.scope='local' or exists(select 1 from public.campusmy_profiles where user_id=me and campus=x.campus))
 and not public.cm_blocked(me,x.owner)
 and not exists(select 1 from public.campusmy_room_members where room_id=x.id and user_id=me and status='banned')
 and (p_category='' or x.category=p_category)
 and (p_query='' or strpos(lower(x.title||' '||x.description),lower(btrim(p_query)))>0)
 order by x.updated_at desc,x.id limit 60) r;
 return result;
end $$;
create or replace function public.cm_room_detail(p_room uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 r:=public.cm_room_access(p_room); return public.cm_room_json(r,me);
end $$;
create or replace function public.cm_room_messages(p_room uuid,p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); result jsonb; seen bigint; begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 perform 1 from public.campusmy_rooms where id=p_room for share;
 perform public.cm_room_access(p_room,true);
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'seq',m.seq::text,'body',m.body,'mine',m.sender=me,
 'sender',coalesce(nullif(p.display_name,''),p.username,'Student'),'username',p.username,'created_at',m.created_at) order by m.seq),'[]'),max(m.seq)
 into result,seen from (select * from public.campusmy_room_messages x where x.room_id=p_room and not x.hidden
 and (p_before is null or x.seq<p_before) and not public.cm_blocked(me,x.sender) order by x.seq desc limit 50) m
 left join public.campusmy_profiles p on p.user_id=m.sender;
 if p_before is null and seen is not null then update public.campusmy_room_members set last_read_seq=greatest(last_read_seq,seen) where room_id=p_room and user_id=me; end if;
 return result;
end $$;
create or replace function public.cm_room_members(p_room uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform public.cm_rate_limit(auth.uid(),'social_read',300,interval '1 minute','Too many requests. Please wait before refreshing.');
 r:=public.cm_room_access(p_room,true);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(p.display_name,''),p.username),
 'username',p.username,'owner',p.user_id=r.owner,'me',p.user_id=me) order by m.joined_at),'[]')
 from public.campusmy_room_members m join public.campusmy_profiles p on p.user_id=m.user_id
 where m.room_id=p_room and m.status='active' and not public.cm_blocked(me,m.user_id));
end $$;

create table if not exists public.campusmy_posting_pauses (
 user_id uuid primary key references auth.users(id) on delete cascade,
 until_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 updated_at timestamptz not null default now()
);
alter table public.campusmy_posting_pauses enable row level security;
revoke all on public.campusmy_posting_pauses from public,anon,authenticated;
alter table public.campusmy_moderation_log drop constraint if exists campusmy_moderation_log_action_check;
alter table public.campusmy_moderation_log add constraint campusmy_moderation_log_action_check check(action in ('hide','restore','dismiss','pause_posting','resume_posting'));

create or replace function public.cm_check_posting() returns void language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();expires timestamptz;begin
 select until_at into expires from public.campusmy_posting_pauses where user_id=me and until_at>now();
 if expires is not null then raise exception 'Community posting is paused until %. See My page for the decision.',to_char(expires at time zone 'UTC','YYYY-MM-DD HH24:MI "UTC"') using errcode='42501';end if;
end $$;
create or replace function public.cm_posting_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 return (select jsonb_build_object('until',until_at,'reason',reason) from public.campusmy_posting_pauses where user_id=me and until_at>now());
end $$;
create or replace function public.cm_mod_posting(p_type text,p_id uuid,p_days integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_staff();target uuid;begin
 if p_type not in ('review','room_message') or p_days is null or p_days not between 0 and 30 then raise exception 'Choose a posting pause between 1 and 30 days, or resume.';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Give a decision reason between 3 and 500 characters.';end if;
 if p_type='review' then select owner into target from public.campusmy_reviews where id=p_id for update;
 else select sender into target from public.campusmy_room_messages where id=p_id for update;end if;
 if target is null then raise exception 'Content not found.';end if;
 if target=me or exists(select 1 from public.campusmy_staff where user_id=target) then raise exception 'Staff access must be managed by the site owner.';end if;
 if p_days=0 then delete from public.campusmy_posting_pauses where user_id=target;
 else insert into public.campusmy_posting_pauses(user_id,until_at,reason) values(target,now()+make_interval(days=>p_days),btrim(p_reason))
 on conflict(user_id) do update set until_at=excluded.until_at,reason=excluded.reason,updated_at=now();end if;
 insert into public.campusmy_moderation_log(actor,target_type,target_id,action,reason)
 values(me,p_type,p_id,case when p_days=0 then 'resume_posting' else 'pause_posting' end,
 case when p_days=0 then '' else p_days::text||' day(s): ' end||left(btrim(p_reason),470));
end $$;

-- Patch the current definitions, preserving hardened limits and retry semantics. Reapplying this
-- migration does not stack checks. Always apply this last if hardening itself is reapplied.
do $$ declare r record;definition text;guard text;begin
 for r in select p.oid::regprocedure signature,p.proname,pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('cm_room_create','cm_room_join','cm_room_send','cm_save_review','cm_classmate','cm_create_group','cm_group_action') loop
  definition:=r.definition;
  if position('public.cm_check_posting()' in definition)>0 then continue;end if;
  guard:=case when r.proname='cm_classmate' then 'if p_visible then perform public.cm_check_posting();end if;'
   when r.proname='cm_group_action' then 'if p_action in (''request'',''reopen'') then perform public.cm_check_posting();end if;'
   else 'perform public.cm_check_posting();' end;
  definition:=regexp_replace(definition,'\mbegin\M','begin '||guard,'i');
  execute definition;
 end loop;
end $$;
revoke all on function public.cm_check_posting(),public.cm_posting_status(),public.cm_mod_posting(text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.cm_posting_status(),public.cm_mod_posting(text,uuid,integer,text) to authenticated;

-- 5. Privileges: everything new is internal unless listed here.
-- ---------------------------------------------------------------------------------------------
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('cm_rate_limit','cm_request_friend','cm_find_person','cm_resolve_invite','cm_my_invite','cm_report_review','cm_room_report','cm_save_review','cm_create_group','cm_classmate','cm_room_join','cm_publish_plan','cm_friends','cm_messages','cm_send_message','cm_room_send','cm_is_staff','cm_require_staff','cm_mod_queue','cm_mod_action','cm_mod_log') loop
 execute 'revoke all on function '||r.signature||' from public,anon,authenticated'; end loop;
end $$;
grant execute on function public.cm_request_friend(uuid),public.cm_find_person(text),public.cm_resolve_invite(uuid),public.cm_my_invite(boolean),
 public.cm_report_review(uuid,text),public.cm_room_report(uuid,text),public.cm_save_review(text,text,text,integer,integer,text,text[],text,text,boolean),
 public.cm_create_group(text,text,text,text,text,text,text,integer),public.cm_classmate(text,text,text,text,text,boolean),public.cm_room_join(uuid),public.cm_publish_plan(jsonb),
 public.cm_friends(),public.cm_messages(uuid,timestamptz,bigint),public.cm_send_message(uuid,text,uuid),public.cm_room_send(uuid,text,uuid),
 public.cm_is_staff(),public.cm_mod_queue(text,integer),public.cm_mod_action(text,uuid,text,text),public.cm_mod_log(integer) to authenticated;
-- Ask PostgREST to pick up the changed function signatures immediately.
notify pgrst,'reload schema';
commit;
