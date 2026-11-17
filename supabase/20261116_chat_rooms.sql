-- CampusMY community rooms. Apply AFTER the existing account and social setup.
-- Additive migration: no existing rows, policies, functions or privileges are weakened.
begin;
-- Bootstrap files must not overwrite newer hardened function bodies.
do $$ begin
 if to_regclass('public.campusmy_rate_events') is not null then
  raise exception 'Security hardening is already installed. Do not reapply legacy setup files; use the versioned hardening migration.' using errcode='55000';
 end if;
end $$;

create table if not exists public.campusmy_rooms (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 university text not null default 'utar' check(university='utar'),
 scope text not null check(scope in ('local','campus')),
 campus text not null check(campus in ('Kampar','Sungai Long')),
 category text not null check(category in ('Study','Gaming','Anime','Fitness','Sports','Music','Campus life')),
 title text not null check(char_length(btrim(title)) between 3 and 80 and title ~ '[^[:space:]]'),
 description text not null default '' check(char_length(description)<=300),
 capacity integer not null default 30 check(capacity between 2 and 100),
 closed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.campusmy_room_members (
 room_id uuid not null references public.campusmy_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'active' check(status in ('active','left','banned')),
 joined_at timestamptz not null default now(), last_read_seq bigint not null default 0,
 muted boolean not null default false, primary key(room_id,user_id)
);
create table if not exists public.campusmy_room_messages (
 id uuid primary key default gen_random_uuid(), seq bigint generated always as identity unique,
 room_id uuid not null references public.campusmy_rooms(id) on delete cascade,
 sender uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 2000 and body ~ '[^[:space:]]'),
 hidden boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.campusmy_room_reports (
 message_id uuid not null references public.campusmy_room_messages(id) on delete cascade,
 reporter uuid not null references auth.users(id) on delete cascade,
 reason text not null check(char_length(btrim(reason)) between 10 and 500),
 created_at timestamptz not null default now(), primary key(message_id,reporter)
);
create index if not exists campusmy_rooms_discovery_idx on public.campusmy_rooms(scope,campus,updated_at desc);
create index if not exists campusmy_room_members_user_idx on public.campusmy_room_members(user_id,status);
create index if not exists campusmy_room_messages_page_idx on public.campusmy_room_messages(room_id,seq desc);
create index if not exists campusmy_room_messages_rate_idx on public.campusmy_room_messages(sender,created_at desc);
create index if not exists campusmy_rooms_owner_idx on public.campusmy_rooms(owner,created_at desc);
alter table public.campusmy_rooms enable row level security;
alter table public.campusmy_room_members enable row level security;
alter table public.campusmy_room_messages enable row level security;
alter table public.campusmy_room_reports enable row level security;
revoke all on public.campusmy_rooms,public.campusmy_room_members,public.campusmy_room_messages,public.campusmy_room_reports from public,anon,authenticated;
revoke all on sequence public.campusmy_room_messages_seq_seq from public,anon,authenticated;

-- Internal helpers are never callable by browser roles. Campus is currently self-declared,
-- not proof of university enrolment. Local areas are selected; no GPS is collected.
create or replace function public.cm_room_access(p_room uuid,p_member boolean default false)
returns public.campusmy_rooms language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 select * into r from public.campusmy_rooms where id=p_room;
 if r.id is null or public.cm_blocked(me,r.owner) or (r.scope='campus' and not exists(select 1 from public.campusmy_profiles where user_id=me and campus=r.campus)) then
  raise exception 'This room is unavailable for your account.' using errcode='42501'; end if;
 if exists(select 1 from public.campusmy_room_members where room_id=r.id and user_id=me and status='banned') then
  raise exception 'This room is unavailable for your account.' using errcode='42501'; end if;
 if p_member and not exists(select 1 from public.campusmy_room_members where room_id=r.id and user_id=me and status='active') then
  raise exception 'Join this room to read or send messages.' using errcode='42501'; end if;
 return r;
end $$;
create or replace function public.cm_room_json(r public.campusmy_rooms,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'scope',r.scope,'campus',r.campus,'category',r.category,'title',r.title,
 'description',r.description,'capacity',r.capacity,'closed',r.closed,'mine',r.owner=p_user,'updated_at',r.updated_at,
 'count',(select count(*) from public.campusmy_room_members where room_id=r.id and status='active'),
 'joined',exists(select 1 from public.campusmy_room_members where room_id=r.id and user_id=p_user and status='active'),
 'muted',coalesce((select muted from public.campusmy_room_members where room_id=r.id and user_id=p_user),false),
 'unread',(select count(*) from public.campusmy_room_messages m join public.campusmy_room_members u on u.room_id=m.room_id and u.user_id=p_user and u.status='active'
  where m.room_id=r.id and m.seq>u.last_read_seq and m.sender<>p_user and not m.hidden and not public.cm_blocked(p_user,m.sender)))
$$;
create or replace function public.cm_room_list(p_scope text default 'local',p_campus text default 'Kampar',p_category text default '',p_query text default '',p_mine boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); result jsonb; begin
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
create or replace function public.cm_room_detail(p_room uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 r:=public.cm_room_access(p_room); return public.cm_room_json(r,me);
end $$;
create or replace function public.cm_room_create(p_scope text,p_campus text,p_category text,p_title text,p_description text,p_capacity integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-room-user:'||me::text,0));
 if not exists(select 1 from public.campusmy_profiles where user_id=me and (p_scope='local' or campus=p_campus)) then raise exception 'Choose your campus in My page before creating a campus room.'; end if;
 if (select count(*) from public.campusmy_rooms where owner=me and created_at>now()-interval '1 day')>=3 then raise exception 'You can create up to 3 rooms a day. Try again tomorrow.'; end if;
 if (select count(*) from public.campusmy_room_members where user_id=me and status='active')>=30 then raise exception 'Leave a room before joining another (30 room limit).'; end if;
 insert into public.campusmy_rooms(owner,scope,campus,category,title,description,capacity)
 values(me,p_scope,p_campus,p_category,btrim(p_title),btrim(coalesce(p_description,'')),p_capacity) returning * into r;
 insert into public.campusmy_room_members(room_id,user_id) values(r.id,me);
 return r.id;
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
 insert into public.campusmy_room_members(room_id,user_id,last_read_seq) values(p_room,me,coalesce((select max(seq) from public.campusmy_room_messages where room_id=p_room),0))
 on conflict(room_id,user_id) do update set status='active',joined_at=now(),last_read_seq=excluded.last_read_seq;
end $$;
create or replace function public.cm_room_leave(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform 1 from public.campusmy_rooms where id=p_room for update; r:=public.cm_room_access(p_room,true);
 if r.owner=me and not r.closed then raise exception 'Close your room before leaving it.'; end if;
 update public.campusmy_room_members set status='left' where room_id=p_room and user_id=me;
end $$;
create or replace function public.cm_room_messages(p_room uuid,p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); result jsonb; seen bigint; begin
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
create or replace function public.cm_room_send(p_room uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; result uuid; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campusmy-room-user:'||me::text,0));
 perform 1 from public.campusmy_rooms where id=p_room for update; r:=public.cm_room_access(p_room,true);
 if r.closed then raise exception 'This room is closed.'; end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 or p_body !~ '[^[:space:]]' then raise exception 'Write a message between 1 and 2000 characters.'; end if;
 if (select count(*) from public.campusmy_room_messages where sender=me and created_at>now()-interval '1 minute')>=30 then raise exception 'Please wait before sending more messages.'; end if;
 insert into public.campusmy_room_messages(room_id,sender,body) values(p_room,me,btrim(p_body)) returning id into result;
 update public.campusmy_rooms set updated_at=now() where id=p_room; return result;
end $$;
create or replace function public.cm_room_members(p_room uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 r:=public.cm_room_access(p_room,true);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(p.display_name,''),p.username),
 'username',p.username,'owner',p.user_id=r.owner,'me',p.user_id=me) order by m.joined_at),'[]')
 from public.campusmy_room_members m join public.campusmy_profiles p on p.user_id=m.user_id
 where m.room_id=p_room and m.status='active' and not public.cm_blocked(me,m.user_id));
end $$;
create or replace function public.cm_room_manage(p_room uuid,p_action text,p_target uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); r public.campusmy_rooms; begin
 perform 1 from public.campusmy_rooms where id=p_room for update; r:=public.cm_room_access(p_room,true);
 if r.owner<>me then raise exception 'Only the room organiser can do that.' using errcode='42501'; end if;
 if p_action in ('close','reopen') then update public.campusmy_rooms set closed=(p_action='close') where id=p_room;
 elsif p_action='remove' and p_target is not null and p_target<>me then
  update public.campusmy_room_members set status='banned' where room_id=p_room and user_id=p_target and status='active';
 else raise exception 'Invalid room action.'; end if;
end $$;
create or replace function public.cm_room_mute(p_room uuid,p_muted boolean) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); begin
 perform public.cm_room_access(p_room,true);
 update public.campusmy_room_members set muted=p_muted where room_id=p_room and user_id=me;
