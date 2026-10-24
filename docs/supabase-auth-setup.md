# Supabase setup (optional real accounts)

The demo and `npm run build:submission` need none of this. Follow this guide only to run the ordinary build (`npm run build` or `npm run dev`) against your own Supabase project. Real accounts use Supabase Auth plus a closed single-pilot community workflow. The owner approves every participant by hand.

## What you get

- **Auth.** Email/password sign-up with email confirmation, login, resend, and recovery. Google and Apple sign-in are available behind flags. Anonymous sign-in is disabled. After sign-in a person creates a private elder or volunteer profile.
- **Closed pilot.** One pilot community. A real account can use the workflow only after the owner approves a membership for it. Without one, the app shows "pending access".
- **Workflow.** Elders draft, post, track, message, cancel, confirm, and rate. Volunteers browse coarse listings, accept (one volunteer per job), update progress, message, and see approved service credit.
- **Service credit.** The minutes come from an owner-set policy value copied when the request is posted. They are not measured work time or school verification. A category without approved minutes awards none.
- **Not included:** family delegation, background screening, teams, profile editing and deletion, and account-linked captures.

## Database

Apply both files to your project, in this order, after reading them:

1. `supabase/migrations/202610240001_account_profiles.sql` creates `account_profiles`: a private profile keyed to `auth.users.id`, with row-level security so a user can read and insert only their own row. There are no client updates or deletes.
2. `supabase/migrations/202610240002_community_workflow.sql` adds the pilot tables (`pilot_communities`, `pilot_memberships`, `pilot_task_policies`) and the job, event, message, rating, service-credit, and receipt tables. It also adds the `fixlist_private` schema.

The community tables force row-level security and revoke all direct client access. The client reaches data only through `authenticated`-only RPCs. They all check `auth.uid()` and a confirmed, non-anonymous user, and the workflow RPCs also require an approved membership whose role matches the profile.

| Writes | Reads |
| --- | --- |
| `community_post_request` | `community_access` |
| `community_accept_job` | `community_discover` |
| `community_advance_job` | `community_own_jobs` |
| `community_send_message` | `community_job_details` |
| `community_confirm_done` | `community_messages` |
| `community_cancel_job` | `community_service_hours` |
| `community_rate_job` | |

Every mutation takes a client key, and a replay with a different payload returns `idempotency_conflict`.

You can apply the files from the Dashboard SQL Editor or with the CLI. To check the schema without a hosted project:

```sh
npm run test:db          # pgTAP suites on in-memory PostgreSQL, no Docker
npm run test:db:runner   # checks for the test runner itself
```

Never run the test fixtures against a project with real users.

## Pilot provisioning (owner, server-side only)

The migrations create empty tables, so a new project has no eligible members. Create these rows in the SQL Editor or from a trusted server. Never do it from the client. Seed no fake people or default credit values, and approve accounts one at a time after you've reviewed them.

```sql
-- 1. Exactly one pilot community (the table allows one row). Keep coarse_area coarse.
insert into public.pilot_communities (label, coarse_area, enabled)
values ('<label>', '<coarse area, e.g. a city or county>', true);

-- 2. One policy per category you allow:
--    repair, safety, yard, household, errand, tech, companionship, moving.
--    needed_skills come from the profile skill list; credit minutes are 1-480, your decision.
insert into public.pilot_task_policies (category, enabled, needed_skills, approved_credit_minutes)
values ('household', true, '{general,cleaning}', <minutes>);

-- 3. Approve one reviewed account. role must match that user's profile.
--    user_id is the account's id in auth.users / account_profiles.
insert into public.pilot_memberships (user_id, community_id, role, status)
values ('<user uuid>', '<community uuid>', '<elder|volunteer>', 'approved');
```

Membership defaults to `pending`. Set `status = 'revoked'` to remove access. Approval means the owner accepts that account for the pilot. It isn't identity or background screening. Categories without an enabled policy can't be posted.

## Configure Auth

1. **Email.** In Dashboard → Authentication → Providers → Email, enable email/password and **Confirm email**, and keep anonymous sign-in disabled. Keep the default `{{ .ConfirmationURL }}` links in the email templates. The app doesn't handle implicit-token or token-hash links. The app asks for passwords of at least 12 characters. Configure SMTP in the Dashboard if you need more than the default sending limits. Email credentials never go in the client.
2. **Client keys.** Copy `.env.example` to ignored `.env.local`. Set only the project URL (`VITE_SUPABASE_URL`) and the publishable key (`VITE_SUPABASE_PUBLISHABLE_KEY`, starts with `sb_publishable_`). The app rejects legacy anon keys and secret or service-role keys. Never put one in the client.
3. **Web redirect.** Set `VITE_AUTH_WEB_REDIRECT_URL` to the web origin root of the build, for example `http://127.0.0.1:5173/`. The port must match your dev server. Outside loopback it must be HTTPS. The native callback is fixed at `app.fixlist.demo://auth/callback`.
4. **Redirect allowlist.** In Dashboard → Authentication → URL Configuration, set the Site URL to your web root. Add only the entries you'll use, exactly as written:

   ```text
   http://127.0.0.1:5173/\?fl_auth=*
   https://<your-domain>/\?fl_auth=*
   app.fixlist.demo://auth/callback\?fl_auth=*
   ```

   The first is for local development, the second for a deployed web build, and the third for iOS builds. The backslash escapes the literal `?` in Supabase's glob syntax. Don't use a wildcard host, an arbitrary path, or a broad `/**` entry.
5. **Provider flags.** `VITE_AUTH_GOOGLE_ENABLED`, `VITE_AUTH_APPLE_WEB_ENABLED`, and `VITE_AUTH_APPLE_NATIVE_ENABLED` stay `false` until the matching provider is configured below and tested. Provider client secrets and Apple signing keys belong only in the Supabase Dashboard, never in the client or `.env.local`.

## Optional providers

**Google.** In Google Auth Platform, create a Web application OAuth client with minimal OpenID, email, and profile scopes. Add your project's Auth callback `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. Enter the client ID and secret in Supabase's Google provider, then set `VITE_AUTH_GOOGLE_ENABLED=true`.

**Apple (web).** In your Apple Developer account, configure an App ID with Sign in with Apple and a Services ID with the same Supabase callback as its return URL. In Supabase's Apple provider, enter the Services ID and a generated client secret. That secret expires and must be regenerated. Then set `VITE_AUTH_APPLE_WEB_ENABLED=true`.

**Apple (iPhone).** The Xcode target already includes the auth plugin, the `app.fixlist.demo` URL scheme, and the Sign in with Apple entitlement. You must still enable that capability for your own App ID and provisioning profile, add the bundle ID `app.fixlist.demo` to the Supabase Apple provider's allowed client IDs, then run `npm run ios:sync` and rebuild on a signed device. Set `VITE_AUTH_APPLE_NATIVE_ENABLED=true` only after that works.

References: [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Apple](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Behavior and limits

- The real-account interface is English only. Profile language still applies to a person's own drafts.
- Sign-in uses PKCE. A confirmation or recovery link must be opened on the same browser or device that requested it. A new request replaces an older pending one.
- No real profile or job data is cached in `localStorage`. A lost response can be retried while the page stays open, but there's no offline or reload recovery.
- The workflow has been tested only against mocks and in-memory PostgreSQL. It hasn't run against a live Supabase Auth, PostgREST, or provider setup. Concurrent behavior, such as two volunteers accepting at once, isn't tested beyond single-session cases.
- Any real use needs your own review of safety, screening, and credit policy beyond this closed pilot.
