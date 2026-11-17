# CampusMY Supabase connection

The public Project URL and publishable key are already in root `config.js`. Supabase Auth handles passwords and confirmation links; CampusMY does not store passwords in profile tables.

## Existing live project

The account, social and chat-room bootstraps were already applied. Do not run them again. The following upgrades were also applied successfully, after owner approval and a private application backup on 17 November 2026, in this order:

1. `supabase/20261117_security_hardening.sql`
2. `supabase/20261117_operational_metrics.sql`

These upgrades are complete for the existing live project; do not rerun them unnecessarily. Future production changes need owner approval and a backup before execution. Read [the rollout and recovery plan](docs/SECURITY.md). Staff appointment is a separate owner decision; no ordinary user can grant that role.

## A new empty project only

Run each full file in SQL Editor in this order:

1. `CampusMY-supabase-setup.sql`
2. `CampusMY-social-setup.sql`
3. `supabase/20261116_chat_rooms.sql`
4. `supabase/20261117_security_hardening.sql`
5. `supabase/20261117_operational_metrics.sql`

The first three are legacy bootstrap files. After hardening they deliberately refuse to run, preventing an accidental downgrade. Both versioned 17 November migrations can be reapplied.

## Authentication settings

Use `https://campusmy-website.vercel.app/` as the production Site URL and include that exact URL in Authentication > URL Configuration > Redirect URLs. Add `http://127.0.0.1:4173/` and `http://localhost:4173/` only for local development. Add any approved preview origin explicitly if testing email callbacks there. Avoid broad production wildcards. Existing confirmed accounts can sign in to a preview without changing email redirect settings.

Keep Confirm email and Secure email change enabled. Review production SMTP, CAPTCHA/Auth abuse protection and redirect configuration before a public launch; do not change billing or disable confirmation to make a test pass. Use user-controlled browser steps for passwords, reset links, email-change confirmation and login codes. A confirmed mailbox is not verified university enrolment.

Create/confirm an account, save a profile/task/private timetable, sign out, then verify another account cannot read them. Test optional friend sharing and revocation with two confirmed test accounts. Never put a database password, secret key or service-role key into `config.js`, chat, Git or screenshots.

RLS protects owner tables; private social/room rows are exposed only through membership-checked RPCs. The publishable key is intentionally public and depends on these database checks. Review [security boundaries and limitations](docs/SECURITY.md) before inviting students.
