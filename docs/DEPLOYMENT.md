# Deployment and recovery

The application is prepared for separate Next.js and FastAPI services, with Supabase PostgreSQL/Auth. Nothing is publicly deployed or paid for by local setup.

## Before hosting

Complete `SETUP.md`, use separate production credentials, review all environment examples and run the test suites. Prepare a real operator contact, moderation coverage and provider budgets. Local SQLite, a successful build, and simulated test JWTs do not establish production readiness.

## Website

Deploy the repository's `apps/web` Next.js workspace on a Next.js-compatible host. Install from the repository root lockfile, build with `npm run build`, and configure the public API URL and Supabase URL/publishable key before building. Public environment values are compiled into browser assets.

The public API URL includes `/api/v1`. Configure the deployed website URL in both Supabase and Google callback settings. Test the exact deployed callback and logout behavior.

## API and worker

Build from the repository root:

```bash
docker build -f services/api/Dockerfile -t campusmy-api .
```

Provide environment variables through the host's secret manager. Use PostgreSQL and an application schema that is not exposed to Supabase's Data API. Run Alembic/initial seed as a one-off task with the migration role **before** starting application replicas. Use the limited runtime role for ordinary API and worker processes.

The image intentionally does not migrate automatically each time a replica starts. Use `python -m app.cli --help` for initialization, seed and maintenance commands. Schedule the single-pass `work` command periodically and monitor retries/failures; it is not an always-running worker loop.

Configure HTTPS at the host/proxy, exact CORS origins, health/readiness probes, request-size/time limits, pool limits and graceful shutdown. Do not blindly trust user-supplied forwarded IP headers. Rate-limit using the trusted network/client identity arrangement actually deployed.

The Docker configuration must be built on a Docker-capable host before release; local Python/npm tests do not validate the container runtime.

## Runtime database grants

Use distinct roles: a migration owner and an application runtime login with no superuser, role-creation, database-creation, or RLS-bypass privileges. After migrations, grant the runtime role `USAGE` on the application schema and only the necessary table/sequence operations. Configure owner default privileges deliberately for future migrations.

Revoke application-schema access from `PUBLIC` and Supabase browser roles. Keep the schema out of exposed Data API schemas. Validate these permissions with an actual browser public key and with the runtime database role. Connecting as `postgres` while testing a policy is not proof that the runtime role is safe.

With direct SQLAlchemy, enforce actor/membership/ownership in FastAPI. Additional RLS requires a deliberate transaction-scoped actor-context design and a non-bypass role; browser JWTs do not populate `auth.uid()` automatically.

## Release procedure

1. Back up the current database and record the application version and migration revision.
2. Run migrations/import against staging. Review identity/time/room/source diffs.
3. Run API, PostgreSQL, frontend and browser checks. Confirm no author identifiers in member DTOs.
4. Rehearse restoration and confirm deletion/retention behavior.
5. Apply reviewed migrations with the migration role. Deploy a compatible application version.
6. Check readiness, real OTP delivery, Google login, cross-account isolation, moderator MFA, report queue and worker health.
7. Roll back the application if necessary; prefer forward-compatible schema changes. Do not run destructive migration downgrades against production without a reviewed recovery plan.

## Backup and restoration

For the local SQLite development database, `scripts/backup_local.py` uses SQLite's online backup API, verifies integrity and creates a new owner-only file. It refuses to overwrite either the source or an existing destination:

```bash
python3 scripts/backup_local.py backup --source services/api/.runtime/campusmy.db --output /path/to/new-private-backup.db
python3 scripts/backup_local.py restore --source /path/to/new-private-backup.db --output /path/to/new-restored.db
```

Choose existing parent directories. These local files are not encrypted; protect them as private account data. Point an isolated development instance at the restored file to inspect it. This tool is not a PostgreSQL/Supabase backup mechanism. The automated rehearsal validates actual private application tables and deletion tombstones in the local backup.

Use the managed provider's database backups plus an appropriately encrypted independent backup. Restrict backup access, document retention and test restoration into an isolated database. If uploads are introduced, back up permitted Storage objects independently; database backups contain object metadata rather than the file contents.

The test suites check reproducible migrations/imports and database behavior. A hosted disaster-recovery rehearsal still needs the actual provider, privileges and backup path.

After a restore, reapply account/content deletion records and restrictions before reopening access. Check application identity mappings, source versions, votes/aggregates, private schedules and queued jobs. Do not send duplicate messages from restored jobs.

## Incidents and ongoing operation

Monitor API errors/latency, connection pool saturation, OTP failures, suspicious access, source/import failures, job backlog, spending and report response time. Keep OTPs, tokens, private author mappings and sensitive text out of logs.

For an incident: contain access, rotate affected credentials, revoke access where possible, preserve necessary evidence, assess impact, restore safely and communicate through a named owner. Assess applicable Malaysian notification duties using current guidance.

Plan data freshness checks around registration, dependency/security updates, moderator access review, retention cleanup and restore rehearsals. A growing community requires people to maintain course data and handle reports.
