# CampusMY setup and provider configuration

## Local application

Requirements: Node.js 22.18+, npm, Python 3.12+, and uv. SQLite is the credential-free local database; production uses PostgreSQL.

```bash
bash scripts/setup.sh
npm run dev
```

Open http://localhost:3000. API documentation is at http://localhost:8000/docs.

Public browsing and guest timetables should work without cloud credentials. Shared features require a real login and verified university membership. There is no production impersonation button or fake student account.

Copy the example environment files in `apps/web` and `services/api` to their documented local filenames before setting credentials. Restart both services after changing configuration. Never paste secret keys into chat or commit local environment files.

## Supabase project and database

1. Create a project in an owner-controlled Supabase account. Choose an appropriate region and budget.
2. Copy the project URL and public/publishable key to the frontend environment. Public keys are intended for the client; database passwords and secret/service keys are not.
3. Use the project's Connect panel to choose a PostgreSQL connection string supported by the host and driver. Use SQLAlchemy's `postgresql+psycopg://` dialect and appropriate TLS verification.
4. Use an administrative/migration connection to run Alembic. Use a separate limited runtime role for the API. Application tables are private and the browser must not have Data API grants to them.
5. Configure the backend issuer and audience for this project and an asymmetric signing-key setup. FastAPI validates the Supabase JWT against trusted project keys.
6. Run migrations and the reviewed seed import, then verify that a fresh repeated import does not duplicate courses.

Do not use an administrator database account as the ordinary API runtime identity. JWT validation and direct SQLAlchemy database permissions are separate responsibilities.

## Email login

1. Enable the Supabase email provider and configure OTP/passwordless email templates according to the implemented login form.
2. Configure a production SMTP provider in Supabase Auth. The built-in mail service is not a production delivery solution.
3. Configure the sender domain with SPF/DKIM and a suitable DMARC policy.
4. Set exact site/callback URLs for local development and the deployed website. Avoid unrestricted wildcard production redirects.
5. Test successful delivery, incorrect/expired codes, resend limits, and session expiry with real mailboxes.

## Google login

1. Create an owner-controlled Google Cloud OAuth client and consent screen.
2. Add the Supabase Google callback URL shown by the project to the Google client configuration.
3. Configure the Google client ID/secret in Supabase, not in browser source.
4. Add the application's own auth callback to Supabase's redirect allowlist.
5. Request only basic identity scopes. Test login, cancellation, redirects, logout, and account-linking behavior.

Google login proves Google account access. It does not independently establish UTAR membership.

## What configuration enables

Once the environment files, provider settings and database migrations are configured and the services restarted:

- Email sign-in sends a Supabase login OTP and creates an authenticated session.
- Google sign-in redirects through Google and Supabase back to the application account.
- A signed-in account can separately request a UTAR verification code from the FastAPI service.
- Successfully confirming that account-bound UTAR code enables verified-member community access.

Supabase Auth's SMTP handles login messages. The backend SMTP settings handle the separate UTAR membership challenge. The same email provider can serve both, but configuring only one does not configure the other. Test actual delivery/callbacks before inviting students; the local member-browser suite uses simulated provider sessions.

## UTAR membership email

The application uses a separate signed-in, account-bound university verification workflow. An OTP sent to `@1utar.my` confirms mailbox control and grants the accurately named “UTAR email verified” membership.

Configure the backend SMTP sender and a strong independent OTP digest secret. University OTP delivery is synchronous with a timeout, so plaintext codes do not enter persistent job payloads. Monitor delivery failures and schedule `python -m app.cli work` as a single-pass maintenance task for cleanup. Do not route verification through a different-email login call that creates a second Supabase account.

Verify real UTAR delivery, expiry, one-time use, resend throttling, attempt limits, mailbox uniqueness, and account binding before accepting students.

## Production launch checklist

- HTTPS for frontend and API; explicitly allowed frontend origins and auth redirects.
- PostgreSQL, applied Alembic migrations, private schemas and limited runtime database privileges.
- No local-only development keys, test users, or auth overrides in production.
- Separate staging and production credentials/databases.
- Production email delivery and scheduled, monitored maintenance jobs.
- Administrator MFA, scoped moderator access and named report coverage.
- Independent database backups, a rehearsed restore, and a documented retention/deletion process.
- Monitoring, rate-limit storage, spending alerts and an incident contact.
- Current privacy/terms/operator contact information and reviewed data-transfer obligations.

Actual cloud login, SMTP delivery, hosted load, external vendor configuration, and public deployment cannot be declared verified until those services are configured and tested.
