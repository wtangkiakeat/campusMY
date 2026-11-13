# Verification record

Prepared 14 November 2026. Final consolidated checks are run with `npm run check:all`.

## Environment and scope

- Local macOS, Node.js 26.4.0 and Python 3.12.
- Real local PostgreSQL 17.11 in a disposable cluster.
- Installed Google Chrome at desktop and phone viewports.
- Actual Next.js, FastAPI and SQLAlchemy application behavior.
- Identity-provider sessions simulated only in isolated member-browser tests, using ephemeral signed tokens and disposable data.

No external Supabase, Google OAuth, SMTP delivery, public hosting, Docker runtime or hosted CI verification is implied by these local checks.

## Automated results

- API/data/security/local-backup suite: **125 passed, 2 PostgreSQL-only cases skipped**, plus 45 passing dataset subtests.
- Actual PostgreSQL API/security/migration suite: **96 passed**, including the cases that require PostgreSQL locks/DDL.
- Pure frontend planner suite: **8 passed**, including generated time/week overlap boundaries.
- TypeScript: passed.
- Production build: passed, generating all 15 application routes.
- Production public browser flows: **18 passed** across desktop and phone after the Everytime-style revision, including navigation and account/detail overflow checks.
- Member browser flows with simulated provider sessions: **4 desktop and 4 phone scenarios**, checked in the consolidated run.
- Documented `bash scripts/setup.sh`: passed end to end using the dependency lockfiles and preserved source snapshot after old root assets were removed.
- `npm run dev`: both services reached readiness; stopping it released both process groups and ports cleanly.
- Frontend design inspector: **0 failures** at desktop/tablet/phone widths after honoring the explicitly requested Everytime red palette. Metadata/compact-axis density and independently sized sidebar/feed columns are intentional reference-layout choices explained in the design notes.

The PostgreSQL suite overlaps API/security cases from SQLite; these figures must not be summed into a claimed unique-test total. The provider simulation is test-only and does not add production login bypasses.

The installed FastAPI/Starlette test client emits a non-failing deprecation notice about its current httpx adapter. Test execution succeeds; no warning suppression or relaxed assertions were used to pass the suites.

## Defects found and corrected during verification

- Malformed local imports could dereference a null timetable entry.
- Active timetable selection was not restored after adding a course in another term and reloading.
- Cloud plan responses needed authoritative meeting/name hydration for the frontend.
- Saved local cloud plans needed account-specific browser storage to prevent account-switch leakage.
- Stale moderation decisions could approve content edited after the moderator loaded it.
- Parallel OTP issuance and cleanup workers required PostgreSQL row/transaction locking.
- Block success responses exposed a reusable handle that could correlate anonymous contributions.
- Pagination needed SQL-level visibility/block filtering before loading rows.
- Additive Alembic operations needed an explicit application schema on PostgreSQL.
- Account exports needed explicit completeness limits rather than silent truncation.
- Source refreshes needed retained snapshots rather than overwriting all prior raw evidence.
- JWKS rotation needed an expiring keyset cache and bounded unknown-key refresh.
- Small-screen text needed increased sizes and contrast.
- Whitespace-only manual event names and malformed week/manual fields needed stricter frontend validation.

## Recovery evidence and limits

The local backup test copies actual application tables with SQLite's online backup API, removes the original file, restores to a new private file, and verifies timetable ownership, membership, private review authorship, content and deletion tombstones. Invalid/corrupt inputs and overwrite attempts are rejected.

PostgreSQL migrations, older-to-newer upgrades, data imports and least-privilege smoke checks are exercised on an isolated real server. A hosted Supabase backup restore and project-specific browser-key grants still require the real provider setup.

## Manual visual review

The user requested a classic Everytime PC website layout in place of the initial editorial design. Authentic historical desktop screenshots from [February 2020](https://promation.tistory.com/97) were viewed and compared. The current official website returned an abnormal-access block; no authenticated access or bypass was attempted.

The revision uses a white horizontal school header, red active navigation underline, square bordered panels, compact sans typography, contextual account rail and pastel timetable blocks. Local `.taste-skill/` files record the previous direction and explicit reference override; these generated design artifacts are excluded from Git. The committed `apps/web/design-notes.md` preserves the reference rationale. The generic color check's `palette-terracotta` rule is allowed specifically because `#c62917` is the user-requested reference accent.

`npm run check:ui` passed after this change: **8 planner tests, TypeScript, production build, 18 public browser checks, 4 desktop member scenarios and 4 phone member scenarios**. The backend was unchanged; its previously recorded suites were not repeated for CSS changes. Actual-course timetable previews were captured in an isolated guest browser. No student reviews or posts were invented for screenshots.

The design skill was applied and real desktop/tablet/phone screenshots were inspected. Source lint has no failures; clock zero-padding warnings are intentional. Metadata and compact timetable axes remain intentionally smaller than primary text. Contextual sidebar panels and the course feed are independent columns, so their bottoms are not artificially aligned. Screenshots and reports are local artifacts under `.taste-skill/inspect/`, `.runtime/previews/` and `test-results/`.

No finite suite establishes that every possible edge case is handled. The evidence covers the named cases and environments above.
