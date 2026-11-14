-- CampusMY v3. Run in your Supabase project's SQL Editor.
-- Existing non-CampusMY tables and auth accounts are not changed.
begin;
create table if not exists public.campusmy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-zA-Z][a-zA-Z0-9_]{2,23}$'),
  display_name text not null default '' check (length(display_name) <= 80),
  campus text not null default 'Kampar' check (campus in ('Kampar','Sungai Long')),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) < 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists campusmy_profiles_username_unique on public.campusmy_profiles (lower(username));
create table if not exists public.campusmy_planners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.campusmy_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  completed boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);
create index if not exists campusmy_todos_owner on public.campusmy_todos(user_id);
alter table public.campusmy_profiles enable row level security;
alter table public.campusmy_planners enable row level security;
alter table public.campusmy_todos enable row level security;
drop policy if exists campusmy_profile_owner on public.campusmy_profiles;
create policy campusmy_profile_owner on public.campusmy_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists campusmy_planner_owner on public.campusmy_planners;
create policy campusmy_planner_owner on public.campusmy_planners for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists campusmy_todo_owner on public.campusmy_todos;
create policy campusmy_todo_owner on public.campusmy_todos for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.campusmy_profiles, public.campusmy_planners, public.campusmy_todos from anon;
grant select, insert, update, delete on public.campusmy_profiles, public.campusmy_planners, public.campusmy_todos to authenticated;

-- Optimistic save prevents an old browser tab from silently replacing a newer plan.
create or replace function public.campusmy_save_planner(p_payload jsonb, p_expected_version bigint)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare result_version bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_expected_version = 0 then
    insert into public.campusmy_planners(user_id,payload,version)
      values(auth.uid(),p_payload,1) on conflict(user_id) do nothing returning version into result_version;
  else
    update public.campusmy_planners set payload=p_payload,version=version+1,updated_at=now()
      where user_id=auth.uid() and version=p_expected_version returning version into result_version;
  end if;
  if result_version is null then raise exception 'Planner changed online. Load the latest account copy before saving.' using errcode='40001'; end if;
  return result_version;
end $$;
revoke all on function public.campusmy_save_planner(jsonb,bigint) from public, anon;
grant execute on function public.campusmy_save_planner(jsonb,bigint) to authenticated;
commit;
