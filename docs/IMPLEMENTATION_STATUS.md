# Implementation status

Updated 14 November 2026.

## Implemented locally

- Next.js/TypeScript responsive website and separate FastAPI API.
- SQLAlchemy models, Alembic migrations, PostgreSQL-compatible private application schema and persistent local SQLite.
- Reviewed data importer, stable IDs, source provenance, versioned snapshots and legacy mappings.
- Course catalogue/details, weekly planner, class selections, teaching-week clashes and private plan synchronization.
- Account-scoped browser plans, active-plan persistence and previewed import/export/migration.
- Supabase email/Google authentication integration, JWT validation/rotation and separate UTAR email challenges.
- Anonymous shared reviews/tips/comments, helpful votes, reports, blocks, appeals and moderation.
- MFA operator UI and API enforcement, version-checked moderation, restrictions and notification/account pages.
- Safe account exports, deletion tombstones and retryable cleanup with explicit provider follow-up.
- Durable rate limits, security headers, input validation, body limits and private response models.
- Separate data/API/security/planner/backup/PostgreSQL/browser test suites, production build and check-all runner.
- Local backup/restore tool, deployment Dockerfile and CI configuration.

## Tests and evidence

See [verification results](VERIFICATION.md) for exact final counts and limitations. Locally signed test sessions exercise the actual application/database; they are not proof that Google or Supabase has been configured.

The initial editorial design was replaced at the user's request with the **classic Everytime PC website structure**: white/red horizontal navigation, a narrow contextual account panel, square bordered content panels, compact sans typography and pastel class blocks. Authentic public desktop screenshots from February 2020 were viewed as references; current authenticated Everytime access was not obtained. Details and source links are in `apps/web/design-notes.md`. The previous random direction is preserved only as design history. Metadata and compact timetable axes intentionally use smaller readable type than form/body text.

## Owner setup before real students

- Create/configure Supabase, Google OAuth and production SMTP; fill local environment files and test real callback/refresh/delivery paths.
- Configure PostgreSQL migration and limited runtime roles, private schemas, TLS trust and actual provider permissions.
- Bootstrap intended moderators, complete real UTAR verification and MFA, and assign report/appeal coverage.
- Provide actual operator/contact details and approve privacy, terms, retention/deletion and vendor/cross-border policies.
- Configure hosting/HTTPS, independent production backups, a provider-specific restore rehearsal, monitoring and spending alerts.
- Complete provider-account deletion tasks marked `needs_operator`; application tombstones already deny access immediately.
- Build/test the Docker image on a Docker-capable host and run supplied CI on a connected repository. Neither has been executed merely by writing its configuration.
- Invite real UTAR beta students and collect genuine reviews. No real student reviews are seeded.

No paid service, cloud database, live hosting deployment, university SSO agreement or external credentials were created during implementation.

## Deliberately later phases

General campus boards, course Q&A beyond review comments, attachments/past-paper libraries, direct/group messaging, marketplace, campus services, public timetable sharing, native apps and other universities remain later product phases described by the original plan.

The current source pipeline handles reviewed offline snapshots and preserved version history. Automatic live timetable scraping and arbitrary remote-source publication are not enabled. Course/lecturer identity conflicts require operator review.

## Verification boundaries

No finite test suite proves every possible input or provider/network condition. The suites focus on the identified boundaries: ownership, anonymous identity leakage, malformed imports, concurrency, membership/roles/MFA, token validation, content state, recovery and real browser flows. External delivery, vendor configuration, real-world hosted load and human operations remain separate acceptance checks.
