# CampusMY

An independent UTAR timetable and student community application.

**Next.js / TypeScript → FastAPI → SQLAlchemy → PostgreSQL**, with Supabase Auth for email/Google login. SQLite provides real persistent storage for local development without cloud credentials.

## Run it

On this Mac, Node.js, Python and uv are installed. Double-click **Start CampusMY.command** in Finder to start both services in Terminal.

Alternatively, run from this folder:

```bash
bash scripts/setup.sh
npm run dev
```

Open **http://localhost:3000**. The API documentation is **http://localhost:8000/docs**. Stop both services with Ctrl+C.

After the first setup, use just `npm run dev`. This replaces the previous double-click-HTML version; opening an HTML file is no longer the startup method.

Requirements on another machine: Node.js 22.18+, Python 3.12+, npm and uv. The provided shell/venv commands target macOS and Linux (or WSL).

## What works

- Real course search, campus/faculty/trimester filters, catalogue pages and official sources.
- Weekly timetable with lecture/tutorial/practical choices, manual events, teaching-week clashes, multiple plans and JSON backup/import.
- Guest timetables, account-scoped local plans, private online sync, optimistic concurrency and earlier-version plan migration.
- Supabase email/Google login integration and separate account-bound UTAR mailbox verification.
- Anonymous reviews, exam tips, flat comments, helpful votes, reporting, blocking and appeals.
- Moderator queues, version-checked decisions, restrictions, notifications and operator MFA flow.
- Private account export, deletion tombstones, cleanup jobs and explicit provider-deletion follow-up.
- Versioned source imports, deterministic IDs, provenance and retained public seed snapshots.
- Responsive screens, accessible dialogs, safe content rendering and security headers.

There are no fabricated student reviews or production login bypasses. Without configured providers, course browsing and the guest planner are usable; account/community screens explain that authentication setup is pending.

## Connect real accounts and email

Copy `apps/web/.env.example` to `apps/web/.env.local` and `services/api/.env.example` to `services/api/.env`. Fill them locally; never commit secrets.

Follow [provider setup](docs/SETUP.md) for Supabase, Google callbacks, SMTP and the application database. [API operations](services/api/README.md) covers role bootstrap, MFA, workers, database grants and provider account deletion. [Deployment](docs/DEPLOYMENT.md) covers hosting, migrations and recovery.

Google login does not prove UTAR membership. The separate `@1utar.my` code proves mailbox control and is labeled **UTAR email verified**, not independently verified enrollment or course attendance.

Real Supabase/Google callbacks, UTAR mail delivery, production database credentials and public deployment still require owner setup. The automated member-browser tests simulate the identity provider while exercising the real application API and database.

## Tests

All test cases live under `tests/`, separately from application source.

```bash
npm run check:all
```

Stop existing local servers first: the isolated full check needs ports 3000/8000 and 3001/8001. It runs API/data/security/backup tests, planner tests, TypeScript, production build, real PostgreSQL checks, production-browser flows and member-browser flows. It uses disposable databases and stops its servers afterward.

Individual commands:

```bash
npm run test:api
npm run test:frontend
npm run typecheck
npm run build
npm run test:postgres
npm run test:members
```

Public browser checks use `npm run test:browser` with the API and website already running. See [test instructions](tests/README.md), [member-browser instructions](tests/member-browser/README.md) and [verification results](docs/VERIFICATION.md).

Browser checks use installed Chrome on this Mac. On other hosts install Playwright Chromium (`npx playwright install chromium`) and set `PLAYWRIGHT_CHANNEL=chromium` where needed. CI configuration is supplied but must run on the connected repository before its status can be claimed.

## Source data

The current seed has **689 campus-scoped course identities, 182 term offerings, 832 sections and 1,087 meetings**. Curriculum observations are preserved separately, including uncoded records and an identity conflict requiring operator review. These are not counts of distinct scheduled classes.

Timetable snapshots cover selected Kampar sources for February, June and October 2026. Catalogue coverage is broader. Availability, eligibility, later changes and live registration are not established by this collection. Unknown credits and other unsupported fields remain unknown.

The old root HTML/JS/CSS files have been removed. Original reviewed data survives in `data/source-snapshots/`; `python3 scripts/import_seed.py` regenerates the canonical seed from that snapshot. See [data documentation](data/README.md).

## Project layout

```text
apps/web/             Next.js website
services/api/         FastAPI, SQLAlchemy, Alembic and operator CLI
data/                 Canonical seed, original snapshot and manifests
scripts/              Setup, development, imports, checks and local backup tools
tests/                Independent unit, integration, security and browser cases
docs/                 Setup, deployment, verification and remaining launch work
```

[Implementation plan](AGENT_IMPLEMENTATION_PLAN.md) records the design and phased scope. [Implementation status](docs/IMPLEMENTATION_STATUS.md) distinguishes local implementation from provider setup and public-launch work.
