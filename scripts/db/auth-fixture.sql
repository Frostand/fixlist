-- TEST ONLY: minimal mocked Supabase AUTH context, never a production migration.
-- Synthetic users + session JWT GUCs stand in for GoTrue/PostgREST. There is no
-- token signature, issuer, expiry, email or provider verification in this harness.
-- PostgreSQL itself enforces roles, grants, constraints, foreign keys and RLS.
create role anon nologin noinherit nosuperuser nobypassrls;
create role authenticated nologin noinherit nosuperuser nobypassrls;
create schema auth;
create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;

-- Only the auth.users columns used by the migration/tests are represented.
create table auth.users (id uuid primary key, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
revoke all on auth.users from public, anon, authenticated;

-- Supabase's SQL helper semantics, including legacy singular-GUC precedence:
-- https://github.com/supabase/auth/blob/master/migrations/20220224000811_update_auth_functions.up.sql
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

-- https://github.com/supabase/auth/blob/master/migrations/20220531120530_add_auth_jwt_function.up.sql
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;
