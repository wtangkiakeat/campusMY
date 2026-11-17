-- CampusMY optional friends, sharing, reviews, classmates and chat. Existing private tables remain protected.
begin;
-- Bootstrap files must not overwrite newer hardened function bodies.
do $$ begin
 if to_regclass('public.campusmy_rate_events') is not null then
  raise exception 'Security hardening is already installed. Do not reapply legacy setup files; use the versioned hardening migration.' using errcode='55000';
 end if;
end $$;

-- CampusMY social features. Existing profiles, private plans and todos are preserved.
create table if not exists public.campusmy_social_courses (
 course_key text primary key, campus text not null, code text not null, name text not null
);
create table if not exists public.campusmy_social_teachers (
 course_key text references public.campusmy_social_courses on delete cascade,
 term text not null, name text not null, primary key(course_key,term,name)
);
create table if not exists public.campusmy_friendships (
 id uuid primary key default gen_random_uuid(), requester uuid not null references auth.users on delete cascade,
 recipient uuid not null references auth.users on delete cascade, status text not null default 'pending' check(status in ('pending','accepted','removed')),
 requester_shares boolean not null default true, recipient_shares boolean not null default true,
 created_at timestamptz not null default now(), responded_at timestamptz,
 check(requester<>recipient)
);
create unique index if not exists campusmy_friend_pair on public.campusmy_friendships(least(requester,recipient),greatest(requester,recipient));
create table if not exists public.campusmy_blocks (
 blocker uuid references auth.users on delete cascade, blocked uuid references auth.users on delete cascade,
 created_at timestamptz not null default now(), primary key(blocker,blocked), check(blocker<>blocked)
);
create table if not exists public.campusmy_friend_invites (
 owner uuid primary key references auth.users on delete cascade, token uuid not null unique default gen_random_uuid(),
 expires_at timestamptz not null default now()+interval '7 days'
);
create table if not exists public.campusmy_shared_plans (
 user_id uuid primary key references auth.users on delete cascade, payload jsonb not null,
 enabled boolean not null default false, updated_at timestamptz not null default now(),
 check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=300000)
);
create table if not exists public.campusmy_messages (
 id uuid primary key default gen_random_uuid(), friendship uuid not null references public.campusmy_friendships on delete cascade,
 sender uuid not null references auth.users on delete cascade, body text not null check(length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists campusmy_messages_thread on public.campusmy_messages(friendship,created_at);
create index if not exists campusmy_messages_sender on public.campusmy_messages(sender,created_at);
create table if not exists public.campusmy_chat_reads (
 friendship uuid references public.campusmy_friendships on delete cascade,user_id uuid references auth.users on delete cascade,
 last_read timestamptz not null default now(),primary key(friendship,user_id)
);
create table if not exists public.campusmy_reviews (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users on delete cascade,
 course_key text not null references public.campusmy_social_courses,term text not null check(length(trim(term)) between 1 and 100),
 lecturer text not null default '',overall integer not null check(overall between 1 and 5),
 teaching integer not null check(teaching between 1 and 5),workload text not null check(workload in ('Light','Moderate','Heavy')),
 assessments text[] not null default '{}',body text not null check(length(trim(body)) between 10 and 3000),
 advice text not null default '' check(length(advice)<=1500),anonymous boolean not null default true,
 hidden boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(cardinality(assessments)<=6)
);
create unique index if not exists campusmy_review_once on public.campusmy_reviews(owner,course_key,term,lower(trim(lecturer)));
create table if not exists public.campusmy_review_reports (
 review_id uuid references public.campusmy_reviews on delete cascade,reporter uuid references auth.users on delete cascade,
 reason text not null check(length(trim(reason)) between 3 and 500),created_at timestamptz not null default now(),
 primary key(review_id,reporter)
);
create table if not exists public.campusmy_classmates (
 user_id uuid references auth.users on delete cascade,course_key text references public.campusmy_social_courses,
 term text not null check(length(term) between 1 and 100),group_label text not null default '' check(length(group_label)<=120),
 looking_for text not null check(looking_for in ('Study partner','Assignment group','Revision sessions','Weekly practice','Helping juniors')),
 note text not null default '' check(length(note)<=300),updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '90 days',primary key(user_id,course_key,term)
);
create table if not exists public.campusmy_study_groups (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users on delete cascade,
 course_key text not null references public.campusmy_social_courses,term text not null check(length(trim(term)) between 1 and 100),
 title text not null check(length(trim(title)) between 3 and 80),purpose text not null check(purpose in ('Study partner','Assignment group','Revision sessions','Weekly practice')),
 mode text not null check(mode in ('On campus','Online','Either')),meeting_text text not null default '' check(length(meeting_text)<=200),
 language text not null default '' check(length(language)<=60),capacity integer not null check(capacity between 2 and 20),
 active boolean not null default true,expires_at timestamptz not null default now()+interval '30 days',created_at timestamptz not null default now()
);
create table if not exists public.campusmy_group_members (
 group_id uuid references public.campusmy_study_groups on delete cascade,user_id uuid references auth.users on delete cascade,
 status text not null check(status in ('pending','accepted')),created_at timestamptz not null default now(),primary key(group_id,user_id)
);

-- No social tables are directly exposed. All API functions project allowed fields and check the caller.
do $$ declare t text; begin
 foreach t in array array['campusmy_social_courses','campusmy_social_teachers','campusmy_friendships','campusmy_blocks','campusmy_friend_invites','campusmy_shared_plans','campusmy_messages','campusmy_chat_reads','campusmy_reviews','campusmy_review_reports','campusmy_classmates','campusmy_study_groups','campusmy_group_members'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
create or replace function public.cm_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
$$;
create or replace function public.cm_require_user() returns uuid language plpgsql stable security definer set search_path='' as $$
begin if not public.cm_verified() then raise exception 'Sign in with a confirmed email to use this feature.' using errcode='42501';end if;return auth.uid();end $$;
create or replace function public.cm_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.campusmy_blocks where (blocker=a and blocked=b) or (blocker=b and blocked=a))
$$;
create or replace function public.cm_person(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',user_id,'username',username,'name',coalesce(nullif(display_name,''),username),'campus',campus)
 from public.campusmy_profiles where user_id=p_id
$$;
create or replace function public.cm_find_person(p_username text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();target uuid;begin
 select user_id into target from public.campusmy_profiles where lower(username)=lower(trim(p_username));
 if target is null or target=me or public.cm_blocked(me,target) then return null;end if;
 return public.cm_person(target);
end $$;
create or replace function public.cm_my_invite(p_rotate boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friend_invites;begin
 select * into r from public.campusmy_friend_invites where owner=me;
 if r.owner is null then insert into public.campusmy_friend_invites(owner) values(me) returning * into r;
 elsif p_rotate or r.expires_at<now() then update public.campusmy_friend_invites set token=gen_random_uuid(),expires_at=now()+interval '7 days' where owner=me returning * into r;end if;
 return jsonb_build_object('token',r.token,'expires_at',r.expires_at);
end $$;
create or replace function public.cm_resolve_invite(p_token uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();target uuid;begin
 select owner into target from public.campusmy_friend_invites where token=p_token and expires_at>now();
 if target is null then raise exception 'This invitation expired or was replaced. Ask your friend for a new link.';end if;
 if target=me then raise exception 'This is your own invitation.';end if;
 if public.cm_blocked(me,target) then raise exception 'This invitation is unavailable.';end if;
 return public.cm_person(target);
end $$;
create or replace function public.cm_request_friend(p_target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;begin
 if p_target=me or public.cm_blocked(me,p_target) or not exists(select 1 from public.campusmy_profiles where user_id=p_target) then raise exception 'That person is unavailable.';end if;
 if (select count(*) from public.campusmy_friendships where requester=me and created_at>now()-interval '1 day')>=20 then raise exception 'Friend request limit reached. Try tomorrow.';end if;
 select * into r from public.campusmy_friendships where least(requester,recipient)=least(me,p_target) and greatest(requester,recipient)=greatest(me,p_target) for update;
 if r.id is null then insert into public.campusmy_friendships(requester,recipient) values(me,p_target) returning * into r;
 elsif r.status='removed' then update public.campusmy_friendships set requester=me,recipient=p_target,status='pending',requester_shares=true,recipient_shares=true,created_at=now(),responded_at=null where id=r.id returning * into r;end if;
 return r.id;
end $$;
create or replace function public.cm_friend_action(p_friendship uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;begin
 select * into r from public.campusmy_friendships where id=p_friendship for update;
 if r.id is null or me not in (r.requester,r.recipient) then raise exception 'Friendship not found.' using errcode='42501';end if;
 if p_action='accept' then
  if me<>r.recipient or r.status<>'pending' or public.cm_blocked(r.requester,r.recipient) then raise exception 'This request cannot be accepted.' using errcode='42501';end if;
  update public.campusmy_friendships set status='accepted',responded_at=now() where id=r.id;
 elsif p_action='decline' then
  if me<>r.recipient or r.status<>'pending' then raise exception 'This request cannot be declined.' using errcode='42501';end if;
  update public.campusmy_friendships set status='removed',responded_at=now() where id=r.id;
 elsif p_action='remove' then update public.campusmy_friendships set status='removed',responded_at=now() where id=r.id;
   elsif p_action in ('pause','resume') and r.status in ('accepted','pending') then
  update public.campusmy_friendships set requester_shares=case when me=requester then p_action='resume' else requester_shares end,
    recipient_shares=case when me=recipient then p_action='resume' else recipient_shares end where id=r.id;
 else raise exception 'Invalid friend action.';end if;
end $$;
create or replace function public.cm_block_person(p_target uuid,p_block boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if me=p_target then raise exception 'Invalid person.';end if;
 if p_block then
  insert into public.campusmy_blocks(blocker,blocked) values(me,p_target) on conflict do nothing;
  update public.campusmy_friendships set status='removed' where least(requester,recipient)=least(me,p_target) and greatest(requester,recipient)=greatest(me,p_target);
 else delete from public.campusmy_blocks where blocker=me and blocked=p_target;end if;
end $$;
create or replace function public.cm_clean_plan(p_plan jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare e jsonb;m jsonb;w jsonb;entries jsonb:='[]';meetings jsonb;weeks jsonb;start_time int;end_time int;begin
   if jsonb_typeof(p_plan) is distinct from 'object' or coalesce(p_plan->>'campus','') not in ('Kampar','Sungai Long') or length(coalesce(p_plan->>'term','')) not between 1 and 100 or jsonb_typeof(p_plan->'entries') is distinct from 'array' then raise exception 'Invalid timetable.';end if;
 if jsonb_array_length(p_plan->'entries')>80 or octet_length(p_plan::text)>300000 then raise exception 'Timetable is too large.';end if;
 for e in select value from jsonb_array_elements(p_plan->'entries') loop
    if length(coalesce(e->>'name','')) not between 1 and 300 or jsonb_typeof(e->'meetings') is distinct from 'array' or jsonb_array_length(e->'meetings')>50 then raise exception 'Invalid class.';end if;
  meetings:='[]';
  for m in select value from jsonb_array_elements(e->'meetings') loop
     if coalesce(m->>'day','') not in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun') or coalesce(m->>'start','') !~ '^\d{1,4}$' or coalesce(m->>'end','') !~ '^\d{1,4}$' then raise exception 'Invalid meeting.';end if;
   start_time:=(m->>'start')::int;end_time:=(m->>'end')::int;
   if start_time<0 or end_time>1440 or start_time>=end_time then raise exception 'Invalid class time.';end if;
   weeks:='[]';if jsonb_typeof(m->'weekNumbers')='array' then
    if jsonb_array_length(m->'weekNumbers')>52 then raise exception 'Invalid weeks.';end if;
    for w in select value from jsonb_array_elements(m->'weekNumbers') loop
     if w::text !~ '^\d{1,2}$' or (w::text)::int not between 1 and 52 then raise exception 'Invalid teaching week.';end if;weeks:=weeks||w;
    end loop;end if;
   meetings:=meetings||jsonb_build_array(jsonb_build_object('day',m->>'day','start',start_time,'end',end_time,'weekNumbers',weeks,'room',left(coalesce(m->>'room',''),100),'lecturer',left(coalesce(m->>'lecturer',''),300)));
  end loop;
  entries:=entries||jsonb_build_array(jsonb_build_object('name',e->>'name','code',left(coalesce(e->>'code',''),80),'groups',left(coalesce(e->>'groups',''),120),'meetings',meetings));
 end loop;
 return jsonb_build_object('name',left(coalesce(p_plan->>'name','My timetable'),100),'campus',p_plan->>'campus','term',p_plan->>'term','entries',entries);
end $$;
create or replace function public.cm_publish_plan(p_plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();clean jsonb:=public.cm_clean_plan(p_plan);begin
 insert into public.campusmy_shared_plans(user_id,payload,enabled) values(me,clean,true)
 on conflict(user_id) do update set payload=excluded.payload,enabled=true,updated_at=now();
end $$;
create or replace function public.cm_pause_sharing() returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin update public.campusmy_shared_plans set enabled=false,updated_at=now() where user_id=me;end $$;
create or replace function public.cm_get_friend_plan(p_target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result jsonb;begin
 select * into r from public.campusmy_friendships where least(requester,recipient)=least(me,p_target) and greatest(requester,recipient)=greatest(me,p_target) and status='accepted';
 if r.id is null or public.cm_blocked(me,p_target) then raise exception 'Accept a friend request before viewing a shared timetable.' using errcode='42501';end if;
 if (p_target=r.requester and not r.requester_shares) or (p_target=r.recipient and not r.recipient_shares) then return null;end if;
 select jsonb_build_object('plan',payload,'updated_at',updated_at,'person',public.cm_person(p_target)) into result from public.campusmy_shared_plans where user_id=p_target and enabled;
 return result;
end $$;
create or replace function public.cm_friends() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 return jsonb_build_object('sharing',(select jsonb_build_object('enabled',enabled,'plan',payload,'updated_at',updated_at) from public.campusmy_shared_plans where user_id=me),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'status',f.status,'incoming',f.recipient=me,'person',public.cm_person(case when f.requester=me then f.recipient else f.requester end),
 'my_sharing',case when f.requester=me then f.requester_shares else f.recipient_shares end,
 'their_sharing',case when f.requester=me then f.recipient_shares else f.requester_shares end,
 'unread',(select count(*) from public.campusmy_messages m where m.friendship=f.id and m.sender<>me and m.created_at>coalesce((select last_read from public.campusmy_chat_reads where friendship=f.id and user_id=me),'1970-01-01'::timestamptz))))
 from public.campusmy_friendships f where me in(f.requester,f.recipient) and f.status<>'removed' and not public.cm_blocked(f.requester,f.recipient)),'[]'));
end $$;
create or replace function public.cm_messages(p_friendship uuid,p_before timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result jsonb;begin
 select * into r from public.campusmy_friendships where id=p_friendship;
 if r.id is null or me not in(r.requester,r.recipient) or r.status<>'accepted' or public.cm_blocked(r.requester,r.recipient) then raise exception 'Chat is available to accepted friends only.' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body,'mine',sender=me,'created_at',created_at) order by created_at,id),'[]') into result
 from (select * from public.campusmy_messages where friendship=p_friendship and (p_before is null or created_at<p_before) order by created_at desc,id desc limit 50) m;
 if p_before is null then insert into public.campusmy_chat_reads(friendship,user_id,last_read) values(p_friendship,me,now()) on conflict(friendship,user_id) do update set last_read=excluded.last_read;end if;
 return result;
end $$;
create or replace function public.cm_send_message(p_friendship uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();r public.campusmy_friendships;result uuid;begin
 select * into r from public.campusmy_friendships where id=p_friendship for update;
 if r.id is null or me not in(r.requester,r.recipient) or r.status<>'accepted' or public.cm_blocked(r.requester,r.recipient) then raise exception 'Chat is available to accepted friends only.' using errcode='42501';end if;
 if (select count(*) from public.campusmy_messages where sender=me and created_at>now()-interval '1 minute')>=30 then raise exception 'Please wait before sending more messages.';end if;
 insert into public.campusmy_messages(friendship,sender,body) values(r.id,me,trim(p_body)) returning id into result;return result;
end $$;

-- Course reviews, classmates and group functions follow in social-courses.sql.
do $$ declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cm_verified','cm_require_user','cm_blocked','cm_person','cm_find_person','cm_my_invite','cm_resolve_invite','cm_request_friend','cm_friend_action','cm_block_person','cm_clean_plan','cm_publish_plan','cm_pause_sharing','cm_get_friend_plan','cm_friends','cm_messages','cm_send_message') loop
 execute 'revoke all on function '||r.signature||' from public,anon,authenticated';
 end loop;
end $$;
grant execute on function public.cm_find_person(text), public.cm_my_invite(boolean), public.cm_resolve_invite(uuid), public.cm_request_friend(uuid), public.cm_friend_action(uuid,text), public.cm_block_person(uuid,boolean), public.cm_publish_plan(jsonb), public.cm_pause_sharing(), public.cm_get_friend_plan(uuid), public.cm_friends(), public.cm_messages(uuid,timestamptz), public.cm_send_message(uuid,text) to authenticated;

create or replace function public.cm_review_json(r public.campusmy_reviews) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'course_key',r.course_key,'term',r.term,'lecturer',r.lecturer,'overall',r.overall,'teaching',r.teaching,'workload',r.workload,
 'assessments',r.assessments,'body',r.body,'advice',r.advice,'mine',r.owner=auth.uid(),'author',case when r.anonymous then 'Anonymous student' else coalesce(nullif(p.display_name,''),p.username,'Student') end,
 'hidden',r.hidden,'created_at',r.created_at,'updated_at',r.updated_at)
 from (select 1) x left join public.campusmy_profiles p on p.user_id=r.owner
$$;
create or replace function public.cm_course_social(p_course text,p_term text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
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
create or replace function public.cm_save_review(p_course text,p_term text,p_lecturer text,p_overall int,p_teaching int,p_workload text,p_assessments text[],p_body text,p_advice text,p_anonymous boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();result uuid;begin
 if length(trim(p_term)) not between 1 and 100 then raise exception 'Choose a trimester.';end if;
 if p_lecturer<>'' and not exists(select 1 from public.campusmy_social_teachers where course_key=p_course and term=p_term and name=p_lecturer) then raise exception 'Choose a published lecturer, or review the course without a lecturer.';end if;
 if not (p_assessments <@ array['Assignments','Group work','Presentations','Tests','Practical work','Final exam']::text[]) then raise exception 'Invalid assessment type.';end if;
 if (select count(*) from public.campusmy_reviews where owner=me and created_at>now()-interval '1 day')>=20 and not exists(select 1 from public.campusmy_reviews where owner=me and course_key=p_course and term=p_term and lower(trim(lecturer))=lower(trim(p_lecturer))) then raise exception 'Review limit reached. Try tomorrow.';end if;
 insert into public.campusmy_reviews(owner,course_key,term,lecturer,overall,teaching,workload,assessments,body,advice,anonymous)
 values(me,p_course,trim(p_term),p_lecturer,p_overall,p_teaching,p_workload,p_assessments,trim(p_body),coalesce(p_advice,''),p_anonymous)
 on conflict(owner,course_key,term,lower(trim(lecturer))) do update set overall=excluded.overall,teaching=excluded.teaching,workload=excluded.workload,assessments=excluded.assessments,body=excluded.body,advice=excluded.advice,anonymous=excluded.anonymous,updated_at=now()
 returning id into result;return result;
end $$;
create or replace function public.cm_delete_review(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin delete from public.campusmy_reviews where id=p_id and owner=me;end $$;
create or replace function public.cm_report_review(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if not exists(select 1 from public.campusmy_reviews where id=p_id and not hidden and owner<>me) then raise exception 'This review cannot be reported.';end if;
 insert into public.campusmy_review_reports(review_id,reporter,reason) values(p_id,me,trim(p_reason)) on conflict(review_id,reporter) do update set reason=excluded.reason;
end $$;
create or replace function public.cm_recent_reviews() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 return coalesce((select jsonb_agg(public.cm_review_json(r)||jsonb_build_object('course',c.name,'code',c.code,'campus',c.campus) order by r.updated_at desc)
 from (select * from public.campusmy_reviews where not hidden order by updated_at desc limit 5) r join public.campusmy_social_courses c using(course_key)),'[]');
end $$;
create or replace function public.cm_my_reviews() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 return coalesce((select jsonb_agg(public.cm_review_json(r)||jsonb_build_object('course',c.name,'code',c.code,'campus',c.campus) order by r.updated_at desc)
 from public.campusmy_reviews r join public.campusmy_social_courses c using(course_key) where r.owner=me),'[]');
end $$;
create or replace function public.cm_classmate(p_course text,p_term text,p_groups text,p_looking text,p_note text,p_visible boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if p_visible then
 insert into public.campusmy_classmates(user_id,course_key,term,group_label,looking_for,note) values(me,p_course,p_term,p_groups,p_looking,p_note)
 on conflict(user_id,course_key,term) do update set group_label=excluded.group_label,looking_for=excluded.looking_for,note=excluded.note,updated_at=now(),expires_at=now()+interval '90 days';
 else delete from public.campusmy_classmates where user_id=me and course_key=p_course and term=p_term;end if;
end $$;
create or replace function public.cm_create_group(p_course text,p_term text,p_title text,p_purpose text,p_mode text,p_meeting text,p_language text,p_capacity int) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();result uuid;begin
 if (select count(*) from public.campusmy_study_groups where owner=me and active and expires_at>now())>=5 then raise exception 'You can organise up to five active groups.';end if;
 insert into public.campusmy_study_groups(owner,course_key,term,title,purpose,mode,meeting_text,language,capacity)
 values(me,p_course,p_term,trim(p_title),p_purpose,p_mode,p_meeting,p_language,p_capacity) returning id into result;
 insert into public.campusmy_group_members(group_id,user_id,status) values(result,me,'accepted');return result;
end $$;
create or replace function public.cm_group_action(p_group uuid,p_action text,p_person uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();g public.campusmy_study_groups;begin
 select * into g from public.campusmy_study_groups where id=p_group for update;
 if g.id is null or public.cm_blocked(me,g.owner) then raise exception 'Group unavailable.' using errcode='42501';end if;
 if p_action='request' then
  if not g.active or g.expires_at<=now() then raise exception 'This group is closed.';end if;
  if (select count(*) from public.campusmy_group_members where group_id=g.id and status='accepted')>=g.capacity then raise exception 'This group is full.';end if;
  insert into public.campusmy_group_members(group_id,user_id,status) values(g.id,me,'pending') on conflict do nothing;
 elsif p_action='leave' then
  if me=g.owner then raise exception 'Close your group instead of leaving it.';end if;
  delete from public.campusmy_group_members where group_id=g.id and user_id=me;
 elsif p_action in ('approve','decline','close','reopen') then
  if me<>g.owner then raise exception 'Only the organiser can manage this group.' using errcode='42501';end if;
  if p_action='approve' then
   if not g.active or g.expires_at<=now() then raise exception 'This group is closed.';end if;
   if public.cm_blocked(me,p_person) then raise exception 'This person is unavailable.';end if;
   if (select count(*) from public.campusmy_group_members where group_id=g.id and status='accepted')>=g.capacity then raise exception 'This group is full.';end if;
   update public.campusmy_group_members set status='accepted' where group_id=g.id and user_id=p_person and status='pending';
  elsif p_action='decline' then delete from public.campusmy_group_members where group_id=g.id and user_id=p_person and status='pending';
  else update public.campusmy_study_groups set active=p_action='reopen',expires_at=case when p_action='reopen' then now()+interval '30 days' else expires_at end where id=g.id;end if;
 else raise exception 'Invalid group action.';end if;
end $$;
do $$ declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cm_review_json','cm_course_social','cm_save_review','cm_delete_review','cm_report_review','cm_recent_reviews','cm_my_reviews','cm_classmate','cm_create_group','cm_group_action') loop
 execute 'revoke all on function '||r.signature||' from public,anon,authenticated';end loop;
end $$;
grant execute on function public.cm_course_social(text,text), public.cm_save_review(text,text,text,integer,integer,text,text[],text,text,boolean), public.cm_delete_review(uuid), public.cm_report_review(uuid,text), public.cm_recent_reviews(), public.cm_my_reviews(), public.cm_classmate(text,text,text,text,text,boolean), public.cm_create_group(text,text,text,text,text,text,text,integer), public.cm_group_action(uuid,text,uuid) to authenticated;

insert into public.campusmy_social_courses(course_key,campus,code,name) values
('Sungai Long|UJDM1003','Sungai Long','UJDM1003','FUNDAMENTALS OF LINEAR ALGEBRA'),
('Sungai Long|UJDM1023','Sungai Long','UJDM1023','INTRODUCTION TO GAME DEVELOPMENT'),
('Sungai Long|UJDM1053','Sungai Long','UJDM1053','PROGRAMMING CONCEPTS AND DESIGN'),
('Sungai Long|UJMG1003','Sungai Long','UJMG1003','Creative Thinking and Idea Generation'),
('Sungai Long|UJMG1163','Sungai Long','UJMG1163','PERCEPTION STUDIES'),
('Sungai Long|UJMM1004','Sungai Long','UJMM1004','FOUNDATIONS OF DRAWING'),
('Sungai Long|UJDM1043','Sungai Long','UJDM1043','GAME PROGRAMMING AND DEVELOPMENT I'),
('Sungai Long|UJMM1023','Sungai Long','UJMM1023','FUNDAMENTALS OF IMAGING'),
('Sungai Long|UJMM1054','Sungai Long','UJMM1054','2D ANIMATION'),
('Sungai Long|UJMM1083','Sungai Long','UJMM1083','HISTORY OF GAME ART AND GENRE STUDIES'),
('Sungai Long|UJMM1093','Sungai Long','UJMM1093','FUNDAMENTALS OF VECTOR GRAPHICS'),
('Sungai Long|UKMM1011','Sungai Long','UKMM1011','SUN ZI''S ART OF WAR AND BUSINESS STRATEGIES'),
('Sungai Long|MPU32123','Sungai Long','MPU32123','ENGLISH FOR GAMES'),
('Sungai Long|UJDM1013','Sungai Long','UJDM1013','GAME PHYSICS'),
('Sungai Long|UJDM1093','Sungai Long','UJDM1093','DATA STRUCTURES AND ALGORITHMS'),
('Sungai Long|UJDM2133','Sungai Long','UJDM2133','ONLINE NETWORKING FOR GAMES DEVELOPMENT'),
('Sungai Long|UJMM1173','Sungai Long','UJMM1173','BASIC 3D ASSET MODELING'),
('Sungai Long|MPU3202','Sungai Long','MPU3202','INTEGRITY AND ANTI-CORRUPTION'),
('Sungai Long|UJDM2073','Sungai Long','UJDM2073','BASIC COMPUTER GRAPHICS'),
('Sungai Long|UJMM2143','Sungai Long','UJMM2143','USER EXPERIENCE AND INTERFACE DESIGN'),
('Sungai Long|UJMM2163','Sungai Long','UJMM2163','BASIC 3D ANIMATION FOR GAMES'),
('Sungai Long|UJMM2233','Sungai Long','UJMM2233','MOBILE GAME DEVELOPMENT I'),
('Sungai Long|UJMM2013','Sungai Long','UJMM2013','GAME RESEARCH AND SOCIETY'),
('Sungai Long|UJMM2243','Sungai Long','UJMM2243','MOBILE GAME DEVELOPMENT II'),
('Sungai Long|UJDM2003','Sungai Long','UJDM2003','GAME PROGRAMMING AND DEVELOPMENT II'),
('Sungai Long|UJDM2094','Sungai Long','UJDM2094','ADVANCED COMPUTER GRAPHICS'),
('Sungai Long|UJDM3004','Sungai Long','UJDM3004','ARTIFICIAL INTELLIGENCE FOR GAMES'),
('Sungai Long|UJMZ32110','Sungai Long','UJMZ32110','PROJECT I'),
('Sungai Long|MPU33163','Sungai Long','MPU33163','ART LAW & CYBER LAW'),
('Sungai Long|UJMG2243','Sungai Long','UJMG2243','DIGITAL TRANSFORMATION AND E-COMMERCE'),
('Sungai Long|UJMG3026','Sungai Long','UJMG3026','INDUSTRIAL TRAINING'),
('Sungai Long|FHAD1014','Sungai Long','FHAD1014','Design Fundamentals'),
('Sungai Long|FHAD1024','Sungai Long','FHAD1024','Analytical Drawing'),
('Sungai Long|FHAD1034','Sungai Long','FHAD1034','Figure Drawing'),
('Sungai Long|FHBM1014','Sungai Long','FHBM1014','Principles of Economics'),
('Sungai Long|FHBM1024','Sungai Long','FHBM1024','Microeconomics and Macroeconomics'),
('Sungai Long|FHBM1114','Sungai Long','FHBM1114','Management'),
('Sungai Long|FHBM1124','Sungai Long','FHBM1124','Marketing'),
('Sungai Long|FHBM1214','Sungai Long','FHBM1214','Financial Accounting'),
('Sungai Long|FHBM1224','Sungai Long','FHBM1224','Financial Management'),
('Sungai Long|FHCT1012','Sungai Long','FHCT1012','Computing Technology'),
('Sungai Long|FHCT1014','Sungai Long','FHCT1014','Introduction to Data Analytics'),
('Sungai Long|FHCT1022','Sungai Long','FHCT1022','Programming Concepts'),
('Sungai Long|FHCT1024','Sungai Long','FHCT1024','Programming Concepts and Design'),
('Sungai Long|FHEL1024','Sungai Long','FHEL1024','Academic English'),
('Sungai Long|FHEL1114','Sungai Long','FHEL1114','English Language Proficiency'),
('Sungai Long|FHEL1124','Sungai Long','FHEL1124','English for Academic Purposes'),
('Sungai Long|FHEL1134','Sungai Long','FHEL1134','English for Business Communication'),
('Sungai Long|FHHM1012','Sungai Long','FHHM1012','Critical Thinking'),
('Sungai Long|FHHM1022','Sungai Long','FHHM1022','Effective Communication Skills'),
('Sungai Long|FHHM1114','Sungai Long','FHHM1114','Introduction to Sociology'),
('Sungai Long|FHHM1124','Sungai Long','FHHM1124','Socialization as a Process'),
('Sungai Long|FHHM1134','Sungai Long','FHHM1134','Introduction to Social Psychology'),
('Sungai Long|FHHM1214','Sungai Long','FHHM1214','Introduction to Chinese Literature'),
('Sungai Long|FHHM1224','Sungai Long','FHHM1224','Selected Texts of Modern Chinese Literature'),
('Sungai Long|FHHM1244','Sungai Long','FHHM1244','Introduction to Chinese Writing'),
('Sungai Long|FHMM1014','Sungai Long','FHMM1014','Mathematics I'),
('Sungai Long|FHMM1024','Sungai Long','FHMM1024','Mathematics II'),
('Sungai Long|FHMM1034','Sungai Long','FHMM1034','Mathematics III'),
('Sungai Long|FHMM1214','Sungai Long','FHMM1214','Mathematics for Social Science'),
('Sungai Long|FHMM1314','Sungai Long','FHMM1314','Mathematics for Business I'),
('Sungai Long|FHMM1324','Sungai Long','FHMM1324','Mathematics for Business II'),
('Sungai Long|FHSB1234','Sungai Long','FHSB1234','Biology'),
('Sungai Long|FHSC1014','Sungai Long','FHSC1014','Mechanics'),
('Sungai Long|FHSC1024','Sungai Long','FHSC1024','Thermodynamics and Electromagnetism'),
('Sungai Long|FHSC1034','Sungai Long','FHSC1034','Waves and Modern Physics'),
('Sungai Long|FHSC1114','Sungai Long','FHSC1114','Physical Chemistry'),
('Sungai Long|FHSC1124','Sungai Long','FHSC1124','Organic Chemistry'),
('Sungai Long|FHSC1134','Sungai Long','FHSC1134','Inorganic Chemistry'),
('Sungai Long|FHSC1214','Sungai Long','FHSC1214','Fundamentals of Cell Biology'),
('Sungai Long|FHSC1224','Sungai Long','FHSC1224','Introduction to Physiological Systems'),
('Sungai Long|FHSC1234','Sungai Long','FHSC1234','Modern Biology'),
('Sungai Long|FHSP1034','Sungai Long','FHSP1034','Physics'),
('Kampar|MPU3102','Kampar','MPU3102','INTEGRITY AND ANTI-CORRUPTION (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU3112','Kampar','MPU3112','ASPIRASI NEGARA BANGSA (FOR LOCAL STUDENTS)'),
('Kampar|MPU3122','Kampar','MPU3122','FALSAFAH DAN CABARAN SEMASA (FOR LOCAL STUDENTS)'),
('Kampar|MPU3132','Kampar','MPU3132','MALAYSIAN CITRA (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU3142','Kampar','MPU3142','BAHASA MELAYU KOMUNIKASI 2 (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU3143','Kampar','MPU3143','BAHASA MELAYU KOMUNIKASI 2 (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU3152','Kampar','MPU3152','PENGHAYATAN ETIKA DAN PERADABAN (FOR LOCAL STUDENTS)'),
('Kampar|MPU3153','Kampar','MPU3153','PENGHAYATAN ETIKA DAN PERADABAN (FOR LOCAL STUDENTS)'),
('Kampar|MPU3162','Kampar','MPU3162','KURSUS INTEGRITI DAN ANTIRASUAH (FOR LOCAL STUDENTS)'),
('Kampar|MPU3182','Kampar','MPU3182','FALSAFAH DAN ISU SEMASA'),
('Kampar|MPU3183','Kampar','MPU3183','FALSAFAH DAN ISU SEMASA'),
('Kampar|MPU3192','Kampar','MPU3192','PHILOSOPHY AND CURRENT ISSUES (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU3193','Kampar','MPU3193','PHILOSOPHY AND CURRENT ISSUES (FOR INTERNATIONAL STUDENTS)'),
('Kampar|MPU32013','Kampar','MPU32013','BAHASA KEBANGSAAN A'),
('Kampar|MPU3202','Kampar','MPU3202','INTEGRITY AND ANTI-CORRUPTION'),
('Kampar|MPU32022','Kampar','MPU32022','ENGLISH FOR BUSINESS'),
('Kampar|MPU32023','Kampar','MPU32023','ENGLISH FOR BUSINESS'),
('Kampar|MPU32062','Kampar','MPU32062','ENGLISH FOR MASS COMMUNICATION'),
('Kampar|MPU32063','Kampar','MPU32063','ENGLISH FOR MASS COMMUNICATION'),
('Sungai Long|MPU32073','Sungai Long','MPU32073','COMMUNICATIVE ENGLISH'),
('Kampar|MPU32142','Kampar','MPU32142','ENGLISH FOR INFORMATION TECHNOLOGY'),
('Kampar|MPU32143','Kampar','MPU32143','ENGLISH FOR INFORMATION TECHNOLOGY'),
('Kampar|MPU32182','Kampar','MPU32182','ENGLISH PROFICIENCY I'),
('Kampar|MPU32183','Kampar','MPU32183','ENGLISH PROFICIENCY I'),
('Kampar|MPU33012','Kampar','MPU33012','MALAYSIAN ECONOMY'),
('Kampar|MPU33013','Kampar','MPU33013','MALAYSIAN ECONOMY'),
('Kampar|MPU33022','Kampar','MPU33022','BUSINESS AND SOCIETY'),
('Kampar|MPU33023','Kampar','MPU33023','BUSINESS AND SOCIETY'),
('Kampar|MPU33053','Kampar','MPU33053','INTRODUCTION TO POLITICAL SCIENCE'),
('Kampar|MPU33083','Kampar','MPU33083','HUMAN RESOURCE MANAGEMENT'),
('Kampar|MPU33143','Kampar','MPU33143','MALAYSIAN ECONOMY'),
('Kampar|MPU33152','Kampar','MPU33152','MALAYSIAN ECONOMY'),
('Sungai Long|MPU33153','Sungai Long','MPU33153','COMMUNICATION LAW'),
('Sungai Long|MPU33173','Sungai Long','MPU33173','/'),
('Kampar|MPU33293','Kampar','MPU33293','CONFUCIANISM AND MODERN SOCIETY'),
('Kampar|MPU33413','Kampar','MPU33413','BUSINESS ETHICS'),
('Kampar|MPU33423','Kampar','MPU33423','BUSINESS AND SOCIETY'),
('Kampar|MPU3402','Kampar','MPU3402','INTEGRITY AND ANTI-CORRUPTION'),
('Kampar|MPU34032','Kampar','MPU34032','COMMUNITY PROJECT'),
('Kampar|MPU34072','Kampar','MPU34072','ART, CRAFT, AND DESIGN'),
('Kampar|MPU34082','Kampar','MPU34082','ORAL COMMUNICATION'),
('Kampar|MPU34102','Kampar','MPU34102','MANAGING PERSONAL FINANCE'),
('Kampar|MPU34132','Kampar','MPU34132','MANAGEMENT OF SPORTS ACTIVITY'),
('Kampar|MPU34142','Kampar','MPU34142','CRITICAL THINKING, CREATIVE THINKING AND PROBLEM SOLVING'),
('Kampar|MPU34152','Kampar','MPU34152','LEADERSHIP AND TEAMBUILDING'),
('Kampar|MPU34162','Kampar','MPU34162','BUSINESS PLAN WRITING & PREPARATION'),
('Kampar|MPU34182','Kampar','MPU34182','MASSIVE OPEN ONLINE COURSE (MOOC)'),
('Kampar|UALB1003','Kampar','UALB1003','INTRODUCTION TO GERMAN LANGUAGE'),
('Sungai Long|UALE1013','Sungai Long','UALE1013','ENGLISH FOR MASS COMMUNICATION'),
('Sungai Long|UALE1023','Sungai Long','UALE1023','ENGLISH FOR BUSINESS'),
('Kampar|UALE1083','Kampar','UALE1083','BASIC PROFESSIONAL WRITING'),
('Kampar|UALE1113','Kampar','UALE1113','ENGLISH PROFICIENCY I'),
('Kampar|UALE1123','Kampar','UALE1123','ENGLISH PROFICIENCY 2'),
('Kampar|UALE2003','Kampar','UALE2003','ENGLISH FOR MANAGEMENT'),
('Kampar|UALF1003','Kampar','UALF1003','INTRODUCTION TO FRENCH'),
('Kampar|UALJ2013','Kampar','UALJ2013','INTRODUCTION TO JAPANESE'),
('Kampar|UALL1053','Kampar','UALL1053','CRITICAL READING AND THINKING'),
('Kampar|UALL2023','Kampar','UALL2023','ACADEMIC WRITING'),
('Kampar|UALL3033','Kampar','UALL3033','PUBLIC SPEAKING AND ORAL PRESENTATION'),
('Kampar|UALM1003','Kampar','UALM1003','INTRODUCTION TO TAMIL LANGUAGE'),
('Kampar|UAMA1173','Kampar','UAMA1173','INTRODUCTION TO SOCIAL MEDIA STRATEGY'),
('Kampar|UAMG1043','Kampar','UAMG1043','INTERPERSONAL COMMUNICATION'),
('Kampar|UAMP1004','Kampar','UAMP1004','PUBLIC RELATIONS'),
('Kampar|UAMP2034','Kampar','UAMP2034','CRISIS COMMUNICATION IN PUBLIC RELATIONS'),
('Kampar|UAPO2023','Kampar','UAPO2023','PUBLIC ADMINSTRATION'),
('Kampar|UAPO2123','Kampar','UAPO2123','PUBLIC ADMINSTRATION'),
('Kampar|UAPP1063','Kampar','UAPP1063','Child and Adolescent Psychology'),
('Kampar|UAPP1064','Kampar','UAPP1064','Introduction to Psychology'),
('Kampar|UAPP1073','Kampar','UAPP1073','History of Psychology'),
('Kampar|UAPP1103','Kampar','UAPP1103','History of Psychology'),
('Kampar|UAPP3073','Kampar','UAPP3073','POSITIVE PSYCHOLOGY'),
('Kampar|UAPP3083','Kampar','UAPP3083','Positive Psychology'),
('Sungai Long|UAPS20003','Sungai Long','UAPS20003','Introduction to Sociology'),
('Kampar|UAPS2003','Kampar','UAPS2003','INTRODUCTION TO SOCIOLOGY'),
('Kampar|UAPS2013','Kampar','UAPS2013','CULTURE AND COMMUNICATION'),
('Kampar|UBAE3013','Kampar','UBAE3013','BUSINESS AND SOCIETY'),
('Kampar|UBAE3023','Kampar','UBAE3023','BUSINESS ETHICS'),
('Kampar|UBAE3033','Kampar','UBAE3033','CORPORATE ETHICS AND GOVERNANCE'),
('Kampar|UBAE3533','Kampar','UBAE3533','CORPORATE ETHICS AND GOVERNANCE'),
('Kampar|UBAF1013','Kampar','UBAF1013','FINANCIAL ACCOUNTING FRAMEWORK I'),
('Kampar|UBAF1023','Kampar','UBAF1023','FINANCIAL ACCOUNTING FRAMEWORK I'),
('Kampar|UBAF1033','Kampar','UBAF1033','BUSINESS ACCOUNTING I'),
('Kampar|UBAF1043','Kampar','UBAF1043','BUSINESS ACCOUNTING'),
('Kampar|UBAF1053','Kampar','UBAF1053','ACCOUNTING IN PRACTICE'),
('Kampar|UBAF1083','Kampar','UBAF1083','BUSINESS ACCOUNTING'),
('Kampar|UBAF1093','Kampar','UBAF1093','BUSINESS ACCOUNTING I'),
('Kampar|UBAF1163','Kampar','UBAF1163','FINANCIAL ACCOUNTING FRAMEWORK II'),
('Kampar|UBAF1173','Kampar','UBAF1173','BUSINESS ACCOUNTING II'),
('Kampar|UBAF1183','Kampar','UBAF1183','FINANCIAL ACCOUNTING FRAMEWORK II'),
('Kampar|UBAF1193','Kampar','UBAF1193','BUSINESS ACCOUNTING II'),
('Kampar|UBAF2043','Kampar','UBAF2043','FINANCIAL ACCOUNTING'),
('Kampar|UBAF2113','Kampar','UBAF2113','ADVANCED FINANCIAL ACCOUNTING'),
('Kampar|UBAF2123','Kampar','UBAF2123','AUDITING AND ASSURANCE SERVICES I'),
('Kampar|UBAF2143','Kampar','UBAF2143','ADVANCED FINANCIAL ACCOUNTING'),
('Kampar|UBAF2144','Kampar','UBAF2144','AUDITING AND ASSURANCE SERVICES II'),
('Kampar|UBAF3013','Kampar','UBAF3013','ADVANCED ACCOUNTING PRACTICE'),
('Kampar|UBAF3023','Kampar','UBAF3023','CORPORATE REPORTING AND CURRENT ISSUES'),
('Kampar|UBAF3063','Kampar','UBAF3063','INTERNAL AUDITING IN BANKING OPERATIONS'),
('Kampar|UBAF3073','Kampar','UBAF3073','INTERNAL AUDITING IN BANKING OPERATIONS'),
('Kampar|UBAF33712','Kampar','UBAF33712','INDUSTRIAL TRAINING'),
('Kampar|UBAF3378','Kampar','UBAF3378','INDUSTRIAL TRAINING'),
('Kampar|UBAI1113','Kampar','UBAI1113','INFORMATION SYSTEMS'),
('Kampar|UBAI1133','Kampar','UBAI1133','INFORMATION SYSTEMS'),
('Kampar|UBAI1143','Kampar','UBAI1143','INFORMATION TECHNOLOGY FOR MANAGEMENT'),
('Kampar|UBAI1153','Kampar','UBAI1153','DIGITAL INTELLIGENCE IN BUSINESS MANAGEMENT'),
('Kampar|UBAI1163','Kampar','UBAI1163','DIGITAL INTELLIGENCE IN BUSINESS MANAGEMENT'),
('Kampar|UBAI2023','Kampar','UBAI2023','ACCOUNTING INFORMATION SYSTEMS'),
('Kampar|UBAI2043','Kampar','UBAI2043','IT FOR MANAGEMENT'),
('Kampar|UBAI2053','Kampar','UBAI2053','MANAGING INFORMATION SYSTEMS'),
('Kampar|UBAI3113','Kampar','UBAI3113','APPLIED ECOMMERCE'),
('Kampar|UBAI3123','Kampar','UBAI3123','APPLIED ENTERPRISE RESOURCE PLANNING'),
('Kampar|UBAI3133','Kampar','UBAI3133','DIGITAL ENTREPRENEURSHIP'),
('Kampar|UBAI3214','Kampar','UBAI3214','DIGITAL FORENSIC ACCOUNTING'),
('Kampar|UBAM1013','Kampar','UBAM1013','FINANCIAL INFORMATION FOR MANAGEMENT'),
('Kampar|UBAM2023','Kampar','UBAM2023','PERFORMANCE MANAGEMENT'),
('Kampar|UBAM2033','Kampar','UBAM2033','MANAGERIAL ACCOUNTING'),
('Kampar|UBAM3013','Kampar','UBAM3013','MANAGEMENT ACCOUNTING'),
('Kampar|UBAM3023','Kampar','UBAM3023','MANAGEMENT ACCOUNTING'),
('Kampar|UBAM3033','Kampar','UBAM3033','MANAGEMENT ACCOUNTING DECISION MAKING'),
('Kampar|UBAT2113','Kampar','UBAT2113','TAXATION'),
('Kampar|UBAT3013','Kampar','UBAT3013','BUSINESS TAXATION'),
('Kampar|UBAT3063','Kampar','UBAT3063','BUSINESS TAXATION'),
('Kampar|UBAT3124','Kampar','UBAT3124','ADVANCED TAXATION'),
('Kampar|UBEA1013','Kampar','UBEA1013','ECONOMICS'),
('Kampar|UBEA1063','Kampar','UBEA1063','PRINCIPLES OF MICROECONOMICS'),
('Kampar|UBEA1073','Kampar','UBEA1073','PRINCIPLES OF MACROECONOMICS'),
('Kampar|UBEA1113','Kampar','UBEA1113','ECONOMICS'),
('Kampar|UBEA1163','Kampar','UBEA1163','PRINCIPLES OF MICROECONOMICS'),
('Kampar|UBEA1173','Kampar','UBEA1173','PRINCIPLES OF MACROECONOMICS'),
('Kampar|UBEA2043','Kampar','UBEA2043','ECONOMIC DEVELOPMENT'),
('Kampar|UBEA2053','Kampar','UBEA2053','MALAYSIAN ECONOMY'),
('Kampar|UBEA2153','Kampar','UBEA2153','MICROECONOMICS FOUNDATION FOR FINANCIAL ANALYSIS'),
('Kampar|UBEA2173','Kampar','UBEA2173','CURRENT ISSUES IN ECONOMICS AND FINANCE'),
('Kampar|UBEA2183','Kampar','UBEA2183','MONEY AND FINANCIAL TECHNOLOGY'),
('Kampar|UBEA2233','Kampar','UBEA2233','INTERMEDIATE MACROECONOMICS'),
('Kampar|UBEA2243','Kampar','UBEA2243','INTERMEDIATE MICROECONOMICS'),
('Kampar|UBEA2283','Kampar','UBEA2283','MONEY AND FINANCIAL TECHNOLOGY'),
('Kampar|UBEA3013','Kampar','UBEA3013','INDUSTRIAL ECONOMICS'),
('Kampar|UBEA3033','Kampar','UBEA3033','INTERNATIONAL TRADE'),
('Kampar|UBEA3063','Kampar','UBEA3063','ORGANISATIONAL ECONOMICS AND CASE ANALYSIS'),
('Kampar|UBEA3073','Kampar','UBEA3073','INTERNATIONAL ECONOMICS'),
('Kampar|UBEQ1013','Kampar','UBEQ1013','QUANTITATIVE TECHNIQUES I'),
('Kampar|UBEQ1033','Kampar','UBEQ1033','BUSINESS MATHEMATICS'),
('Kampar|UBEQ1043','Kampar','UBEQ1043','BUSINESS STATISTICS'),
('Kampar|UBEQ1113','Kampar','UBEQ1113','QUANTITATIVE TECHNIQUES I'),
('Kampar|UBEQ1123','Kampar','UBEQ1123','QUANTITATIVE TECHNIQUES II'),
('Kampar|UBEQ1213','Kampar','UBEQ1213','BUSINESS MATHEMATICS'),
('Kampar|UBEQ1223','Kampar','UBEQ1223','QUANTITATIVE TECHNIQUES II'),
('Kampar|UBEQ1233','Kampar','UBEQ1233','BUSINESS STATISTICS'),
('Kampar|UBEQ2013','Kampar','UBEQ2013','BASIC ECONOMETRICS'),
('Kampar|UBEQ2113','Kampar','UBEQ2113','BASIC ECONOMETRICS'),
('Kampar|UBEQ2123','Kampar','UBEQ2123','ECONOMETRICS'),
('Kampar|UBEQ2133','Kampar','UBEQ2133','ECONOMETRIC ANALYSIS'),
('Kampar|UBEQ2223','Kampar','UBEQ2223','ECONOMETRICS'),
('Kampar|UBEQ2233','Kampar','UBEQ2233','ECONOMETRIC ANALYSIS'),
('Kampar|UBEQ2243','Kampar','UBEQ2243','DATA ANALYTICS'),
('Kampar|UBEQ3013','Kampar','UBEQ3013','TIME SERIES ANALYSIS'),
('Kampar|UBEQ3023','Kampar','UBEQ3023','TIME SERIES ANALYSIS AND FORECASTING'),
('Kampar|UBEQ3113','Kampar','UBEQ3113','TIME SERIES ANALYSIS'),
('Kampar|UBEZ3013','Kampar','UBEZ3013','RESEARCH METHODS'),
('Kampar|UBEZ3026','Kampar','UBEZ3026','UNDERGRADUATE PROJECT'),
('Kampar|UBFB1023','Kampar','UBFB1023','FINANCIAL INSTITUTIONS OPERATIONS'),
('Kampar|UBFB2022','Kampar','UBFB2022','FINANCIAL LITERACY AND PLANNING'),
('Kampar|UBFB2023','Kampar','UBFB2023','CREDIT ANALYSIS AND LENDING'),
('Kampar|UBFB2033','Kampar','UBFB2033','MONEY AND BANKING MANAGEMENT'),
('Kampar|UBFB2233','Kampar','UBFB2233','MONEY AND BANKING MANAGEMENT'),
('Kampar|UBFB3013','Kampar','UBFB3013','BANKING OPERATIONS AND TREASURY MANAGEMENT'),
('Kampar|UBFB3023','Kampar','UBFB3023','COMMERCIAL BANK MANAGEMENT'),
('Kampar|UBFB3043','Kampar','UBFB3043','FINANCIAL MARKETS AND INSTITUTIONS'),
('Kampar|UBFB3123','Kampar','UBFB3123','ISLAMIC BANKING'),
('Kampar|UBFB3143','Kampar','UBFB3143','PERSONAL FINANCIAL PLANNING AND MANAGEMENT'),
('Kampar|UBFB3213','Kampar','UBFB3213','BANKING OPERATIONS AND TREASURY MANAGEMENT'),
('Kampar|UBFB3223','Kampar','UBFB3223','ISLAMIC BANKING'),
('Kampar|UBFB3243','Kampar','UBFB3243','PERSONAL FINANCIAL PLANNING AND MANAGEMENT'),
('Kampar|UBFB3643','Kampar','UBFB3643','FINANCIAL MARKETS AND INSTITUTIONS'),
('Kampar|UBFB3743','Kampar','UBFB3743','FINANCIAL MARKETS AND INSTITUTIONS'),
('Kampar|UBFB3843','Kampar','UBFB3843','PERSONAL FINANCIAL PLANNING AND MANAGEMENT'),
('Kampar|UBFB4094','Kampar','UBFB4094','INTERNATIONAL MONETARY SYSTEMS AND BANKING'),
('Kampar|UBFF1012','Kampar','UBFF1012','MEDICAL INSURANCE'),
('Kampar|UBFF2013','Kampar','UBFF2013','BUSINESS FINANCE'),
('Kampar|UBFF2033','Kampar','UBFF2033','FINANCIAL INVESTMENT'),
('Kampar|UBFF2063','Kampar','UBFF2063','INVESTMENT MANAGEMENT'),
('Kampar|UBFF2083','Kampar','UBFF2083','FINANCIAL MANAGEMENT'),
('Kampar|UBFF2313','Kampar','UBFF2313','BUSINESS FINANCE'),
('Kampar|UBFF2763','Kampar','UBFF2763','INVESTMENT MANAGEMENT'),
('Kampar|UBFF3013','Kampar','UBFF3013','CORPORATE FINANCE'),
('Kampar|UBFF3063','Kampar','UBFF3063','FINANCIAL DERIVATIVES'),
('Kampar|UBFF3083','Kampar','UBFF3083','FINANCIAL STATEMENT ANALYSIS'),
('Kampar|UBFF3143','Kampar','UBFF3143','INTRODUCTION TO FINANCIAL PREDICTION WITH MACHINE LEARNING IN PYTHON'),
('Kampar|UBFF3243','Kampar','UBFF3243','INTERNATIONAL FINANCE'),
('Kampar|UBFF3283','Kampar','UBFF3283','PORTFOLIO MANAGEMENT'),
('Kampar|UBFF3293','Kampar','UBFF3293','RISK MANAGEMENT'),
('Kampar|UBFF3303','Kampar','UBFF3303','INTRODUCTION TO FINANCIAL PREDICTION WITH MACHINE LEARNING IN PYTHON'),
('Kampar|UBFF3313','Kampar','UBFF3313','STRATEGIC FINANCIAL MANAGEMENT'),
('Kampar|UBFF3333','Kampar','UBFF3333','SUSTAINABLE FINANCE AND IMPACT INVESTING'),
('Kampar|UBFF3343','Kampar','UBFF3343','INTERNATIONAL FINANCE'),
('Kampar|UBFF3363','Kampar','UBFF3363','ISLAMIC FINANCE'),
('Kampar|UBFF3373','Kampar','UBFF3373','INTRODUCTION TO PYTHON PROGRAMMING'),
('Kampar|UBFF3376','Kampar','UBFF3376','INDUSTRIAL TRAINING'),
('Kampar|UBFF3383','Kampar','UBFF3383','PORTFOLIO MANAGEMENT'),
('Kampar|UBFF3393','Kampar','UBFF3393','RISK MANAGEMENT'),
('Kampar|UBFF3403','Kampar','UBFF3403','INTRODUCTION TO FINANCIAL PREDICTION WITH MACHINE LEARNING IN PYTHON'),
('Kampar|UBFF3413','Kampar','UBFF3413','ADVANCED FINANCIAL PREDICTION WITH DEEP LEARNING IN PYTHON'),
('Kampar|UBFF3423','Kampar','UBFF3423','INTRODUCTION TO FINANCIAL MODELLING'),
('Kampar|UBFF3443','Kampar','UBFF3443','ADVANCED FINANCIAL PREDICTION WITH DEEP LEARNING IN PYTHON'),
('Kampar|UBFF3463','Kampar','UBFF3463','FINANCIAL DERIVATIVES'),
('Kampar|UBFF3483','Kampar','UBFF3483','ADVANCED FINANCIAL PREDICTION WITH DEEP LEARNING IN PYTHON'),
('Kampar|UBFF3663','Kampar','UBFF3663','SUSTAINABLE FINANCE AND IMPACT INVESTING'),
('Kampar|UBFF3713','Kampar','UBFF3713','CORPORATE FINANCE'),
('Kampar|UBFF3763','Kampar','UBFF3763','FINANCIAL DERIVATIVES'),
('Kampar|UBFF3783','Kampar','UBFF3783','FINANCIAL STATEMENT ANALYSIS'),
('Kampar|UBFF3963','Kampar','UBFF3963','ISLAMIC FINANCE'),
('Kampar|UBFF3983','Kampar','UBFF3983','PORTFOLIO MANAGEMENT'),
('Kampar|UBFF3993','Kampar','UBFF3993','RISK MANAGEMENT'),
('Kampar|UBFF4014','Kampar','UBFF4014','FIXED INCOME SECURITIES'),
('Kampar|UBFF4024','Kampar','UBFF4024','MULTINATIONAL FINANCE'),
('Kampar|UBFR2233','Kampar','UBFR2233','ANTI-MONEY LAUNDERING AND COUNTER TERRORISM FINANCING'),
('Kampar|UBFR2243','Kampar','UBFR2243','ANTI-MONEY LAUNDERING AND COUNTER TERRORISM FINANCING'),
('Kampar|UBFR3013','Kampar','UBFR3013','PRINCIPLES OF RISK MANAGEMENT AND INSURANCE'),
('Kampar|UBFR3033','Kampar','UBFR3033','ENTERPRISE RISK MANAGEMENT'),
('Kampar|UBFR3053','Kampar','UBFR3053','OPERATIONAL AND LIQUIDITY RISK MANAGEMENT IN FINANCIAL INSTITUTIONS'),
('Kampar|UBFR3143','Kampar','UBFR3143','CREDIT AND MARKET RISK MANAGEMENT'),
('Kampar|UBFR3153','Kampar','UBFR3153','OPERATIONAL RISK MANAGEMENT IN FINANCIAL INSTITUTIONS'),
('Kampar|UBFR3376','Kampar','UBFR3376','INDUSTRIAL TRAINING'),
('Kampar|UBFZ3026','Kampar','UBFZ3026','RESEARCH PROJECT'),
('Kampar|UBHM1013','Kampar','UBHM1013','PRINCIPLES OF HEALTHCARE MANAGEMENT'),
('Kampar|UBHM1023','Kampar','UBHM1023','PRINCIPLES OF HEALTHCARE'),
('Kampar|UBHM1033','Kampar','UBHM1033','HEALTHCARE PROGRAM PLANNING AND EVALUATION'),
('Kampar|UBHM1043','Kampar','UBHM1043','PRINCIPLES OF HEALTH EDUCATION AND PROMOTION'),
('Kampar|UBHM1053','Kampar','UBHM1053','TERMINOLOGY IN HEALTHCARE MANAGEMENT'),
('Kampar|UBHM2023','Kampar','UBHM2023','NATIONAL HEALTH POLICY'),
('Kampar|UBHM2033','Kampar','UBHM2033','HEALTHCARE SERVICE AND SYSTEM IN MALAYSIA'),
('Kampar|UBHM2043','Kampar','UBHM2043','OCCUPATIONAL HEALTH, SAFETY AND RISK MANAGEMENT'),
('Kampar|UBHM2053','Kampar','UBHM2053','SOCIAL CULTURAL ISSUES OF HEALTH CARE'),
('Kampar|UBHM3013','Kampar','UBHM3013','DISEASE PREVENTION'),
('Kampar|UBHM3023','Kampar','UBHM3023','PLANNING, DESIGNING AND MANAGEMENT OF CLINICAL SERVICES DEPARTMENT'),
('Kampar|UBHM3033','Kampar','UBHM3033','QUALITY MANAGEMENT AND HOSPITAL ACCREDITATION SYSTEM'),
('Kampar|UBHM3043','Kampar','UBHM3043','HOSPITAL SUPPORT SERVICES'),
('Kampar|UBHM3376','Kampar','UBHM3376','INDUSTRIAL TRAINING'),
('Kampar|UBHZ3016','Kampar','UBHZ3016','RESEARCH PROJECT'),
('Kampar|UBMB3013','Kampar','UBMB3013','INTERNATIONAL BUSINESS'),
('Kampar|UBMH1013','Kampar','UBMH1013','ORGANISATION AND HUMAN RESOURCE'),
('Kampar|UBMH2013','Kampar','UBMH2013','HUMAN RESOURCE MANAGEMENT'),
('Kampar|UBMH2023','Kampar','UBMH2023','RECRUITMENT AND RESOURCING'),
('Kampar|UBMH2033','Kampar','UBMH2033','TRAINING AND CAREER DEVELOPMENT'),
('Kampar|UBMH2043','Kampar','UBMH2043','PERFORMANCE MANAGEMENT AND REWARD SYSTEMS'),
('Kampar|UBMH2513','Kampar','UBMH2513','HUMAN RESOURCE MANAGEMENT'),
('Kampar|UBML1013','Kampar','UBML1013','CORPORATE AND BUSINESS LAW'),
('Kampar|UBML1053','Kampar','UBML1053','BUSINESS LAW'),
('Kampar|UBML1513','Kampar','UBML1513','CORPORATE AND BUSINESS LAW'),
('Kampar|UBML1553','Kampar','UBML1553','BUSINESS LAW'),
('Kampar|UBML2013','Kampar','UBML2013','COMPANY LAW'),
('Kampar|UBML2033','Kampar','UBML2033','LEGAL FRAMEWORK OF BANKING AND FINANCIAL INSTITUTIONS'),
('Kampar|UBML3013','Kampar','UBML3013','INDUSTRIAL RELATIONS'),
('Kampar|UBML3023','Kampar','UBML3023','MALAYSIAN COMPANY SECRETARIAL PRACTICE'),
('Kampar|UBML3043','Kampar','UBML3043','CORPORATE GOVERNANCE,RISK MANAGEMENT AND COMPLIANCE'),
('Kampar|UBML3523','Kampar','UBML3523','MALAYSIAN COMPANY SECRETARIAL PRACTICE'),
('Kampar|UBML3533','Kampar','UBML3533','CORPORATE GOVERNANCE'),
('Kampar|UBMM1011','Kampar','UBMM1011','SUN ZI''S ART OF WAR AND BUSINESS STRATEGIES'),
('Kampar|UBMM1013','Kampar','UBMM1013','MANAGEMENT PRINCIPLES'),
('Kampar|UBMM1513','Kampar','UBMM1513','MANAGEMENT PRINCIPLES'),
('Kampar|UBMM2013','Kampar','UBMM2013','OPERATIONS MANAGEMENT'),
('Kampar|UBMM2023','Kampar','UBMM2023','ORGANISATIONAL BEHAVIOUR'),
('Kampar|UBMM2033','Kampar','UBMM2033','PROJECT MANAGEMENT'),
('Kampar|UBMM2043','Kampar','UBMM2043','SECURITY AND DEFENSE MANAGEMENT'),
('Kampar|UBMM2523','Kampar','UBMM2523','ORGANISATIONAL BEHAVIOUR'),
('Kampar|UBMM2723','Kampar','UBMM2723','OPERATIONS MANAGEMENT'),
('Kampar|UBMM3014','Kampar','UBMM3014','STRATEGIC MANAGEMENT AND PROJECT'),
('Kampar|UBMM3023','Kampar','UBMM3023','ORGANISATIONAL DEVELOPMENT'),
('Kampar|UBMM3033','Kampar','UBMM3033','LEADERSHIP AND TEAM BUILDING'),
('Kampar|UBMM3376','Kampar','UBMM3376','INDUSTRIAL TRAINING'),
('Kampar|UBMM3513','Kampar','UBMM3513','STRATEGIC MANAGEMENT'),
('Kampar|UBMM3514','Kampar','UBMM3514','STRATEGIC MANAGEMENT AND PROJECT'),
('Kampar|UBMM3533','Kampar','UBMM3533','LEADERSHIP AND TEAM BUILDING'),
('Kampar|UBMZ2013','Kampar','UBMZ2013','BUSINESS RESEARCH'),
('Kampar|UBMZ3016','Kampar','UBMZ3016','RESEARCH PROJECT'),
('Kampar|UBPA1103','Kampar','UBPA1103','INTRODUCTION TO PUBLIC POLICY'),
('Kampar|UBPA1313','Kampar','UBPA1313','BAHASA MELAYU UNTUK PENGURUSAN'),
('Kampar|UBPA2004','Kampar','UBPA2004','INTERNATIONAL POLITICS AND ORGANISATIONS'),
('Kampar|UBPA2013','Kampar','UBPA2013','LOCAL GOVERNMENT'),
('Kampar|UBPA2043','Kampar','UBPA2043','INTERGOVERNMENTAL RELATIONS'),
('Kampar|UBPA3013','Kampar','UBPA3013','PUBLIC FINANCE'),
('Kampar|UBPA3023','Kampar','UBPA3023','ETHICS FOR PUBLIC ADMINISTRATORS'),
('Kampar|UBPL1013','Kampar','UBPL1013','ADMINISTRATIVE LAW'),
('Kampar|UBPL2013','Kampar','UBPL2013','ASEAN LAW'),
('Kampar|UBPM1013','Kampar','UBPM1013','PUBLIC ENTERPRISE MANAGEMENT'),
('Kampar|UBPM2013','Kampar','UBPM2013','MANAGEMENT IN NON-PROFIT ORGANISATION'),
('Kampar|UBPM2023','Kampar','UBPM2023','CRISIS MANAGEMENT'),
('Kampar|UBPM3013','Kampar','UBPM3013','MANAGEMENT IN CIVIL SOCIETY ORGANISATIONS'),
('Kampar|UBPM3376','Kampar','UBPM3376','INDUSTRIAL TRAINING'),
('Kampar|UBPZ3016','Kampar','UBPZ3016','RESEARCH PROJECT'),
('Kampar|UBSM2013','Kampar','UBSM2013','SUPPLY CHAIN MANAGEMENT DECISION MAKING'),
('Kampar|UBSM2024','Kampar','UBSM2024','PROCUREMENT MANAGEMENT AND GLOBAL SOURCING'),
('Kampar|UBSM2033','Kampar','UBSM2033','SUPPLY CHAIN OPPORTUNITY AND RISK MANAGEMENT'),
('Kampar|UBSM3044','Kampar','UBSM3044','WAREHOUSE AND DISTRIBUTION MANAGEMENT'),
('Kampar|UBSM3053','Kampar','UBSM3053','SUPPLY CHAIN OPERATIONS REFERENCE (SCOR) MODEL'),
('Kampar|UBSM3066','Kampar','UBSM3066','RESEARCH PROJECT'),
('Kampar|UBSM3376','Kampar','UBSM3376','INDUSTRIAL TRAINING'),
('Kampar|UBSM3378','Kampar','UBSM3378','INDUSTRIAL TRAINING'),
('Kampar|UBTA3203','Kampar','UBTA3203','MARKETING COMMUNICATION STRATEGY'),
('Kampar|UBTC2023','Kampar','UBTC2023','CONSUMER BEHAVIOUR'),
('Kampar|UBTC2033','Kampar','UBTC2033','CUSTOMER RELATIONSHIP MANAGEMENT'),
('Kampar|UBTC2043','Kampar','UBTC2043','CUSTOMER RELATIONSHIP MANAGEMENT'),
('Kampar|UBTD2733','Kampar','UBTD2733','LOGISTICS MANAGEMENT'),
('Kampar|UBTE2013','Kampar','UBTE2013','ENTREPRENEURSHIP'),
('Kampar|UBTE2743','Kampar','UBTE2743','ENTREPRENEURSHIP'),
('Kampar|UBTE3013','Kampar','UBTE3013','SMALL BUSINESS MANAGEMENT'),
('Kampar|UBTE3023','Kampar','UBTE3023','MANAGING INNOVATION'),
('Kampar|UBTE3033','Kampar','UBTE3033','FAMILY BUSINESS MANAGEMENT'),
('Kampar|UBTE3043','Kampar','UBTE3043','CONTEMPORARY ISSUES IN ENTREPRENEURSHIP AND INNOVATION'),
('Kampar|UBTE3053','Kampar','UBTE3053','NEW VENTURE CREATION'),
('Kampar|UBTE3063','Kampar','UBTE3063','CREATIVITY AND INNOVATION'),
('Kampar|UBTE3753','Kampar','UBTE3753','MANAGING INNOVATION'),
('Kampar|UBTE3763','Kampar','UBTE3763','CREATIVITY AND INNOVATION'),
('Kampar|UBTI2023','Kampar','UBTI2023','GLOBAL MARKETING'),
('Kampar|UBTM1013','Kampar','UBTM1013','PRINCIPLES OF MARKETING'),
('Kampar|UBTM1023','Kampar','UBTM1023','PRINCIPLES OF MARKETING'),
('Kampar|UBTM2023','Kampar','UBTM2023','EVENT MANAGEMENT'),
('Kampar|UBTM2033','Kampar','UBTM2033','BRAND STRATEGY'),
('Kampar|UBTM3013','Kampar','UBTM3013','BUSINESS-TO-BUSINESS MARKETING'),
('Kampar|UBTM3023','Kampar','UBTM3023','DIGITAL MARKETING'),
('Kampar|UBTM3043','Kampar','UBTM3043','DIGITAL MARKETING'),
('Kampar|UBTM3103','Kampar','UBTM3103','SERVICE MANAGEMENT'),
('Kampar|UBTM3203','Kampar','UBTM3203','MARKETING ANALYSIS AND DECISION MAKING'),
('Kampar|UBTM3303','Kampar','UBTM3303','STRATEGIC MARKETING PLANNING AND CONTROL'),
('Kampar|UBTR2113','Kampar','UBTR2113','MARKETING RESEARCH IN PRACTICE'),
('Kampar|UBTS1013','Kampar','UBTS1013','PRINCIPLES OF RETAILING'),
('Kampar|UBTS2013','Kampar','UBTS2013','SUPPLY CHAIN MANAGEMENT IN RETAIL'),
('Kampar|UBTS2113','Kampar','UBTS2113','INTERNATIONAL RETAILING'),
('Kampar|UBTS3013','Kampar','UBTS3013','MERCHANDISE MANAGEMENT'),
('Kampar|UBTS3113','Kampar','UBTS3113','VISUAL MERCHANDISING AND DISPLAY'),
('Kampar|UBTS3213','Kampar','UBTS3213','RETAIL PRICING'),
('Kampar|UBTS3316','Kampar','UBTS3316','BUSINESS PROJECT'),
('Kampar|UBTS3376','Kampar','UBTS3376','INDUSTRIAL TRAINING'),
('Kampar|UBTT1013','Kampar','UBTT1013','TOURISM PRINCIPLES, PRACTICES AND PHILOSOPHIES'),
('Kampar|UBTT1023','Kampar','UBTT1023','TOURISM MANAGEMENT'),
('Kampar|UBTT1033','Kampar','UBTT1033','MARKETING FOR TOURISM AND HOSPITALITY'),
('Kampar|UBTT1043','Kampar','UBTT1043','HOSPITALITY SERVICE'),
('Kampar|UBTT2013','Kampar','UBTT2013','SOCIAL AND CULTURAL IMPACTS OF TOURISM'),
('Kampar|UBTT2023','Kampar','UBTT2023','TOURISM AND THE ENVIRONMENT'),
('Kampar|UBTT2033','Kampar','UBTT2033','ECO TOURISM'),
('Kampar|UBTT2043','Kampar','UBTT2043','HEALTH INFORMATION MANAGEMENT'),
('Kampar|UBTT2053','Kampar','UBTT2053','MEDICAL TOURISM'),
('Kampar|UBTT3013','Kampar','UBTT3013','GASTRONOMY TOURISM'),
('Kampar|UBTT3023','Kampar','UBTT3023','INTERNATIONAL HOTELS DEVELOPMENT AND MANAGEMENT'),
('Kampar|UBTT3033','Kampar','UBTT3033','SAFETY AND SECURITY FOR TOURISM DESTINATION'),
('Kampar|UBTT3043','Kampar','UBTT3043','TOURISM PLANNING AND POLICY'),
('Kampar|UBTT3053','Kampar','UBTT3053','DOMESTIC/OVERSEAS STUDY TOUR'),
('Kampar|UBTT3063','Kampar','UBTT3063','TOURISM PLANNING AND POLICY'),
('Kampar|UBTZ3016','Kampar','UBTZ3016','ENTREPRENEURIAL PROJECT'),
('Kampar|UBTZ3026','Kampar','UBTZ3026','RESEARCH PROJECT'),
('Kampar|UCCA2103','Kampar','UCCA2103','MANAGEMENT INFORMATION SYSTEMS'),
('Kampar|UCCA2403','Kampar','UCCA2403','INTRODUCTION TO DATA ENGINEERING'),
('Kampar|UCCA2513','Kampar','UCCA2513','MINI PROJECT'),
('Kampar|UCCA2596','Kampar','UCCA2596','Industrial Training'),
('Kampar|UCCA3053','Kampar','UCCA3053','Knowledge Management'),
('Kampar|UCCA3123','Kampar','UCCA3123','DATA STORYTELLING AND NARRATIVE DESIGN'),
('Kampar|UCCA3224','Kampar','UCCA3224','WEB APPLICATIONS AND TECHNOLOGIES'),
('Kampar|UCCA3234','Kampar','UCCA3234','DATABASE ADMINISTRATION'),
('Kampar|UCCA3583','Kampar','UCCA3583','Project I'),
('Kampar|UCCA3596','Kampar','UCCA3596','Project II'),
('Kampar|UCCB1013','Kampar','UCCB1013','FUNDAMENTALS OF BUSINESS SYSTEMS'),
('Kampar|UCCB1104','Kampar','UCCB1104','INTRODUCTION TO BUSINESS PROGRAMMING'),
('Kampar|UCCB1223','Kampar','UCCB1223','RAPID APPLICATION DEVELOPMENT'),
('Kampar|UCCB2333','Kampar','UCCB2333','SOCIAL MEDIA STRATEGIES FOR BUSINESS'),
('Kampar|UCCB2513','Kampar','UCCB2513','MINI PROJECT'),
('Kampar|UCCB2596','Kampar','UCCB2596','Industrial Training'),
('Kampar|UCCB3104','Kampar','UCCB3104','BUSINESS INTELLIGENCE INFORMATION SYSTEMS'),
('Kampar|UCCB3113','Kampar','UCCB3113','Information Technology Control and Audit'),
('Kampar|UCCB3133','Kampar','UCCB3133','BUSINESS ANALYTICS'),
('Kampar|UCCB3144','Kampar','UCCB3144','Advanced Digital Media Technology'),
('Kampar|UCCB3224','Kampar','UCCB3224','DATA MINING TECHNIQUES'),
('Kampar|UCCB3353','Kampar','UCCB3353','ARTIFICIAL INTELLIGENCE FOR BUSINESS'),
('Kampar|UCCB3583','Kampar','UCCB3583','Project I'),
('Kampar|UCCB3596','Kampar','UCCB3596','Project II'),
('Kampar|UCCC2014','Kampar','UCCC2014',''),
('Kampar|UCCC2063','Kampar','UCCC2063','ALGORITHMS ANALYSIS'),
('Kampar|UCCC2513','Kampar','UCCC2513','MINI PROJECT'),
('Kampar|UCCC2596','Kampar','UCCC2596','Industrial Training'),
('Kampar|UCCC3053','Kampar','UCCC3053','Image Processing and Pattern Recognition'),
('Kampar|UCCC3073','Kampar','UCCC3073','DATA SCIENCE'),
('Kampar|UCCC3583','Kampar','UCCC3583','Project I'),
('Kampar|UCCC3596','Kampar','UCCC3596','Project II'),
('Kampar|UCCD1004','Kampar','UCCD1004','PROGRAMMING CONCEPTS AND PRACTICES'),
('Kampar|UCCD1024','Kampar','UCCD1024','DATA STRUCTURE AND ALGORITHMIC PROBLEM SOLVING'),
('Kampar|UCCD1033','Kampar','UCCD1033','FUNDAMENTALS OF DATA MINING AND MACHINE LEARNING'),
('Kampar|UCCD1133','Kampar','UCCD1133','INTRODUCTION TO COMPUTER ORGANISATION AND ARCHITECTURE'),
('Kampar|UCCD1143','Kampar','UCCD1143','PROBABILITY AND STATISTICS FOR COMPUTING'),
('Kampar|UCCD1203','Kampar','UCCD1203','DATABASE DEVELOPMENT AND APPLICATIONS'),
('Kampar|UCCD1213','Kampar','UCCD1213','FUNDAMENTALS OF DIGITAL MEDIA TECHNOLOGY'),
('Kampar|UCCD2003','Kampar','UCCD2003','OBJECT-ORIENTED SYSTEMS ANALYSIS AND DESIGN'),
('Kampar|UCCD2043','Kampar','UCCD2043','INFORMATION TECHNOLOGY PROJECT MANAGEMENT'),
('Kampar|UCCD2044','Kampar','UCCD2044','OBJECT-ORIENTED PROGRAMMING PRACTICES'),
('Kampar|UCCD2063','Kampar','UCCD2063','ARTIFICIAL INTELLIGENCE TECHNIQUES'),
('Kampar|UCCD2073','Kampar','UCCD2073','Requirements Engineering'),
('Kampar|UCCD2083','Kampar','UCCD2083','Cloud Computing and Services'),
('Kampar|UCCD2103','Kampar','UCCD2103','OPERATING SYSTEMS'),
('Kampar|UCCD2123','Kampar','UCCD2123','USER EXPERIENCE DESIGN'),
('Kampar|UCCD2213','Kampar','UCCD2213','SOFTWARE ENGINEERING PRINCIPLES'),
('Kampar|UCCD2223','Kampar','UCCD2223',''),
('Kampar|UCCD2233','Kampar','UCCD2233','Information Technology in Customer Relationship Management'),
('Kampar|UCCD2303','Kampar','UCCD2303','DATABASE TECHNOLOGY'),
('Kampar|UCCD2323','Kampar','UCCD2323','FRONT-END WEB DEVELOPMENT'),
('Kampar|UCCD2502','Kampar','UCCD2502','INTRODUCTION TO INVENTIVE PROBLEM SOLVING AND PROPOSAL WRITING'),
('Kampar|UCCD3013','Kampar','UCCD3013','ECOMMERCE PRACTICES'),
('Kampar|UCCD3023','Kampar','UCCD3023','DIGITAL ENTREPRENEURSHIP'),
('Kampar|UCCD3053','Kampar','UCCD3053','INFORMATION TECHNOLOGY PROFESSIONAL ETHICS'),
('Kampar|UCCD3063','Kampar','UCCD3063','Innovation and Creative Management'),
('Kampar|UCCD3064','Kampar','UCCD3064','SOFTWARE TESTING'),
('Kampar|UCCD3073','Kampar','UCCD3073','Parallel Programming'),
('Kampar|UCCD3074','Kampar','UCCD3074','Deep Learning for Data Science'),
('Kampar|UCCD3084','Kampar','UCCD3084','GRAPHICS PROGRAMMING FOR EXTENDED REALITY'),
('Kampar|UCCD3094','Kampar','UCCD3094','PRINCIPLES OF DEEP LEARNING'),
('Kampar|UCCD3113','Kampar','UCCD3113','DISTRIBUTED COMPUTER SYSTEMS'),
('Kampar|UCCD3133','Kampar','UCCD3133','INTRODUCTION TO LARGE LANGUAGE MODELS AND AGENTIC AI'),
('Kampar|UCCD3223','Kampar','UCCD3223','MOBILE APPLICATIONS DEVELOPMENT'),
('Kampar|UCCD3243','Kampar','UCCD3243','SERVER-SIDE WEB APPLICATIONS DEVELOPMENT'),
('Kampar|UCCD3253','Kampar','UCCD3253','ENTERPRISE SYSTEMS'),
('Kampar|UCCD3343','Kampar','UCCD3343','Big Data Analytics'),
('Kampar|UCCE1023','Kampar','UCCE1023','DIGITAL FUNDAMENTALS'),
('Kampar|UCCE1024','Kampar','UCCE1024','CIRCUIT THEORY AND BASIC ELECTRONICS'),
('Kampar|UCCE1053','Kampar','UCCE1053',''),
('Kampar|UCCE1064','Kampar','UCCE1064','Processor and Interfacing'),
('Kampar|UCCE1083','Kampar','UCCE1083','ELECTRONIC DEVICES AND APPLICATIONS'),
('Kampar|UCCE2023','Kampar','UCCE2023','Digital Systems Design'),
('Kampar|UCCE2053','Kampar','UCCE2053','COMPUTER ORGANISATION AND ARCHITECTURE'),
('Kampar|UCCE2073','Kampar','UCCE2073','Introduction to Digital Signal Processing'),
('Kampar|UCCE2093','Kampar','UCCE2093','Computational Intelligence'),
('Kampar|UCCE2506','Kampar','UCCE2506','Industrial Training'),
('Kampar|UCCE2513','Kampar','UCCE2513','Mini Project'),
('Kampar|UCCE3033','Kampar','UCCE3033','EMBEDDED SYSTEMS DESIGN'),
('Kampar|UCCE3073','Kampar','UCCE3073','COMPUTER VISION AND IMAGE PROCESSING'),
('Kampar|UCCE3083','Kampar','UCCE3083','Embedded Architecture and Computing'),
('Kampar|UCCE3123','Kampar','UCCE3123','ADVANCED COMPUTER ARCHITECTURE'),
('Kampar|UCCE3503','Kampar','UCCE3503','Project I'),
('Kampar|UCCE3506','Kampar','UCCE3506','Project II'),
('Kampar|UCCG1003','Kampar','UCCG1003','INTRODUCTION TO INTERNET OF THINGS AND ITS APPLICATIONS'),
('Kampar|UCCG1023','Kampar','UCCG1023','FUNDAMENTALS OF BUSINESS SYSTEMS'),
('Kampar|UCCG1104','Kampar','UCCG1104','INTRODUCTION TO BUSINESS PROGRAMMING'),
('Kampar|UCCG1213','Kampar','UCCG1213','FUNDAMENTALS OF DIGITAL MEDIA TECHNOLOGY'),
('Kampar|UCCG2103','Kampar','UCCG2103','FINANCIAL TECHNOLOGY'),
('Kampar|UCCG2113','Kampar','UCCG2113','BUSINESS INFORMATION MANAGEMENT'),
('Kampar|UCCG2123','Kampar','UCCG2123','MANAGEMENT INFORMATION SYSTEMS'),
('Kampar|UCCG2333','Kampar','UCCG2333','SOCIAL MEDIA STRATEGIES FOR BUSINESS'),
('Kampar|UCCG3023','Kampar','UCCG3023','DIGITAL ENTREPRENEURSHIP'),
('Kampar|UCCG3133','Kampar','UCCG3133','BUSINESS ANALYTICS'),
('Kampar|UCCM1153','Kampar','UCCM1153','INTRODUCTION TO CALCULUS AND APPLICATIONS'),
('Kampar|UCCM1353','Kampar','UCCM1353','BASIC ALGEBRA'),
('Kampar|UCCM1363','Kampar','UCCM1363','DISCRETE MATHEMATICS'),
('Kampar|UCCM2153','Kampar','UCCM2153','Numerical Methods'),
('Kampar|UCCM2203','Kampar','UCCM2203','Advanced Calculus and Applications'),
('Kampar|UCCM2233','Kampar','UCCM2233','STATISTICS'),
('Kampar|UCCM2433','Kampar','UCCM2433','FUNDAMENTALS OF STATISTICS'),
('Kampar|UCCN1004','Kampar','UCCN1004','DATA COMMUNICATIONS AND NETWORKING'),
('Kampar|UCCN1223','Kampar','UCCN1223','CYBERSECURITY'),
('Kampar|UCCN2013','Kampar','UCCN2013','Network Switching and Routing'),
('Kampar|UCCN2023','Kampar','UCCN2023','FUNDAMENTALS OF WIRELESS COMMUNICATIONS'),
('Kampar|UCCN2053','Kampar','UCCN2053','Optical Switching and Networking'),
('Kampar|UCCN2213','Kampar','UCCN2213','Teletraffic Engineering'),
('Kampar|UCCN2233','Kampar','UCCN2233','COMPUTER SYSTEM AND NETWORK SECURITY'),
('Kampar|UCCN2243','Kampar','UCCN2243','INTERNETWORKING PRINCIPLES AND PRACTICES'),
('Kampar|UCCN2506','Kampar','UCCN2506','Industrial Training'),
('Kampar|UCCN2513','Kampar','UCCN2513','MINI PROJECT'),
('Kampar|UCCN3004','Kampar','UCCN3004','Server Management and Administration'),
('Kampar|UCCN3014','Kampar','UCCN3014','Multimedia Networking and Real-Time Transmission'),
('Kampar|UCCN3024','Kampar','UCCN3024','WIRELESS AND MOBILE NETWORKING'),
('Kampar|UCCN3034','Kampar','UCCN3034','NETWORK PROGRAMMING'),
('Kampar|UCCN3044','Kampar','UCCN3044','Network and Switch Simulation'),
('Kampar|UCCN3054','Kampar','UCCN3054','Wireless Security'),
('Kampar|UCCN3064','Kampar','UCCN3064','Embedded Network Devices'),
('Kampar|UCCN3084','Kampar','UCCN3084','ETHICAL HACKING AND DIGITAL FORENSICS'),
('Kampar|UCCN3583','Kampar','UCCN3583','Project I'),
('Kampar|UCCN3596','Kampar','UCCN3596','Project II'),
('Kampar|UCCR1003','Kampar','UCCR1003','EMERGING INDUSTRIAL TECHNOLOGY'),
('Kampar|UCCR1004','Kampar','UCCR1004','COMPUTATIONAL MATHEMATICS'),
('Kampar|UCCR2003','Kampar','UCCR2003','Fundamentals of Digitization'),
('Kampar|UCCR2013','Kampar','UCCR2013','INFORMATION TECHNOLOGY FOR INDUSTRIAL OPERATIONS'),
('Kampar|UCCR2014','Kampar','UCCR2014','APPLICATIONS OF VIRTUAL AND AUGMENTED REALITY'),
('Kampar|UCCR2023','Kampar','UCCR2023','DATA-DRIVEN DECISION MAKING'),
('Kampar|UCCR2033','Kampar','UCCR2033','INTELLIGENT SYSTEMS IN ROBOTICS'),
('Kampar|UCCR2506','Kampar','UCCR2506','Industrial Training'),
('Kampar|UCCR2513','Kampar','UCCR2513','MINI PROJECT'),
('Kampar|UCCR3003','Kampar','UCCR3003','INDUSTRIAL INFORMATION TECHNOLOGY PROJECT MANAGEMENT'),
('Kampar|UCCR3024','Kampar','UCCR3024','Software-Defined Networking for Internet of Things'),
('Kampar|UCCR3044','Kampar','UCCR3044','Internet of Things***'),
('Kampar|UCCR3054','Kampar','UCCR3054','Machine Vision I***'),
('Kampar|UCCR3064','Kampar','UCCR3064','Machine Vision II***'),
('Kampar|UCCR3074','Kampar','UCCR3074','Artificial Intelligence and Data Analytics***'),
('Kampar|UCCR3084','Kampar','UCCR3084','Intelligent Systems'),
('Kampar|UCCR3114','Kampar','UCCR3114','REAL-TIME DATA ANALYTICS'),
('Kampar|UCCR3124','Kampar','UCCR3124','DISTRIBUTED DATABASE'),
('Kampar|UCCR3134','Kampar','UCCR3134','AUTOMATION AND AI DEVELOPMENT'),
('Kampar|UCCR3174','Kampar','UCCR3174','PRINCIPLES OF CLOUD INFRASTRUCTURE AND DEVOPS'),
('Kampar|UCCR3503','Kampar','UCCR3503','Project I'),
('Kampar|UCCR3506','Kampar','UCCR3506','Project II'),
('Kampar|UCCT1013','Kampar','UCCT1013','INTRODUCTION TO INFORMATION SYSTEMS DESIGN'),
('Kampar|UCCT1103','Kampar','UCCT1103','DIGITAL COMMERCE'),
('Kampar|UCCT1104','Kampar','UCCT1104','APPLICATION PROGRAMMING'),
('Kampar|UCCT1113','Kampar','UCCT1113','INFORMATION TECHNOLOGY INFRASTRUCTURE FOR BUSINESS'),
('Kampar|UCCT2103','Kampar','UCCT2103','FINANCIAL TECHNOLOGY'),
('Kampar|UCCT2113','Kampar','UCCT2113','Financial Intelligence and Investment Analysis'),
('Kampar|UCCT2153','Kampar','UCCT2153','DIGITAL SUPPLY CHAIN MANAGEMENT'),
('Kampar|UCCT2163','Kampar','UCCT2163','Payment Technology'),
('Kampar|UCCT2173','Kampar','UCCT2173','COMPUTATIONAL THINKING FOR DESIGN IN DIGITAL ECONOMY'),
('Kampar|UCCT2183','Kampar','UCCT2183','DIGITAL TECHNOLOGY FOR BUSINESS MODELS'),
('Kampar|UCCT2513','Kampar','UCCT2513','MINI PROJECT'),
('Kampar|UCCT2596','Kampar','UCCT2596','Industrial Training'),
('Kampar|UCCT3114','Kampar','UCCT3114','Web Technology for Information Systems and Analysis'),
('Kampar|UCCT3124','Kampar','UCCT3124','Digital Marketing'),
('Kampar|UCCT3144','Kampar','UCCT3144','Blockchain and Business Models'),
('Kampar|UCCT3583','Kampar','UCCT3583','Project I'),
('Kampar|UCCT3596','Kampar','UCCT3596','Project II'),
('Kampar|UCEE3133','Kampar','UCEE3133','Electronic Testing Principles'),
('Kampar|UDPG1043','Kampar','UDPG1043','OPERATIONS RESEARCH FOR COMPUTING'),
('Kampar|UDPL1103','Kampar','UDPL1103','FUNDAMENTAL OF SUPPLY CHAIN MANAGEMENT'),
('Kampar|UDPL1133','Kampar','UDPL1133','PRINCIPLES OF INFORMATION LOGISTICS'),
('Kampar|UDPL2313','Kampar','UDPL2313','AIRPORT MANAGEMENT'),
('Kampar|UDPL2333','Kampar','UDPL2333','TRANSPORT PLANNING AND DEMAND ANALYSIS'),
('Kampar|UDPL2423','Kampar','UDPL2423','MARITIME ECONOMICS & POLICY'),
('Kampar|UDPL3303','Kampar','UDPL3303','INTERNATIONAL TRANSPORT MANAGEMENT'),
('Kampar|UDPL3323','Kampar','UDPL3323','INTERNATIONAL MARITIME OPERATIONS'),
('Kampar|UDPS1023','Kampar','UDPS1023','INTRODUCTION TO PROBABILITY AND STATISTICS'),
('Kampar|UDPS1043','Kampar','UDPS1043','Introduction to Operations Research'),
('Kampar|UDPS1133','Kampar','UDPS1133','STATISTICAL METHODS'),
('Kampar|UDPS2223','Kampar','UDPS2223','APPLIED REGRESSION ANALYSIS'),
('Kampar|UGIB3113','Kampar','UGIB3113','OCCUPATIONAL SAFETY AND MANAGEMENT'),
('Kampar|UGNB1023','Kampar','UGNB1023','INTRODUCTION TO OCCUPATIONAL SAFETY AND HEALTH'),
('Kampar|UGNB4024','Kampar','UGNB4024','EMERGENCY CONTROL AND RESPONSE MANAGEMENT'),
('Sungai Long|UJGP1003','Sungai Long','UJGP1003','Fundamentals of Psychology'),
('Sungai Long|UJGS1033','Sungai Long','UJGS1033','UNDERSTANDING POLITICS: STATE, NATION AND GOVERNMENT'),
('Sungai Long|UJGS2003','Sungai Long','UJGS2003','Intercultural Communication'),
('Sungai Long|UJGS2033','Sungai Long','UJGS2033','Cross-Cultural Interactive Communication'),
('Sungai Long|UJGS2043','Sungai Long','UJGS2043','Sociology In Malaysian Context'),
('Sungai Long|UJLL1023','Sungai Long','UJLL1023','English Pronunciation and Speaking'),
('Sungai Long|UJLL1033','Sungai Long','UJLL1033','Creative Writing Skills'),
('Sungai Long|UJLL1043','Sungai Long','UJLL1043','English Vocabulary'),
('Sungai Long|UJLL1053','Sungai Long','UJLL1053','English Grammar in Context'),
('Sungai Long|UJMA1003','Sungai Long','UJMA1003','INTRODUCTION TO ADVERTISING'),
('Sungai Long|UJMA1013','Sungai Long','UJMA1013','ADVERTISING COPYWRITING'),
('Sungai Long|UJMA1073','Sungai Long','UJMA1073','ADVERTISING DESIGN'),
('Sungai Long|UJMA2013','Sungai Long','UJMA2013','CREATIVE STRATEGY FOR ADVERTISING'),
('Sungai Long|UJMA2023','Sungai Long','UJMA2023','MEDIA PLANNING'),
('Sungai Long|UJMB1003','Sungai Long','UJMB1003','INTRODUCTION TO BROADCASTING'),
('Sungai Long|UJMB1054','Sungai Long','UJMB1054','FUNDAMENTALS OF IMAGERY & COMPOSITION'),
('Sungai Long|UJMB1063','Sungai Long','UJMB1063','MULTIMEDIA DESIGN AND APPLICATIONS'),
('Sungai Long|UJMB1083','Sungai Long','UJMB1083','RADIO BROADCASTING'),
('Sungai Long|UJMB1114','Sungai Long','UJMB1114','DIGITAL MEDIA AND SOCIETY'),
('Sungai Long|UJMB2024','Sungai Long','UJMB2024','SCREENPLAY AND SCRIPTWRITING'),
('Sungai Long|UJMB2044','Sungai Long','UJMB2044','TELEVISION PRODUCTION I'),
('Sungai Long|UJMB2074','Sungai Long','UJMB2074','TRANSMEDIA STUDIES'),
('Sungai Long|UJMB2083','Sungai Long','UJMB2083','FILM STUDIES'),
('Sungai Long|UJMB2104','Sungai Long','UJMB2104','DIGITAL AUDIO PRODUCTION'),
('Sungai Long|UJMB2114','Sungai Long','UJMB2114','MALAYSIAN MEDIA AND CULTURE'),
('Sungai Long|UJMB2124','Sungai Long','UJMB2124','VIDEO EDITING'),
('Sungai Long|UJMB2133','Sungai Long','UJMB2133','BASIC VIDEO PRODUCTION'),
('Sungai Long|UJMB3006','Sungai Long','UJMB3006','TELEVISION PRODUCTION II'),
('Sungai Long|UJMC1003','Sungai Long','UJMC1003','FUNDAMENTALS OF PUBLIC RELATIONS'),
('Sungai Long|UJMC1133','Sungai Long','UJMC1133','INTEGRATED MARKETING COMMUNICATIONS'),
('Sungai Long|UJMC2003','Sungai Long','UJMC2003','AUDIENCE AND RECEPTION STUDIES'),
('Sungai Long|UJMC2043','Sungai Long','UJMC2043','Public Speaking'),
('Sungai Long|UJMC3084','Sungai Long','UJMC3084','ONLINE VISUAL STRATEGY'),
('Sungai Long|UJMD1083','Sungai Long','UJMD1083','Digital Photography'),
('Sungai Long|UJMD2016','Sungai Long','UJMD2016','Creative Visual Design I'),
('Sungai Long|UJMD2026','Sungai Long','UJMD2026','Creative Visu al Design II'),
('Sungai Long|UJMD2036','Sungai Long','UJMD2036','Creative Visual Design III'),
('Sungai Long|UJMD2046','Sungai Long','UJMD2046','Web Design and Development I'),
('Sungai Long|UJMD2056','Sungai Long','UJMD2056','Web Design and Development I'),
('Sungai Long|UJMD2066','Sungai Long','UJMD2066','Web Design and Development I'),
('Sungai Long|UJMD2203','Sungai Long','UJMD2203','INTERACTIVE MULTIMEDIA I'),
('Sungai Long|UJMD2213','Sungai Long','UJMD2213','INTERACTIVE MULTIMEDIA II'),
('Sungai Long|UJMG1073','Sungai Long','UJMG1073','MARKETING AND MEDIA'),
('Sungai Long|UJMG1153','Sungai Long','UJMG1153','COMMUNICATION IN INTERPERSONAL RELATIONSHIPS'),
('Sungai Long|UJMG2064','Sungai Long','UJMG2064','APPROACHES TO COMMUNICATION RESEARCH'),
('Sungai Long|UJMG2083','Sungai Long','UJMG2083','Creative Writing'),
('Sungai Long|UJMG2114','Sungai Long','UJMG2114','MEDIA AND COMMUNICATION THEORIES'),
('Sungai Long|UJMG2154','Sungai Long','UJMG2154','NEW MEDIA AND COMMUNICATION'),
('Sungai Long|UJMG2883','Sungai Long','UJMG2883','Digital Enterprise'),
('Sungai Long|UJMG3086','Sungai Long','UJMG3086','MEDIA PROJECT I'),
('Sungai Long|UJMG3143','Sungai Long','UJMG3143','ETHICS IN MEDIA COMMUNICATION'),
('Sungai Long|UJMJ1003','Sungai Long','UJMJ1003','INTRODUCTION TO JOURNALISM'),
('Sungai Long|UJMJ3023','Sungai Long','UJMJ3023','POLITICS AND MEDIA'),
('Sungai Long|UJMJ3054','Sungai Long','UJMJ3054','BROADCAST JOURNALISM'),
('Sungai Long|UJMM1013','Sungai Long','UJMM1013','DESIGN STUDIO'),
('Sungai Long|UJMM1034','Sungai Long','UJMM1034','GAME DESIGN FOUNDATION'),
('Sungai Long|UJMM1044','Sungai Long','UJMM1044','ADVANCED ART'),
('Sungai Long|UJMM1063','Sungai Long','UJMM1063','NARRATIVE DESIGN AND STORY CREATION'),
('Sungai Long|UJMM2033','Sungai Long','UJMM2033','WORLD-BUILDING FOR GAMES'),
('Sungai Long|UJMM2034','Sungai Long','UJMM2034','LEVEL DESIGN'),
('Sungai Long|UJMM2064','Sungai Long','UJMM2064','GAME DEVELOPMENT I'),
('Sungai Long|UJMM2074','Sungai Long','UJMM2074','DIGITAL VIDEO PRODUCTION'),
('Sungai Long|UJMM2083','Sungai Long','UJMM2083','MUSIC AND SOUND EFFECTS FOR GAMES'),
('Sungai Long|UJMM2093','Sungai Long','UJMM2093','GAME DEVELOPMENT II'),
('Sungai Long|UJMM2123','Sungai Long','UJMM2123','PROGRAMMING FOR GAMES'),
('Sungai Long|UJMZ3056','Sungai Long','UJMZ3056','FINAL YEAR PROJECT I'),
('Sungai Long|UJMZ30610','Sungai Long','UJMZ30610','FINAL PROJECT I'),
('Sungai Long|UJSJ2133','Sungai Long','UJSJ2133','INTERACTIVE REPORTING'),
('Sungai Long|UKAI2333','Sungai Long','UKAI2333','SOCIAL MEDIA STRATEGIES FOR BUSINESS'),
('Sungai Long|UKFF2143','Sungai Long','UKFF2143','Personal Financial Planning And Investment'),
('Sungai Long|UKTC1013','Sungai Long','UKTC1013','CROSS CULTURAL MANAGEMENT'),
('Kampar|ULLC1003','Kampar','ULLC1003','INTRODUCTION TO CHINESE LANGUAGE I'),
('Sungai Long|ULSC1014','Sungai Long','ULSC1014','CHINESE HISTORY (CHINA TO 1840)'),
('Sungai Long|ULSC1024','Sungai Long','ULSC1024','HISTORY OF CHINESE LITERATURE'),
('Sungai Long|ULSC1033','Sungai Long','ULSC1033','INTRODUCTION TO CHINESE STUDIES'),
('Sungai Long|ULSC1113','Sungai Long','ULSC1113','MALAYSIAN CHINESE LITERATURE'),
('Sungai Long|ULSC2033','Sungai Long','ULSC2033','THE FOUR CONFUCIAN CLASSICS'),
('Kampar|ULUE1003','Kampar','ULUE1003','CONFUCIANISM AND MODERN SOCIETY'),
('Kampar|ULSC1014','Kampar','ULSC1014','CHINESE HISTORY (CHINA TO 1840)'),
('Kampar|ULSC1024','Kampar','ULSC1024','HISTORY OF CHINESE LITERATURE'),
('Kampar|ULSC1033','Kampar','ULSC1033','INTRODUCTION TO CHINESE STUDIES'),
('Kampar|ULSC1113','Kampar','ULSC1113','MALAYSIAN CHINESE LITERATURE'),
('Kampar|ULSC2033','Kampar','ULSC2033','THE FOUR CONFUCIAN CLASSICS'),
('Kampar|MPU32073','Kampar','MPU32073','COMMUNICATIVE ENGLISH'),
('Kampar|MPU33063','Kampar','MPU33063','CULTURE AND COMMUNICATION'),
('Kampar|MPU33073','Kampar','MPU33073','INTRODUCTION TO SOCIOLOGY'),
('Kampar|UAMP1014','Kampar','UAMP1014','PUBLIC RELATIONS'),
('Kampar|UAMA1004','Kampar','UAMA1004','INTRODUCTION TO ADVERTISING')
on conflict(course_key) do update set name=excluded.name;
insert into public.campusmy_social_teachers(course_key,term,name) values
('Kampar|MPU3142','June 2026','Roshydan'),
('Kampar|MPU3143','June 2026','Roshydan'),
('Kampar|MPU3152','June 2026','Azmira'),
('Kampar|MPU3153','June 2026','Sarah'),
('Kampar|MPU3182','June 2026','Muniroh'),
('Kampar|MPU3183','June 2026','Muniroh'),
('Kampar|MPU3192','June 2026','Noorfadzlyah'),
('Kampar|MPU3193','June 2026','YUVASHINI'),
('Kampar|MPU32013','June 2026','Roshydan'),
('Kampar|MPU3202','June 2026','Ganga'),
('Kampar|MPU32143','June 2026','Shobana'),
('Kampar|MPU3402','June 2026','Ganga'),
('Kampar|MPU34072','June 2026','Mah S.H'),
('Kampar|MPU34082','June 2026','Alison Yoon'),
('Kampar|MPU34132','June 2026','Fong KH'),
('Kampar|MPU34142','June 2026','Kong HY'),
('Kampar|MPU34142','June 2026','Alison Yoon'),
('Kampar|MPU34152','June 2026','Erica CJ'),
('Kampar|MPU34182','June 2026','Cik Puteri'),
('Kampar|UALB1003','June 2026','Nurbadriah'),
('Kampar|UALJ2013','June 2026','CHOO PY'),
('Kampar|UALL1053','June 2026','Nurull'),
('Kampar|UALM1003','June 2026','Ganga'),
('Kampar|UAMG1043','June 2026','EngMC'),
('Kampar|UAMG1043','June 2026','Yvonne hoh'),
('Kampar|UBAF1043','June 2026','Maisarah'),
('Kampar|UBAF1043','June 2026','Pn.Zam'),
('Kampar|UBMH1013','June 2026','Rajaletchumy'),
('Kampar|UBMM1011','June 2026','Tee Chee Wee'),
('Kampar|UBMM1013','June 2026','Teohsy'),
('Kampar|UBMM2013','June 2026','Chia Mei Si'),
('Kampar|UBMM2023','June 2026','Julian Teh'),
('Kampar|UBMM2023','June 2026','Norhayati'),
('Kampar|UBTM1013','June 2026','Loh Xiu Ming'),
('Kampar|UCCA2103','June 2026','Zurida Ishak'),
('Kampar|UCCA2403','June 2026','Dr Sima'),
('Kampar|UCCA2513','June 2026','Pn Munaliza'),
('Kampar|UCCA2513','June 2026','WongPV'),
('Kampar|UCCA3123','June 2026','Dr Altahir'),
('Kampar|UCCA3224','June 2026','SunTH'),
('Kampar|UCCA3234','June 2026','Ramesh Kumar'),
('Kampar|UCCB1013','June 2026','TeyCheeChieh'),
('Kampar|UCCB1013','June 2026','Tan Min Khen'),
('Kampar|UCCB1013','June 2026','Saiful Azman'),
('Kampar|UCCB1104','June 2026','Ammar Azlan'),
('Kampar|UCCB1223','June 2026','WongPV'),
('Kampar|UCCB1223','June 2026','Loh LeouChih'),
('Kampar|UCCB2333','June 2026','Deveendra'),
('Kampar|UCCB2513','June 2026','Pn Munaliza'),
('Kampar|UCCB2513','June 2026','WongPV'),
('Kampar|UCCB2513','June 2026','NurulSyafida'),
('Kampar|UCCB3104','June 2026','Jin, Tong'),
('Kampar|UCCB3133','June 2026','NurulSyafida'),
('Kampar|UCCB3133','June 2026','Nur Aisyah'),
('Kampar|UCCB3224','June 2026','Abdulkarim'),
('Kampar|UCCB3353','June 2026','Kiran Adnan'),
('Kampar|UCCC2063','June 2026','Ng WanQing'),
('Kampar|UCCC2063','June 2026','Luke Lee CC'),
('Kampar|UCCC2513','June 2026','Leung KH'),
('Kampar|UCCC2513','June 2026','Lim EH'),
('Kampar|UCCC2513','June 2026','LeongYingMei'),
('Kampar|UCCC2513','June 2026','Mogana'),
('Kampar|UCCC2513','June 2026','Cik Puteri'),
('Kampar|UCCC3073','June 2026','TongDongLing'),
('Kampar|UCCD1004','June 2026','Jasmina Khaw'),
('Kampar|UCCD1004','June 2026','Phan KY'),
('Kampar|UCCD1004','June 2026','Tan Joi San'),
('Kampar|UCCD1024','June 2026','GohChuanMeng'),
('Kampar|UCCD1024','June 2026','Wong CS'),
('Kampar|UCCD1024','June 2026','SorKV'),
('Kampar|UCCD1024','June 2026','Lai YuLiang'),
('Kampar|UCCD1024','June 2026','FatinNatasya'),
('Kampar|UCCD1033','June 2026','Ashikin Ali'),
('Kampar|UCCD1133','June 2026','Oh Zi Xin'),
('Kampar|UCCD1133','June 2026','Vikneswary'),
('Kampar|UCCD1133','June 2026','Lee Wai Kong'),
('Kampar|UCCD1133','June 2026','Chang JJ'),
('Kampar|UCCD1133','June 2026','Lee HY'),
('Kampar|UCCD1143','June 2026','Kh''ngXinYi'),
('Kampar|UCCD1143','June 2026','Lim SengPoh'),
('Kampar|UCCD1203','June 2026','CheangKahWai'),
('Kampar|UCCD1203','June 2026','Norazira'),
('Kampar|UCCD1203','June 2026','Sharanjit'),
('Kampar|UCCD1203','June 2026','YongTF'),
('Kampar|UCCD1203','June 2026','Nur Syahirah'),
('Kampar|UCCD1203','June 2026','Ts Saravanan'),
('Kampar|UCCD1213','June 2026','Ana Nabilah'),
('Kampar|UCCD1213','June 2026','Nur Lyana'),
('Kampar|UCCD2003','June 2026','Ku CS'),
('Kampar|UCCD2043','June 2026','YongTF'),
('Kampar|UCCD2044','June 2026','Sayed Ahmad'),
('Kampar|UCCD2044','June 2026','Pn Syazwani'),
('Kampar|UCCD2044','June 2026','ChaiMeeiTyng'),
('Kampar|UCCD2063','June 2026','Tseu KwanLee'),
('Kampar|UCCD2063','June 2026','LeongCF'),
('Kampar|UCCD2063','June 2026','Daniel Looi'),
('Kampar|UCCD2063','June 2026','Lye Kah Hooi'),
('Kampar|UCCD2213','June 2026','Jenifer Ann'),
('Kampar|UCCD2213','June 2026','Ku CS'),
('Kampar|UCCD2303','June 2026','ChanLK'),
('Kampar|UCCD2303','June 2026','Nur Syahirah'),
('Kampar|UCCD2323','June 2026','Nor Fatiha'),
('Kampar|UCCD2323','June 2026','Ayu Norafida'),
('Kampar|UCCD2323','June 2026','Mohd.Dalvi'),
('Kampar|UCCD2323','June 2026','Ramesh Kumar'),
('Kampar|UCCD2323','June 2026','SunTH'),
('Kampar|UCCD2323','June 2026','Norazira'),
('Kampar|UCCD2323','June 2026','Dr Sima'),
('Kampar|UCCD2323','June 2026','Abdulkarim'),
('Kampar|UCCD2323','June 2026','Nur Athirah'),
('Kampar|UCCD2502','June 2026','LiewSY'),
('Kampar|UCCD2502','June 2026','LaiSC'),
('Kampar|UCCD2502','June 2026','TOU JY'),
('Kampar|UCCD2502','June 2026','Sayed Ahmad'),
('Kampar|UCCD3013','June 2026','Tan Min Khen'),
('Kampar|UCCD3023','June 2026','Saiful Azman'),
('Kampar|UCCD3023','June 2026','Pn Munaliza'),
('Kampar|UCCD3023','June 2026','Soong HC'),
('Kampar|UCCD3053','June 2026','Sharanjit'),
('Kampar|UCCD3053','June 2026','Zurida Ishak'),
('Kampar|UCCD3064','June 2026','TanTB'),
('Kampar|UCCD3084','June 2026','Saw Seow Hui'),
('Kampar|UCCD3084','June 2026','FatinNatasya'),
('Kampar|UCCD3094','June 2026','Tan HK'),
('Kampar|UCCD3113','June 2026','Mohd Hafizul'),
('Kampar|UCCD3133','June 2026','Png Wen Hao'),
('Kampar|UCCD3133','June 2026','Lai YuLiang'),
('Kampar|UCCD3133','June 2026','Ashikin Ali'),
('Kampar|UCCD3223','June 2026','Tan CK'),
('Kampar|UCCD3243','June 2026','Nur Athirah'),
('Kampar|UCCD3243','June 2026','Suthashini'),
('Kampar|UCCD3243','June 2026','Dr Altahir'),
('Kampar|UCCD3253','June 2026','CheahHewMee'),
('Kampar|UCCE1023','June 2026','Dr Syaiful'),
('Kampar|UCCE1024','June 2026','OoiCY'),
('Kampar|UCCE2053','June 2026','MokKM'),
('Kampar|UCCE3033','June 2026','Lee Wai Kong'),
('Kampar|UCCE3073','June 2026','Dr Fityanul'),
('Kampar|UCCE3123','June 2026','MokKM'),
('Kampar|UCCM1153','June 2026','Chan KM'),
('Kampar|UCCM1153','June 2026','Sim Khang Yi'),
('Kampar|UCCM1153','June 2026','Loshini'),
('Kampar|UCCM1153','June 2026','Song PC'),
('Kampar|UCCM1353','June 2026','Lim SJ'),
('Kampar|UCCM1363','June 2026','Nur Amalina'),
('Kampar|UCCM2433','June 2026','Nur Lyana'),
('Kampar|UCCN1004','June 2026','Aun Yichiet'),
('Kampar|UCCN1004','June 2026','Dr Ghali'),
('Kampar|UCCN1004','June 2026','Dr Syaiful'),
('Kampar|UCCN1004','June 2026','OoiCY'),
('Kampar|UCCN1004','June 2026','Rohani Bakar'),
('Kampar|UCCN1004','June 2026','Tan Lyk Yin'),
('Kampar|UCCN1004','June 2026','Dr Waqas'),
('Kampar|UCCN1004','June 2026','Nor ''Afifah'),
('Kampar|UCCN1223','June 2026','Dr Ghali'),
('Kampar|UCCN2023','June 2026','Farina Saffa'),
('Kampar|UCCN2233','June 2026','AthirahRosli'),
('Kampar|UCCN2243','June 2026','GanML'),
('Kampar|UCCN2243','June 2026','Farina Saffa'),
('Kampar|UCCN2513','June 2026','Goh HG'),
('Kampar|UCCN2513','June 2026','Dr Waqas'),
('Kampar|UCCN3024','June 2026','Adeb Ali'),
('Kampar|UCCN3034','June 2026','Tan Lyk Yin'),
('Kampar|UCCN3084','June 2026','Nor ''Afifah'),
('Kampar|UCCR1004','June 2026','Chang JJ'),
('Kampar|UCCR1004','June 2026','Rohani Bakar'),
('Kampar|UCCR2013','June 2026','Rahmad Sadli'),
('Kampar|UCCR2014','June 2026','Adeb Ali'),
('Kampar|UCCR2023','June 2026','Lee HY'),
('Kampar|UCCR2033','June 2026','Teoh SK'),
('Kampar|UCCR2513','June 2026','Dr Fityanul'),
('Kampar|UCCR3003','June 2026','Chang JJ'),
('Kampar|UCCR3114','June 2026','Rahmad Sadli'),
('Kampar|UCCR3124','June 2026','Rahmad Sadli'),
('Kampar|UCCR3134','June 2026','Rohani Bakar'),
('Kampar|UCCR3174','June 2026','Rohani Bakar'),
('Kampar|UCCT1013','June 2026','Lim JitTheam'),
('Kampar|UCCT1013','June 2026','Yew KT'),
('Kampar|UCCT1013','June 2026','Loh LeouChih'),
('Kampar|UCCT1103','June 2026','Tan Min Khen'),
('Kampar|UCCT1104','June 2026','Ammar Azlan'),
('Kampar|UCCT1104','June 2026','Loh LeouChih'),
('Kampar|UCCT1113','June 2026','Ooi JO'),
('Kampar|UCCT2153','June 2026','Nur Aisyah'),
('Kampar|UCCT2183','June 2026','Choo PY'),
('Kampar|UCCT2513','June 2026','WongPV'),
('Kampar|UCCT2513','June 2026','Pn Munaliza'),
('Kampar|UCCT2513','June 2026','NurulSyafida'),
('Kampar|UDPG1043','June 2026','Ng PS'),
('Kampar|MPU3142','October 2026','Roshydan'),
('Kampar|MPU3143','October 2026','Roshydan'),
('Kampar|MPU3152','October 2026','Sarah'),
('Kampar|MPU3153','October 2026','NUR ADILAH'),
('Kampar|MPU3182','October 2026','Noorfadzlyah'),
('Kampar|MPU3182','October 2026','Muniroh'),
('Kampar|MPU3183','October 2026','Muniroh'),
('Kampar|MPU3192','October 2026','YUVASHINI'),
('Kampar|MPU3193','October 2026','YUVASHINI'),
('Kampar|MPU32013','October 2026','Roshydan'),
('Kampar|MPU32142','October 2026','Alfian'),
('Kampar|MPU32142','October 2026','Iqbaal'),
('Kampar|MPU32142','October 2026','Ayu Rita'),
('Kampar|MPU32142','October 2026','Shobana'),
('Kampar|MPU32142','October 2026','Amir'),
('Kampar|MPU32142','October 2026','Gheeta'),
('Kampar|MPU32143','October 2026','Alfian'),
('Kampar|MPU32143','October 2026','Iqbaal'),
('Kampar|MPU32143','October 2026','Ayu Rita'),
('Kampar|MPU32143','October 2026','Shobana'),
('Kampar|MPU32143','October 2026','Amir'),
('Kampar|MPU32143','October 2026','Gheeta'),
('Kampar|MPU33012','October 2026','Thurai M.'),
('Kampar|MPU33012','October 2026','Yiew TH'),
('Kampar|MPU33012','October 2026','Vivien Wong'),
('Kampar|MPU33013','October 2026','Lee Chin Yu'),
('Kampar|MPU33013','October 2026','Kalai Vani'),
('Kampar|MPU33013','October 2026','Wong CY'),
('Kampar|MPU33013','October 2026','Eng YK'),
('Kampar|MPU33013','October 2026','Tang Siu Eng'),
('Kampar|MPU33013','October 2026','Keh CG'),
('Kampar|MPU34032','October 2026','Mah S.H'),
('Kampar|MPU34032','October 2026','Alison Yoon'),
('Kampar|MPU34072','October 2026','Mah S.H'),
('Kampar|MPU34102','October 2026','Fong KH'),
('Kampar|MPU34142','October 2026','Kong HY'),
('Kampar|MPU34162','October 2026','Kong HY'),
('Kampar|MPU34182','October 2026','Nur Lyana'),
('Kampar|UALB1003','October 2026','Thiagarajan'),
('Kampar|UALE1083','October 2026','Jeya Sarkuna'),
('Kampar|UALJ2013','October 2026','CHOO PY'),
('Kampar|UALL1053','October 2026','Lim KL'),
('Kampar|UALL1053','October 2026','Nurull'),
('Kampar|UALM1003','October 2026','Ganga'),
('Kampar|UAMG1043','October 2026','EngMC'),
('Kampar|UAMG1043','October 2026','Cheah PK'),
('Kampar|UBAF1043','October 2026','Nur Diyana'),
('Kampar|UBAF1043','October 2026','Lee Ah Suat'),
('Kampar|UBMH1013','October 2026','Rajaletchumy'),
('Kampar|UBMH1013','October 2026','Lim YH'),
('Kampar|UBMM1011','October 2026','Tee Chee Wee'),
('Kampar|UBMM1011','October 2026','Fong CY'),
('Kampar|UBMM1013','October 2026','Norharyani'),
('Kampar|UBMM1013','October 2026','Teohsy'),
('Kampar|UBMM2023','October 2026','Julian Teh'),
('Kampar|UBTM1013','October 2026','Loh Xiu Ming'),
('Kampar|UBTM1013','October 2026','Lee VH'),
('Kampar|UCCA2513','October 2026','Ramesh Kumar'),
('Kampar|UCCA2513','October 2026','Norazira'),
('Kampar|UCCA3123','October 2026','Dr Sima'),
('Kampar|UCCB1013','October 2026','TeyCheeChieh'),
('Kampar|UCCB1013','October 2026','Ooi JO'),
('Kampar|UCCB2333','October 2026','Soong HC'),
('Kampar|UCCB2513','October 2026','Ammar Azlan'),
('Kampar|UCCB2513','October 2026','WongPV'),
('Kampar|UCCB2513','October 2026','NurulSyafida'),
('Kampar|UCCB2513','October 2026','Loh LeouChih'),
('Kampar|UCCD1033','October 2026','Ashikin Ali'),
('Kampar|UCCD1143','October 2026','Lye Kah Hooi'),
('Kampar|UCCD1143','October 2026','Kh''ngXinYi'),
('Kampar|UCCD1213','October 2026','Ana Nabilah'),
('Kampar|UCCD1213','October 2026','Nur Lyana'),
('Kampar|UCCD2063','October 2026','LeongCF'),
('Kampar|UCCD2063','October 2026','Lai YuLiang'),
('Kampar|UCCD2103','October 2026','SorKV'),
('Kampar|UCCD2103','October 2026','ChaiMeeiTyng'),
('Kampar|UCCD2103','October 2026','Mogana'),
('Kampar|UCCD2103','October 2026','Ng WanQing'),
('Kampar|UCCD2103','October 2026','Phan KY'),
('Kampar|UCCD2103','October 2026','Wong CS'),
('Kampar|UCCD2123','October 2026','Dr Altahir'),
('Kampar|UCCD2123','October 2026','CheangKahWai'),
('Kampar|UCCD2123','October 2026','Nur Athirah'),
('Kampar|UCCD2123','October 2026','Norazira'),
('Kampar|UCCD2213','October 2026','LeongYingMei'),
('Kampar|UCCD2213','October 2026','Jenifer Ann'),
('Kampar|UCCD2213','October 2026','Pn Syazwani'),
('Kampar|UCCD2502','October 2026','LaiSC'),
('Kampar|UCCD2502','October 2026','TOU JY'),
('Kampar|UCCD2502','October 2026','GohChuanMeng'),
('Kampar|UCCD2502','October 2026','Jasmina Khaw'),
('Kampar|UCCD2502','October 2026','Ku CS'),
('Kampar|UCCD2502','October 2026','Leung KH'),
('Kampar|UCCD2502','October 2026','Sayed Ahmad'),
('Kampar|UCCD3013','October 2026','Tan Min Khen'),
('Kampar|UCCD3053','October 2026','Mohd.Dalvi'),
('Kampar|UCCD3053','October 2026','Sharanjit'),
('Kampar|UCCD3053','October 2026','Dr Sima'),
('Kampar|UCCD3053','October 2026','ChanLK'),
('Kampar|UCCD3053','October 2026','Zurida Ishak'),
('Kampar|UCCD3053','October 2026','Abdulkarim'),
('Kampar|UCCD3053','October 2026','YongTF'),
('Kampar|UCCD3053','October 2026','SunTH'),
('Kampar|UCCD3223','October 2026','FatinNatasya'),
('Kampar|UCCD3223','October 2026','Daniel Looi'),
('Kampar|UCCD3223','October 2026','Cik Puteri'),
('Kampar|UCCD3253','October 2026','Saiful Azman'),
('Kampar|UCCE1083','October 2026','Lee Wai Kong'),
('Kampar|UCCE1083','October 2026','Dr Syaiful'),
('Kampar|UCCN1223','October 2026','AthirahRosli'),
('Kampar|UCCN1223','October 2026','OoiCY'),
('Kampar|UCCN1223','October 2026','Dr Fityanul'),
('Kampar|UCCN1223','October 2026','Adeb Ali'),
('Kampar|UCCN1223','October 2026','Lee HY'),
('Kampar|UCCN1223','October 2026','Dr Ghali'),
('Kampar|UCCN1223','October 2026','GanML'),
('Kampar|UCCN1223','October 2026','Nor ''Afifah'),
('Kampar|UCCN1223','October 2026','Tan Lyk Yin'),
('Kampar|UCCR1003','October 2026','Rohani Bakar'),
('Kampar|UCCR1003','October 2026','Oh Zi Xin'),
('Kampar|UCCT2103','October 2026','Deveendra'),
('Kampar|UCCT2153','October 2026','Nur Aisyah'),
('Kampar|UCCT2173','October 2026','Pn Munaliza'),
('Kampar|UCCT2513','October 2026','WongPV'),
('Kampar|UCCT2513','October 2026','Ammar Azlan'),
('Kampar|UCCT2513','October 2026','Loh LeouChih'),
('Kampar|UCCT2513','October 2026','NurulSyafida'),
('Kampar|MPU3402','February 2026','Ms. Yuvashini a/p Salvamani (CFS)'),
('Kampar|ULSC1014','February 2026','Dr. Chou Wen Loong (FCS)'),
('Kampar|ULSC1024','February 2026','Dr. Er Lee Siong (FCS)'),
('Kampar|ULSC1033','February 2026','Dr. Thâ€™ng Bee Fu (FCS)'),
('Kampar|ULSC1113','February 2026','Dr. Bin Mei Fern (FCS)'),
('Kampar|ULSC2033','February 2026','Dr. Yap Siew Chin (FCS)'),
('Kampar|MPU32073','February 2026','Mr Jeya'),
('Kampar|MPU33063','February 2026','Cik Izzati'),
('Kampar|MPU33073','February 2026','Dr Teh'),
('Kampar|UAMP1014','February 2026','Cik Bazlin'),
('Kampar|UAMA1004','February 2026','Mr Chan')
on conflict do nothing;

-- If the 20261117 hardening migration has already replaced these functions with three-argument versions,
-- re-applying this file must not leave ambiguous overloads behind.
do $$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cm_messages' and p.pronargs=3) then
  drop function if exists public.cm_messages(uuid,timestamptz);
  grant execute on function public.cm_messages(uuid,timestamptz,bigint) to authenticated;
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cm_send_message' and p.pronargs=3) then
  drop function if exists public.cm_send_message(uuid,text);
  grant execute on function public.cm_send_message(uuid,text,uuid) to authenticated;
 end if;
end $$;
commit;
