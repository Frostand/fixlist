-- UNAPPLIED. Closed pilot; owner provisions communities, memberships and policies.
-- No people, approvals, family links or credit-minute values are seeded here.
begin;
create schema fixlist_private;
revoke all on schema fixlist_private from public, anon, authenticated;

create function fixlist_private.valid_text(v jsonb, maximum integer, allow_empty boolean default false)
returns boolean language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= maximum
   and (allow_empty or char_length(btrim(v #>> '{}')) > 0)
   and translate(v #>> '{}', chr(9)||chr(10)||chr(13), '') !~ '[[:cntrl:]]'
   and (v #>> '{}') !~* '(^|[^[:alnum:]_-])(data|blob|file|capacitor|ph|assets-library):[^[:space:]]', false);
$$;
create function fixlist_private.exact_shape(v jsonb, keys text[]) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(v) = 'object' and v ?& keys and v - keys = '{}'::jsonb, false);
$$;
create function fixlist_private.valid_list(v jsonb, allowed text[]) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
 if jsonb_typeof(v) is distinct from 'array' then return false; end if;
 return jsonb_array_length(v) <= cardinality(allowed)
   and not exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any(allowed)))
   and (select count(*) = count(distinct e) from jsonb_array_elements(v) e);
end;
$$;
create function fixlist_private.valid_analysis(v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
 if not fixlist_private.exact_shape(v,array['title','titleEnglish','summary','summaryEnglish','category','skills','tools','estimatedMinutes','peopleNeeded','urgency','safetyNotes','language','engine']) then return false; end if;
 if not coalesce((fixlist_private.valid_text(v->'title',200) and fixlist_private.valid_text(v->'titleEnglish',200)
   and fixlist_private.valid_text(v->'summary',2000) and fixlist_private.valid_text(v->'summaryEnglish',2000)
   and (v->>'category') = any(array['repair','safety','yard','household','errand','tech','companionship','moving'])
   and fixlist_private.valid_list(v->'skills',array['general','lifting','electrical-basic','plumbing-basic','carpentry','yard','tech-help','cleaning','errands','safety-install','companionship'])
   and fixlist_private.valid_list(v->'tools',array['ladder','drill','screwdriver-set','hammer','stud-finder','level','pliers','tape-measure','gloves','car','watering-can'])
   and jsonb_typeof(v->'estimatedMinutes') = 'number' and (v->>'estimatedMinutes')::numeric between 1 and 1440
   and v->'peopleNeeded' in ('1'::jsonb,'2'::jsonb)
   and (v->>'urgency') = any(array['today','this-week','flexible'])
   and (v->>'language') = any(array['en','es','zh','vi','ko','tl','ru','fr','ar'])
   and (v->>'engine') = any(array['rules','apple-on-device'])
   and jsonb_typeof(v->'safetyNotes') = 'array'),false) then return false; end if;
 return jsonb_array_length(v->'safetyNotes') <= 30 and not exists (
   select 1 from jsonb_array_elements(v->'safetyNotes') n where not fixlist_private.valid_text(n,1000));
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create table public.pilot_communities (
 id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check(singleton),
 label text not null check(char_length(btrim(label)) between 1 and 100),
 coarse_area text not null check(char_length(btrim(coarse_area)) between 1 and 100), enabled boolean not null default false
);
create table public.pilot_memberships (
 user_id uuid primary key references public.account_profiles(user_id),
 community_id uuid not null references public.pilot_communities(id),
 role text not null check(role in ('elder','volunteer')),
 status text not null default 'pending' check(status in ('pending','approved','revoked'))
);
comment on table public.pilot_memberships is 'Owner-approved pilot eligibility only, not identity/background screening. Onboarding cannot write this table.';
create table public.pilot_task_policies (
 category text primary key check(category in ('repair','safety','yard','household','errand','tech','companionship','moving')),
 enabled boolean not null default false,
 approved_credit_minutes integer check(approved_credit_minutes between 1 and 480),
 needed_skills text[] not null default '{}' check(fixlist_private.valid_list(to_jsonb(needed_skills),array['general','lifting','electrical-basic','plumbing-basic','carpentry','yard','tech-help','cleaning','errands','safety-install','companionship']))
);
create table public.community_jobs (
 id uuid primary key, ordinal bigint generated always as identity unique,
 community_id uuid not null references public.pilot_communities(id), elder_id uuid not null references public.pilot_memberships(user_id),
 volunteer_id uuid references public.pilot_memberships(user_id), category text not null references public.pilot_task_policies(category),
 coarse_area text not null, needed_skills text[] not null, approved_credit_minutes integer check(approved_credit_minutes between 1 and 480),
 status text not null default 'open' check(status in ('open','accepted','on-the-way','arrived','reported-done','completed','cancelled')),
 created_at timestamptz not null default clock_timestamp(),
 check(volunteer_id is null or volunteer_id <> elder_id),
 check((status in ('open','cancelled')) or volunteer_id is not null)
);
create index community_jobs_discovery on public.community_jobs(community_id,ordinal desc) where status='open';
create index community_jobs_elder on public.community_jobs(elder_id,ordinal desc);
create index community_jobs_volunteer on public.community_jobs(volunteer_id,ordinal desc);
create table public.community_job_details (
 job_id uuid primary key references public.community_jobs(id),
 source text not null check(source in ('voice','typed','scan','quick-pick')),
 original_text text not null check(char_length(original_text) between 1 and 4000),
 analysis jsonb not null check(fixlist_private.valid_analysis(analysis) and analysis->'peopleNeeded'='1'::jsonb),
 address text not null check(char_length(btrim(address)) between 1 and 500)
);
create table public.community_events (
 id bigint generated always as identity primary key, job_id uuid not null references public.community_jobs(id),
 actor_id uuid not null references auth.users(id), type text not null check(type in ('posted','accepted','on-the-way','arrived','reported-done','confirmed','cancelled','rated')),
 at timestamptz not null default clock_timestamp()
);
create index community_events_job on public.community_events(job_id,id);
create table public.community_messages (
 id bigint generated always as identity primary key, job_id uuid not null references public.community_jobs(id),
 from_id uuid not null references auth.users(id), at timestamptz not null default clock_timestamp(),
 text text not null check(char_length(btrim(text)) between 1 and 2000),
 language text not null check(language in ('en','es','zh','vi','ko','tl','ru','fr','ar'))
);
create index community_messages_job on public.community_messages(job_id,id desc);
create table public.community_ratings (
 job_id uuid primary key references public.community_jobs(id), by_id uuid not null references auth.users(id),
 stars integer not null check(stars between 1 and 5), note text not null check(char_length(note)<=1000), at timestamptz not null default clock_timestamp()
);
create table public.community_service_credits (
 job_id uuid primary key references public.community_jobs(id), ordinal bigint generated always as identity unique,
 volunteer_id uuid not null references auth.users(id), approved_credit_minutes integer not null check(approved_credit_minutes between 1 and 480),
 confirmed_at timestamptz not null default clock_timestamp()
);
comment on table public.community_service_credits is 'Owner-approved service credit, snapshotted on post and awarded only on elder confirmation. Not measured duration or official school verification.';
create index community_credits_volunteer on public.community_service_credits(volunteer_id,ordinal desc);
create table public.community_receipts (
 actor_id uuid not null references auth.users(id), key uuid not null, operation text not null, payload jsonb not null, result jsonb,
 primary key(actor_id,key)
);
-- Deny all direct client reads/writes, including future columns. All data leaves
-- through explicit projections in narrow RPCs. RLS is an additional deny-all layer.
do $$ declare t text; begin
 foreach t in array array['pilot_communities','pilot_memberships','pilot_task_policies','community_jobs','community_job_details','community_events','community_messages','community_ratings','community_service_credits','community_receipts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on table public.%I from public, anon, authenticated',t);
 end loop;
end $$;
do $$ declare t text; col text; seq text; begin
 foreach t in array array['community_jobs','community_events','community_messages','community_service_credits'] loop
 col := case when t in ('community_events','community_messages') then 'id' else 'ordinal' end;
 seq := pg_get_serial_sequence('public.'||t,col);
 execute format('revoke all on sequence %s from public, anon, authenticated',seq);
 end loop;
end $$;

create function fixlist_private.actor() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
 if actor is null or coalesce(auth.jwt()->>'is_anonymous','true') <> 'false'
 or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and u.is_anonymous=false) then
 raise exception using errcode='P0001',message='permission_denied'; end if;
 return actor;
end;
$$;
create function fixlist_private.member(actor uuid) returns public.pilot_memberships
language plpgsql security definer set search_path = '' as $$
declare m public.pilot_memberships;
begin
 -- SHARE locks hold eligibility, role, profile and enabled community stable until commit.
 select pm.* into m from public.pilot_memberships pm join public.account_profiles p on p.user_id=pm.user_id and p.role=pm.role
 join public.pilot_communities c on c.id=pm.community_id and c.enabled
 where pm.user_id=actor for share of pm,p,c;
 if not found or m.status='pending' then raise exception using errcode='P0001',message='pending_access'; end if;
 if m.status <> 'approved' then raise exception using errcode='P0001',message='permission_denied'; end if;
 return m;
end;
$$;
create function fixlist_private.discovery(j public.community_jobs) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('id',j.id,'category',j.category,'catalogTitle',case j.category
 when 'repair' then 'Repair help' when 'safety' then 'Safety installation help' when 'yard' then 'Yard help'
 when 'household' then 'Household help' when 'errand' then 'Errand help' when 'tech' then 'Technology help'
 when 'companionship' then 'Companionship' when 'moving' then 'Moving help' end,
 'coarseArea',j.coarse_area,'neededSkills',j.needed_skills,'approvedServiceCreditMinutes',j.approved_credit_minutes);
$$;
create function fixlist_private.job(j public.community_jobs) returns jsonb
language sql immutable set search_path = '' as $$
 select fixlist_private.discovery(j) || jsonb_build_object('elderId',j.elder_id,'volunteerId',j.volunteer_id,'status',j.status,'createdAt',j.created_at);
$$;

-- Private transactional engine. Public operation-specific wrappers below expose no
-- actor, timestamps, credit amounts, screening flags or arbitrary table selectors.
create function fixlist_private.mutate(op text, p_key uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; m public.pilot_memberships; j public.community_jobs; policy public.pilot_task_policies;
 receipt public.community_receipts; v_result jsonb; job_id uuid; message_id bigint; event_type text;
begin
 actor := fixlist_private.actor(); m := fixlist_private.member(actor);
 if p_key is null or payload is null or octet_length(payload::text)>200000 then raise exception using errcode='P0001',message='invalid_input'; end if;
 -- Unique insertion blocks a simultaneous same-key transaction until its commit.
 insert into public.community_receipts(actor_id,key,operation,payload) values(actor,p_key,op,payload) on conflict do nothing;
 select * into receipt from public.community_receipts r where r.actor_id=actor and r.key=p_key for update;
 if receipt.operation<>op or receipt.payload<>payload then raise exception using errcode='P0001',message='idempotency_conflict'; end if;
 if receipt.result is not null then return receipt.result; end if;
 if op='postRequest' then
  if m.role<>'elder' then raise exception using errcode='P0001',message='permission_denied'; end if;
  if not fixlist_private.exact_shape(payload,array['requestId','source','originalText','analysis','address'])
   or not fixlist_private.valid_text(payload->'requestId',36) or not fixlist_private.valid_text(payload->'originalText',4000)
   or not fixlist_private.valid_text(payload->'address',500) or not fixlist_private.valid_analysis(payload->'analysis')
   or not coalesce((payload->>'source') in ('voice','typed','scan','quick-pick'),false) then raise exception using errcode='P0001',message='invalid_input'; end if;
  if payload->'analysis'->'peopleNeeded'<>'1'::jsonb then raise exception using errcode='P0001',message='unsupported_team'; end if;
  select * into policy from public.pilot_task_policies p where p.category=payload->'analysis'->>'category' and p.enabled for share;
  if not found then raise exception using errcode='P0001',message='invalid_state'; end if;
  job_id := (payload->>'requestId')::uuid;
  insert into public.community_jobs(id,community_id,elder_id,category,coarse_area,needed_skills,approved_credit_minutes)
   values(job_id,m.community_id,actor,policy.category,(select coarse_area from public.pilot_communities where id=m.community_id),policy.needed_skills,policy.approved_credit_minutes) returning * into j;
  insert into public.community_job_details(job_id,source,original_text,analysis,address)
   values(job_id,payload->>'source',payload->>'originalText',payload->'analysis',payload->>'address');
  event_type := 'posted';
 else
  if not fixlist_private.exact_shape(payload,case op when 'advanceJob' then array['jobId','step'] when 'sendMessage' then array['jobId','text','language']
   when 'rateJob' then array['jobId','stars','note'] else array['jobId'] end)
   or not fixlist_private.valid_text(payload->'jobId',36) then raise exception using errcode='P0001',message='invalid_input'; end if;
  job_id := (payload->>'jobId')::uuid;
  select * into j from public.community_jobs where id=job_id and community_id=m.community_id for update;
  if not found then raise exception using errcode='P0001',message='not_found'; end if;
  if op='acceptJob' then
   if m.role<>'volunteer' then raise exception using errcode='P0001',message='permission_denied'; end if;
   if j.status<>'open' or j.volunteer_id is not null then raise exception using errcode='P0001',message='conflict'; end if;
   -- Assignment requires the poster to remain currently eligible too.
   perform fixlist_private.member(j.elder_id);
   update public.community_jobs set volunteer_id=actor,status='accepted' where id=job_id returning * into j;
   event_type := 'accepted';
  else
   if actor<>j.elder_id and actor is distinct from j.volunteer_id then raise exception using errcode='P0001',message='permission_denied'; end if;
   case op
   when 'advanceJob' then
    if m.role<>'volunteer' or actor is distinct from j.volunteer_id then raise exception using errcode='P0001',message='permission_denied'; end if;
    if not ((j.status='accepted' and payload->>'step'='on-the-way') or (j.status='on-the-way' and payload->>'step'='arrived')
     or (j.status='arrived' and payload->>'step'='reported-done')) then raise exception using errcode='P0001',message='invalid_state'; end if;
    update public.community_jobs set status=payload->>'step' where id=job_id returning * into j;
    event_type := j.status;
   when 'sendMessage' then
    if j.status not in ('accepted','on-the-way','arrived','reported-done') then raise exception using errcode='P0001',message='invalid_state'; end if;
    if not fixlist_private.valid_text(payload->'text',2000) or not coalesce((payload->>'language') in ('en','es','zh','vi','ko','tl','ru','fr','ar'),false) then raise exception using errcode='P0001',message='invalid_input'; end if;
    insert into public.community_messages(job_id,from_id,text,language) values(job_id,actor,payload->>'text',payload->>'language') returning id into message_id;
   when 'confirmDone' then
    if actor<>j.elder_id or m.role<>'elder' then raise exception using errcode='P0001',message='permission_denied'; end if;
    if j.status<>'reported-done' then raise exception using errcode='P0001',message='invalid_state'; end if;
    perform fixlist_private.member(j.volunteer_id);
    update public.community_jobs set status='completed' where id=job_id returning * into j;
    if j.approved_credit_minutes is not null then
     insert into public.community_service_credits(job_id,volunteer_id,approved_credit_minutes) values(job_id,j.volunteer_id,j.approved_credit_minutes);
    end if;
    event_type := 'confirmed';
   when 'cancelJob' then
    if j.status in ('completed','cancelled') then raise exception using errcode='P0001',message='invalid_state'; end if;
    update public.community_jobs set status='cancelled' where id=job_id returning * into j;
    event_type := 'cancelled';
   when 'rateJob' then
    if actor<>j.elder_id or m.role<>'elder' then raise exception using errcode='P0001',message='permission_denied'; end if;
    if j.status<>'completed' then raise exception using errcode='P0001',message='invalid_state'; end if;
    if not coalesce(payload->'stars' in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb),false) or not fixlist_private.valid_text(payload->'note',1000,true) then raise exception using errcode='P0001',message='invalid_input'; end if;
    insert into public.community_ratings(job_id,by_id,stars,note) values(job_id,actor,(payload->>'stars')::integer,payload->>'note');
    event_type := 'rated';
   else raise exception using errcode='P0001',message='invalid_input'; end case;
  end if;
 end if;
 if event_type is not null then insert into public.community_events(job_id,actor_id,type) values(job_id,actor,event_type); end if;
 v_result := jsonb_build_object('ok',true,'value',jsonb_build_object('jobId',j.id,'status',j.status,'messageId',message_id::text));
 update public.community_receipts r set result=v_result where r.actor_id=actor and r.key=p_key;
 return v_result;
exception
 when sqlstate 'P0001' then return jsonb_build_object('ok',false,'code',sqlerrm);
 when unique_violation then return jsonb_build_object('ok',false,'code','conflict');
 when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','invalid_input');
end;
$$;
create function fixlist_private.read(q text, payload jsonb, p_before bigint default null, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; m public.pilot_memberships; j public.community_jobs; value jsonb; items jsonb; cursor text;
begin
 actor := fixlist_private.actor();
 if p_limit is null or p_limit not between 1 and 100 or (p_before is not null and p_before<1) then raise exception using errcode='P0001',message='invalid_input'; end if;
 if not fixlist_private.exact_shape(payload,case when q in ('details','messages') then array['jobId'] else array[]::text[] end) then raise exception using errcode='P0001',message='invalid_input'; end if;
 if q='access' then
  select pm.* into m from public.pilot_memberships pm join public.account_profiles p on p.user_id=pm.user_id and p.role=pm.role
   join public.pilot_communities c on c.id=pm.community_id and c.enabled where pm.user_id=actor;
  value := jsonb_build_object('state',case when m.status is null then 'pending' else m.status end,'role',m.role,'community',
   case when m.status='approved' then (select jsonb_build_object('id',c.id,'label',c.label,'coarseArea',c.coarse_area) from public.pilot_communities c where c.id=m.community_id) else null end);
 else
  m := fixlist_private.member(actor);
  if q in ('details','messages') then
   select * into j from public.community_jobs where id=(payload->>'jobId')::uuid and community_id=m.community_id;
   if not found then raise exception using errcode='P0001',message='not_found'; end if;
   if actor<>j.elder_id and actor is distinct from j.volunteer_id then raise exception using errcode='P0001',message='permission_denied'; end if;
  end if;
  if q='details' then
   select jsonb_build_object('job',fixlist_private.job(j),'source',d.source,'originalText',d.original_text,'analysis',d.analysis,'address',d.address,
    'elderName',(select name from public.account_profiles where user_id=j.elder_id),
    'volunteerName',(select name from public.account_profiles where user_id=j.volunteer_id),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id::text,'actorId',e.actor_id,'type',e.type,'at',e.at) order by e.id) from public.community_events e where e.job_id=j.id),'[]'::jsonb),
    'rating',(select jsonb_build_object('stars',r.stars,'note',r.note,'byId',r.by_id,'at',r.at) from public.community_ratings r where r.job_id=j.id)) into value
   from public.community_job_details d where d.job_id=j.id;
  else
   if q='discover' and m.role<>'volunteer' then raise exception using errcode='P0001',message='permission_denied'; end if;
   if q='serviceHours' and m.role<>'volunteer' then raise exception using errcode='P0001',message='permission_denied'; end if;
   with page as (
    select x.ordinal,x.dto from (
     select jb.ordinal,case when q='discover' then fixlist_private.discovery(jb) else fixlist_private.job(jb) end dto
      from public.community_jobs jb where q in ('discover','ownJobs') and jb.community_id=m.community_id
      and (case when q='discover' then jb.status='open' and exists(select 1 from public.pilot_memberships pm where pm.user_id=jb.elder_id and pm.status='approved' and pm.role='elder')
       else actor=jb.elder_id or actor=jb.volunteer_id end)
     union all
     select msg.id,jsonb_build_object('id',msg.id::text,'jobId',msg.job_id,'fromId',msg.from_id,'at',msg.at,'text',msg.text,'language',msg.language)
      from public.community_messages msg where q='messages' and msg.job_id=j.id
     union all
     select sc.ordinal,jsonb_build_object('jobId',sc.job_id,'volunteerId',sc.volunteer_id,'approvedServiceCreditMinutes',sc.approved_credit_minutes,'confirmedAt',sc.confirmed_at)
      from public.community_service_credits sc where q='serviceHours' and sc.volunteer_id=actor
    ) x where p_before is null or x.ordinal<p_before order by x.ordinal desc limit p_limit
   ) select coalesce(jsonb_agg(dto order by ordinal desc),'[]'::jsonb),case when count(*)=p_limit then min(ordinal)::text else null end into items,cursor from page;
   value := jsonb_build_object('items',items,'nextCursor',cursor);
  end if;
 end if;
 return jsonb_build_object('ok',true,'value',value);