end $$;
create or replace function public.cm_room_report(p_message uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user(); m public.campusmy_room_messages; begin
 select * into m from public.campusmy_room_messages where id=p_message and not hidden;
 if m.id is null or m.sender=me then raise exception 'This message cannot be reported.'; end if;
 perform public.cm_room_access(m.room_id,true);
 if public.cm_blocked(me,m.sender) then raise exception 'This message is unavailable.'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Please give a reason between 10 and 500 characters.'; end if;
 insert into public.campusmy_room_reports(message_id,reporter,reason) values(m.id,me,btrim(p_reason)) on conflict(message_id,reporter) do update set reason=excluded.reason;
end $$;
-- New functions otherwise inherit PostgreSQL's PUBLIC EXECUTE default.
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('cm_room_access','cm_room_json','cm_room_list','cm_room_detail','cm_room_create','cm_room_join','cm_room_leave','cm_room_messages','cm_room_send','cm_room_members','cm_room_manage','cm_room_mute','cm_room_report') loop
 execute 'revoke all on function '||r.signature||' from public,anon,authenticated'; end loop;
end $$;
grant execute on function public.cm_room_list(text,text,text,text,boolean),public.cm_room_detail(uuid),public.cm_room_create(text,text,text,text,text,integer),
 public.cm_room_join(uuid),public.cm_room_leave(uuid),public.cm_room_messages(uuid,bigint),public.cm_room_send(uuid,text),public.cm_room_members(uuid),
 public.cm_room_manage(uuid,text,uuid),public.cm_room_mute(uuid,boolean),public.cm_room_report(uuid,text) to authenticated;

-- If the 20261117 hardening migration has already replaced cm_room_send with a three-argument version,
-- re-applying this file must not leave an ambiguous two-argument overload behind.
do $$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cm_room_send' and p.pronargs=3) then
  drop function if exists public.cm_room_send(uuid,text);
  grant execute on function public.cm_room_send(uuid,text,uuid) to authenticated;
 end if;
end $$;
commit;
