# CampusMY API

FastAPI application APIs, SQLAlchemy persistence, Alembic migrations and Supabase JWT authentication. This service is the application data access boundary; the browser does not query private application tables directly.

## Local development

From the repository root, run the setup/dev commands documented in the root README. To work on the API directly:

```sh
cd services/api
cp .env.example .env
uv venv .venv
uv pip install --python .venv/bin/python -e '.[test]'
.venv/bin/python -m app.cli init
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`init` applies migrations and imports the checked-in `data/seed.json`. It can be repeated without duplicating source identities. SQLite is the development default; it is real persistent storage, not a mocked backend. Its database file is `.runtime/campusmy.db` relative to this directory. It is not the production concurrency/permission model.

Without provider settings, public course browsing and the guest frontend planner work. Authentication and university verification fail closed. No developer-login bypass or preverified student account is included.

Health endpoints:

- `/health/live`: process liveness.
- `/health/ready`: database/schema availability plus authentication/email configuration flags. A successful response is not proof of provider delivery or deployment readiness.
- `/docs`: generated development API documentation; disabled in production.

## Environment and secrets

All backend settings use the `CAMPUSMY_` prefix. See `.env.example`.

Important variables:

- `ENVIRONMENT`: development, test or production.
- `DATABASE_URL`: SQLAlchemy URL. PostgreSQL uses `postgresql+psycopg://...` with driver-compatible pooling settings.
- `DATABASE_SCHEMA`: dedicated non-exposed application schema, for example `campusmy`.
- `CORS_ORIGINS`: comma-separated explicit web origins.
- `SUPABASE_URL`: your project URL, used to derive the trusted issuer and JWKS endpoint.
- `JWT_ISSUER`: optional exact issuer override; otherwise `<SUPABASE_URL>/auth/v1`.
- `JWT_AUDIENCE`: normally `authenticated`.
- `OTP_SECRET`: at least 32 unpredictable secret bytes for HMAC digests. Generate securely and store in the deployment secret manager. Changing it invalidates pending challenges and requires a planned membership hash migration/reverification; do not rotate it blindly.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`: transactional email delivery configuration for university verification.
- `CREATE_TABLES`: test/development convenience only; keep false and use migrations.
- `AUTH_JWKS_JSON`: accepted only in the `test` environment for test-signed tokens; forbidden outside tests. Never configure it on the running development/production site.

Supabase's frontend public key is not the API database password. Google client secrets belong in the provider configuration, not browser environment files. Inline test signing keys are not a production integration.

Production configuration requires PostgreSQL, a dedicated non-public/non-provider schema, HTTPS origins/project URL, SMTP TLS, a strong OTP secret and `sslmode=verify-full` for database transport. Supply the required trusted CA configuration for the selected endpoint. A URL that passes validation still needs an actual connection/delivery check.

## Supabase Auth setup

1. Create an owner-controlled Supabase project and enable the desired email and Google login methods.
2. Configure exact website/callback URLs and production SMTP in Supabase for **login** messages.
3. Configure the API's university SMTP separately. The same provider may be used, but these are distinct application flows.
4. Use asymmetric project signing keys. FastAPI validates the access JWT signature, issuer, audience, subject and lifetime using the project's JWKS.
5. Browser login is managed by the supported Supabase SDK. Send its access token to FastAPI as `Authorization: Bearer <access token>`.
6. Configure the frontend's public Supabase URL/key and API origin. Keep API secrets out of `NEXT_PUBLIC_*` variables.
7. Test real email/Google callbacks, session refresh and university delivery before inviting students.

A personal Google login does not create UTAR membership. University challenges attach email-control evidence to the existing authenticated account; they do not call Supabase login OTP with a different address.

Supabase JWT signatures can be checked locally until the token expires. Application suspensions and deletion tombstones are checked from database state, so those application restrictions take effect without waiting for token expiry. Provider-wide signout/revocation and account deletion remain separate operator tasks described below.

## PostgreSQL roles and migrations

Migrations use an owner/admin connection. API requests use a separate runtime role with only application-schema/table privileges. Neither the browser nor routine requests should use the `postgres` administrator, provider secret API key or a database owner.

Keep the application schema out of Supabase Data API exposed schemas. Migrations revoke schema/table access from `PUBLIC` and from existing `anon`/`authenticated` roles. Verify project-specific grants independently, including future tables/default privileges and any enabled provider services.

The configured SQLAlchemy schema translation supports application queries. Additive Alembic operations that alter an existing table must also specify the configured schema explicitly; not all DDL honors query schema translation. Test every migration against a separate PostgreSQL database/schema before deployment.

The API enforces ownership and membership. A JWT is not automatically mapped into `auth.uid()` over a direct SQLAlchemy connection. Do not describe this runtime boundary as automatically protected by Supabase per-user RLS.

## Operator bootstrap and MFA

There are no hardcoded privileged accounts or HTTP endpoints for assigning your own role.

1. Sign in using the normal website to create your application account record.
2. Complete UTAR email verification using the normal account-bound flow.
3. Identify the intended operator's Supabase user UUID through an owner-authorized dashboard/session. Do not infer it from an anonymous review.
4. In a trusted operator terminal with database access, assign the role:

```sh
cd services/api
.venv/bin/python -m app.cli grant-role --user-id <operator-user-uuid> --role moderator
```

Use `admin` only when needed. Revoke elevated access using the same command with `--role member`.

5. Enroll and verify MFA through the supported Supabase user MFA flow. The session used for moderation must have `aal2`. The frontend/provider setup must support this; role assignment alone does not bypass MFA.
6. Refresh the authenticated session and request `/api/v1/admin/moderation-queue` with its current access token.
7. Confirm an ordinary member, an expired membership, an `aal1` operator, and a suspended account all receive access denial.

Operator role changes currently require trusted terminal access and should be recorded in your restricted operations log/change record. Content moderation decisions are stored in the database with acting moderator, reason and timestamp. This is a UTAR-first role scope; do not reuse the same unrestricted role model across additional universities without adding institution-scoped operator grants.

Moderators receive sanitized content/report/appeal details, not auth email, student timetable or author mappings. Report-based restrictions resolve the target author internally. Modifying privileged accounts through that route is denied.

## Jobs, deletion and provider lifecycle

Process pending application cleanup tasks with:

```sh
cd services/api
.venv/bin/python -m app.cli work
```

Each PostgreSQL worker locks one job per transaction using `FOR UPDATE SKIP LOCKED`. Maintenance operations are retry-safe. SQLite should use one maintenance worker; it does not implement PostgreSQL row-lock semantics.

A deletion request immediately:

- Sets an application account tombstone, so old JWTs cannot regain application access.
- Removes private plans, import receipts, verification state, notifications and votes.
- Removes the user's public text and queues revision-history cleanup.
- Retains only the documented audit/relationship records pending operator retention review.

The job removes retained text revisions and creates a `delete-supabase-user` task with status `needs_operator`. **The API does not claim that the Supabase Auth account or all provider sessions were deleted.** This implementation intentionally does not hold a Supabase admin secret on normal student request paths.

An authorized operator must complete the provider task:

1. Inspect queued `needs_operator` deletion jobs using restricted database/operator access. The payload user ID is private.
2. Confirm that it matches the application deletion request and applicable retention policy.
3. Delete/disable the corresponding account and revoke sessions through Supabase's authorized dashboard/admin workflow. If automating this later, use a dedicated server-only admin worker credential with retry handling; never send it to the browser.
4. Record the provider outcome and mark the job `done` only after successful completion. Keep failure details free of access tokens and private documents.
5. Keep the minimal application tombstone/deletion ledger needed to prevent restoration/reactivation. Reapply deletion after restoring an older backup.
6. Verify the deleted account cannot access CampusMY even using a previously issued application token.

Foreign-key relationships, reports, moderation notes and tombstones can retain limited identifiers. The operator must define lawful retention and minimization before public launch. Changing a job status to done is not evidence that backups have expired or third-party provider records were erased.

Account export returns the requester's content, revisions, reports, appeals, votes, block handles, notifications and private timetable data without other accounts' identity mappings. Exports above the synchronous record/8 MB limit fail explicitly with an operator-assisted export instruction; they are never silently truncated.

## Seed history and imports

Each unique checked-in seed version is retained as an `ImportRun.snapshot`, with its manifest and SHA-256 digest. Current academic rows are updated by stable IDs; prior public evidence remains in earlier snapshots. Reprocessing identical bytes is idempotent.

Review and validate regenerated data before running `seed` against production. The initial CLI importer does not fetch arbitrary live URLs or automatically approve remote timetable changes. Keep refresh review, conflict resolution and publication under operator control.

## Tests

From the repository root:

```sh
services/api/.venv/bin/python -m pytest tests/backend tests/security tests/data -q
npm run test:postgres
```

The PostgreSQL runner starts a disposable local server/database, runs ownership/concurrency/security/migration tests, then stops and removes it. It requires permission to bind a loopback socket on environments that restrict local servers. Never point destructive test fixtures at a real production database.

The test suite uses generated signing keys and fake email capture **only inside test fixtures**. No production route bypasses login to make tests pass. External Supabase/Google/email-provider integration is not verified until owner configuration exists.

Production operations still require owner configuration, real delivery checks, backup/restore rehearsal, actual privileged-user MFA setup, moderator staffing and a privacy/retention review. Passing local tests is not a claim that every possible input, network failure or provider condition has been proved safe.
