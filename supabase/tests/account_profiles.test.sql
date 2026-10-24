-- UNEXECUTED HERE. Local disposable Supabase only: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);
insert into auth.users (id, email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111', now()),
 ('22222222-2222-4222-8222-222222222222', now()),
 ('33333333-3333-4333-8333-333333333333', null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
select lives_ok($$insert into public.account_profiles(user_id,role,name,area,language) values ('11111111-1111-4111-8111-111111111111','elder','Private Elder','Town','en')$$, 'Own elder setup inserts');
select is((select count(*) from public.account_profiles), 1::bigint, 'Own profile visible');
select throws_ok($$insert into public.account_profiles(user_id,role,name,area,language) values ('22222222-2222-4222-8222-222222222222','elder','Forged','Town','en')$$, '42501', null, 'Cannot choose another UID');
select throws_ok($$update public.account_profiles set name='Changed'$$, '42501', null, 'No client profile update authority in increment 1');
select throws_ok($$delete from public.account_profiles$$, '42501', null, 'No client profile delete authority');
select throws_ok($$insert into public.account_profiles(user_id,role,name,area,language,updated_at) values ('11111111-1111-4111-8111-111111111111','elder','Name','Town','en',now())$$, '42501', null, 'No client timestamps');
select throws_ok($$insert into public.account_profiles(user_id,role,name,area,language) values ('11111111-1111-4111-8111-111111111111','elder','Again','Town','en')$$, '23505', null, 'One profile per auth.users UUID');
select is(public.valid_profile_availability('[{"day":1,"part":"morning"}]'), true, 'Valid bounded availability');
select is(public.valid_profile_availability('[{"day":1,"part":null}]'), false, 'Null slot part rejected');
select is(public.valid_profile_availability('[{"day":8,"part":"morning"}]'), false, 'Invalid slot day rejected');
select is(public.valid_profile_availability('[{"day":1,"part":"morning","screened":true}]'), false, 'Unknown slot authority rejected');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}';
select is((select count(*) from public.account_profiles), 0::bigint, 'Second user cannot read first profile');
select throws_ok($$insert into public.account_profiles(user_id,role,name,area,language) values ('22222222-2222-4222-8222-222222222222','family','Name','Town','en')$$, '23514', null, 'No family setup role');
select lives_ok($$insert into public.account_profiles(user_id,role,name,area,language,skills,tools,availability,max_miles,school) values ('22222222-2222-4222-8222-222222222222','volunteer','Private Volunteer','Town','es',array['yard'],array['gloves'],'[{"day":2,"part":"evening"}]',23,'School')$$, 'Own volunteer preferences insert');
select throws_ok($$select badges from public.account_profiles$$, '42703', null, 'No screening field to self-assert');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}';
select is((select count(*) from public.account_profiles), 0::bigint, 'Anonymous auth session has no profile access');
select throws_ok($$insert into public.account_profiles(user_id,role,name,area,language) values ('33333333-3333-4333-8333-333333333333','elder','Anon','Town','en')$$, '42501', null, 'Anonymous auth session cannot onboard');
set local role anon;
select throws_ok($$select * from public.account_profiles$$, '42501', null, 'Unauthenticated role cannot read profiles');
reset role;
select * from finish();
rollback;
