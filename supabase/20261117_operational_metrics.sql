-- Optional first-party operational counters. Apply after 20261117_security_hardening.sql.
-- Only hour, feature, fixed error category and app version are stored in this table.
begin;
create table if not exists public.campusmy_health_counts (
 hour timestamptz not null,
 area text not null check(area in ('auth','friends','sharing','dm','rooms','moderation','app','csp')),
 kind text not null check(kind in ('connection','access','schema','unexpected','csp')),
 version text not null check(version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
 count integer not null default 1 check(count between 1 and 10000000),
 primary key(hour,area,kind,version)
);
alter table public.campusmy_health_counts enable row level security;
revoke all on public.campusmy_health_counts from public,anon,authenticated;
create or replace function public.cm_record_health(p_area text,p_kind text,p_version text) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=public.cm_require_user();begin
 if p_area is null or p_area not in ('auth','friends','sharing','dm','rooms','moderation','app','csp')
 or p_kind is null or p_kind not in ('connection','access','schema','unexpected','csp')
 or p_version is null or p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' then raise exception 'Invalid health counter.';end if;
 perform public.cm_rate_limit(me,'health_counter',30,interval '10 minutes','Health counter limit reached.');
 delete from public.campusmy_health_counts where hour<now()-interval '30 days';
 insert into public.campusmy_health_counts(hour,area,kind,version) values(date_trunc('hour',now()),p_area,p_kind,p_version)
 on conflict(hour,area,kind,version) do update set count=least(10000000,campusmy_health_counts.count+1);
end $$;
create or replace function public.cm_health_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.cm_require_staff();begin
 return coalesce((select jsonb_agg(to_jsonb(c) order by hour desc,area,kind) from
 (select hour,area,kind,version,count from public.campusmy_health_counts where hour>now()-interval '7 days' order by hour desc,area,kind limit 500) c),'[]');
end $$;
-- Operator/scheduler only. No automatic deletion of messages, accounts, reviews or audit records.
create or replace function public.cm_prune_operational_data() returns void
language sql security definer set search_path='' as $$
 delete from public.campusmy_rate_events where created_at<now()-interval '2 days';
 delete from public.campusmy_health_counts where hour<now()-interval '30 days';
$$;
revoke all on function public.cm_record_health(text,text,text),public.cm_health_summary(),public.cm_prune_operational_data() from public,anon,authenticated;
grant execute on function public.cm_record_health(text,text,text),public.cm_health_summary() to authenticated;
notify pgrst,'reload schema';
commit;