exception
 when sqlstate 'P0001' then return jsonb_build_object('ok',false,'code',sqlerrm);
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','invalid_input');
end;
$$;

-- Narrow public RPC surface. Security-definer functions have an empty search_path;
-- every object reference is qualified. Internal functions cannot be called by clients.
create function public.community_post_request(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('postRequest',p_key,p_payload); $$;
revoke all on function public.community_post_request(uuid,jsonb) from public, anon;
grant execute on function public.community_post_request(uuid,jsonb) to authenticated;
create function public.community_accept_job(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('acceptJob',p_key,p_payload); $$;
revoke all on function public.community_accept_job(uuid,jsonb) from public, anon;
grant execute on function public.community_accept_job(uuid,jsonb) to authenticated;
create function public.community_advance_job(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('advanceJob',p_key,p_payload); $$;
revoke all on function public.community_advance_job(uuid,jsonb) from public, anon;
grant execute on function public.community_advance_job(uuid,jsonb) to authenticated;
create function public.community_send_message(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('sendMessage',p_key,p_payload); $$;
revoke all on function public.community_send_message(uuid,jsonb) from public, anon;
grant execute on function public.community_send_message(uuid,jsonb) to authenticated;
create function public.community_confirm_done(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('confirmDone',p_key,p_payload); $$;
revoke all on function public.community_confirm_done(uuid,jsonb) from public, anon;
grant execute on function public.community_confirm_done(uuid,jsonb) to authenticated;
create function public.community_cancel_job(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('cancelJob',p_key,p_payload); $$;
revoke all on function public.community_cancel_job(uuid,jsonb) from public, anon;
grant execute on function public.community_cancel_job(uuid,jsonb) to authenticated;
create function public.community_rate_job(p_key uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.mutate('rateJob',p_key,p_payload); $$;
revoke all on function public.community_rate_job(uuid,jsonb) from public, anon;
grant execute on function public.community_rate_job(uuid,jsonb) to authenticated;
create function public.community_access() returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('access','{}'::jsonb); $$;
revoke all on function public.community_access() from public, anon;
grant execute on function public.community_access() to authenticated;
create function public.community_discover(p_before bigint default null, p_limit integer default 50) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('discover','{}'::jsonb,p_before,p_limit); $$;
revoke all on function public.community_discover(bigint,integer) from public, anon;
grant execute on function public.community_discover(bigint,integer) to authenticated;
create function public.community_own_jobs(p_before bigint default null, p_limit integer default 50) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('ownJobs','{}'::jsonb,p_before,p_limit); $$;
revoke all on function public.community_own_jobs(bigint,integer) from public, anon;
grant execute on function public.community_own_jobs(bigint,integer) to authenticated;
create function public.community_job_details(p_job_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('details',jsonb_build_object('jobId',p_job_id)); $$;
revoke all on function public.community_job_details(uuid) from public, anon;
grant execute on function public.community_job_details(uuid) to authenticated;
create function public.community_messages(p_job_id uuid, p_before bigint default null, p_limit integer default 50) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('messages',jsonb_build_object('jobId',p_job_id),p_before,p_limit); $$;
revoke all on function public.community_messages(uuid,bigint,integer) from public, anon;
grant execute on function public.community_messages(uuid,bigint,integer) to authenticated;
create function public.community_service_hours(p_before bigint default null, p_limit integer default 50) returns jsonb
language sql security definer set search_path = '' as $$ select fixlist_private.read('serviceHours','{}'::jsonb,p_before,p_limit); $$;
revoke all on function public.community_service_hours(bigint,integer) from public, anon;
grant execute on function public.community_service_hours(bigint,integer) to authenticated;
revoke all on all functions in schema fixlist_private from public, anon, authenticated;
commit;
