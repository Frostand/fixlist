-- UNAPPLIED. Run only against the owner's NEW FixList Supabase project/local stack.
-- Account preferences only. No shared JSON state, jobs, messages, hours, links or screening.
begin;
create function public.valid_profile_availability(slots jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(slots) <> 'array' then false else
    jsonb_array_length(slots) <= 21 and not exists (
      select 1 from jsonb_array_elements(slots) s
      where case when jsonb_typeof(s) <> 'object' then true else
        not (s ? 'day' and s ? 'part')
        or s - 'day' - 'part' <> '{}'::jsonb
        or jsonb_typeof(s->'day') <> 'number'
        or (s->>'day') not in ('0','1','2','3','4','5','6')
        or jsonb_typeof(s->'part') <> 'string'
        or (s->>'part') not in ('morning','afternoon','evening') end
    ) end;
$$;
revoke all on function public.valid_profile_availability(jsonb) from public, anon;
grant execute on function public.valid_profile_availability(jsonb) to authenticated;

create function public.valid_profile_needs(needs text[])
returns boolean language sql immutable set search_path = '' as $$
  select cardinality(needs) <= 16 and not exists (
    select 1 from unnest(needs) n where n is null or char_length(n) not between 1 and 160 or char_length(btrim(n)) = 0
  );
$$;
revoke all on function public.valid_profile_needs(text[]) from public, anon;
grant execute on function public.valid_profile_needs(text[]) to authenticated;

create table public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('elder','volunteer')),
  name text not null check (char_length(name) <= 80 and char_length(btrim(name)) >= 1),
  area text not null check (char_length(area) <= 100 and char_length(btrim(area)) >= 1),
  language text not null check (language in ('en','es','zh','vi','ko','tl','ru','fr','ar')),
  needs text[] not null default '{}' check (public.valid_profile_needs(needs)),
  skills text[] not null default '{}' check (cardinality(skills) <= 11 and array_position(skills, null) is null and skills <@ array['general','lifting','electrical-basic','plumbing-basic','carpentry','yard','tech-help','cleaning','errands','safety-install','companionship']),
  tools text[] not null default '{}' check (cardinality(tools) <= 11 and array_position(tools, null) is null and tools <@ array['ladder','drill','screwdriver-set','hammer','stud-finder','level','pliers','tape-measure','gloves','car','watering-can']),
  availability jsonb not null default '[]' check (public.valid_profile_availability(availability)),
  max_miles integer not null default 10 check (max_miles between 1 and 50),
  school text not null default '' check (char_length(school) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_preferences check (
    (role = 'elder' and skills = '{}' and tools = '{}' and availability = '[]' and max_miles = 10 and school = '')
    or (role = 'volunteer' and needs = '{}')
  )
);
alter table public.account_profiles enable row level security;
alter table public.account_profiles force row level security;
revoke all on table public.account_profiles from public, anon, authenticated;
grant select on table public.account_profiles to authenticated;
-- Column grants prohibit client timestamps, UID changes, updates, deletes and future authority fields.
grant insert (user_id, role, name, area, language, needs, skills, tools, availability, max_miles, school) on public.account_profiles to authenticated;
create policy read_own_profile on public.account_profiles for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy create_own_profile on public.account_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
comment on table public.account_profiles is 'Private setup preferences. Role is a preference, never screening, family access or shared-workflow authority. One row per auth.users UUID; no client updates in account increment 1.';
commit;
