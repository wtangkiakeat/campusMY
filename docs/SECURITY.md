# Backend hardening review — 17 November 2026

PR #3 contains the 4.3.1 client. The production database was upgraded on 17 November 2026 after explicit owner approval and a private application backup. The production website remains on `e5a3bf8` until an approved merge. Original Claude/Codex milestone commits are retained on local milestone branches; the published review files were compared with the tested source modulo line endings. The architecture remains static HTML/JavaScript plus the existing Supabase project.

## Threat model and findings

Protect private plans, emails, conversations, reports, account separation and optional sharing. Consider anonymous visitors, unconfirmed accounts, confirmed strangers, removed/blocked friends, removed room members, concurrent requests, hostile content, compromised clients and revoked staff. The operator/database owner remains privileged. Mailbox confirmation and a self-declared campus do **not** verify university enrolment.

| Priority | Reproduction / risk | Resolution |
| --- | --- | --- |
| High | Concurrent count-then-insert requests exceeded friend, review and active-group limits. | Transaction advisory locks, shared rate events and real separate-connection regression tests. |
| High | A retry key could return a prior send before current friendship/membership was checked; a key could be reused for different content. | Authorize first; serialize keys; bind them to sender, destination and body. Retry after removal, block, leave or room closure is refused. |
| High | Reapplying an old bootstrap could overwrite hardened function bodies while a signature-only audit still passed. | All three checked-in legacy bootstraps now fail closed after hardening. Historical copies predating the guard can still be run by a database owner and must not be reused. Tests compare complete function definitions and privileges. Reapply the versioned migration instead. |
| Medium | Timestamp-only DM pages skipped messages at equal timestamps; timestamp read markers could hide later commits. | Text-encoded bigint sequence cursor, matching index and monotonic sequence read watermark. Old clients can still call the defaulted signature. |
| Medium | Foreground views could retain shared data after per-friend/global revocation; unrelated polling failures skipped other refreshes. | Clear the visible shared snapshot when hidden; recheck on visibility, focus, pageshow and reconnect. Independent polling failure handling and stale-response guards. |
| Medium | Polling could supersede the initial authenticated route fetch, leaving a deep-linked chat empty after reload. | Reopen the requested accepted thread when the winning friends fetch completes; avoid redundant route renders. Reproduced live, fixed in 4.3.1, covered by two new startup/draft regressions and retested on hosted/local clients. |
| Medium | A timed-out send could duplicate on retry, and a completed response could erase a newer draft. | Per-intent request key; no automatic retry after uncertain errors; clear only the submitted draft. Legacy fallback is restricted to `PGRST202`, scoped per RPC and periodically retried. |
| Medium | Reports had no usable staff workflow; stale closed dialogs retained staff context. | SQL-appointed staff only, bounded report context, escaped text, hide/restore/dismiss, temporary posting decisions and reasoned audit entries. Clear staff content on close, identity change, backgrounding and role denial. |
| Medium | Simultaneous first invitation requests could hit a unique constraint. | Per-account invitation lock and a real concurrent regression. |

The permission audit checks the exact callable signature set, required grants, private helpers, empty search paths, RLS, table/sequence access and ID substitution. It does not treat client-side checks as authorization.

## Limits and moderation policy in this change

Limits are per confirmed account, enforced in SQL across connections: new/reopened friend requests 20/day; exact-ID lookup 60/10 min; invite resolution 30/10 min; invite rotation 20/day; reports 20/day; new reviews 20/day; active study groups 5 and creation 10/day; classmate listing updates 30/day; room joins 60/day; plan publication 120/hour. Existing room caps remain 3 new rooms/day, 30 joined rooms, 30 sends/minute and capacity including the organiser. Direct messages have 30 sends/minute. Social reads share a generous 300/minute budget, above normal polling from several tabs.

**Failed transactions roll back their rate events.** These counters bound successful operations, not all invalid traffic or unauthenticated requests. IP/gateway protection and Supabase Auth CAPTCHA/rate settings need an owner-reviewed operational setup. Multiple accounts can bypass a single-account budget. No claim of DDoS protection is made.

The moderation queue exposes reported room messages and reviews, not private friend DMs. Reporter IDs/emails and anonymous review author IDs are withheld. Staff cannot appoint staff through the browser. Reports do not automatically hide content or ban people. Decisions require reasons and are audited.

A staff posting pause lasts 1–30 days or can be ended manually. It blocks community room creation/joining/sending, review creation/editing, visible classmate listings and new/reopened study-group participation. It **does not lock the account**, erase content or disable private plans, accepted-friend DMs, sharing revocation, reporting, deleting one's review or leaving a room. The affected student sees the reason and expiry in My page. Staff access changes remain an owner SQL operation. Review these semantics before production approval.

## Migration and rollout

The existing production project successfully received both upgrades below after explicit owner approval. A protected application snapshot covered 20 tables / 1,024 rows plus function, policy and grant metadata; its downloaded copy is under ignored `.runtime/private-backups`. This is not a complete Auth/Storage backup. Metadata verification confirmed preserved source row counts, complete sequences, no obsolete overloads, no anonymous app RPC execution, private internal helpers, RLS on every app/backup table and no browser access to the backup schema.

The account, social and room bootstraps were already installed. **Do not rerun them or ask the owner to reapply the completed upgrades unnecessarily.** For a new installation or an expressly approved repeat application, the order is:

1. `supabase/20261117_security_hardening.sql`
2. `supabase/20261117_operational_metrics.sql`

Each file is transactional and reapplicable. Hardening backfills message sequences without deleting history, adds indexes, replaces functions and explicitly grants only documented RPCs. It creates an empty staff table; nobody becomes staff automatically. After live acceptance, the owner separately approved one confirmed operator account. Its live queue opens successfully, while the other test account has no staff tools. The optional metrics migration adds fixed-category hourly counters and an operator-only pruning helper. Both notify PostgREST to reload signatures. Apply during a quiet period because index creation/backfill can hold locks; this is not an online zero-downtime migration.

For a new empty project only, install the three bootstraps in account → social → rooms order before those two migrations. The test kit follows this sequence.

Appoint a moderator **only after separately approving the person and their access to reported content**. The operator can insert a confirmed account UUID into `public.campusmy_staff` in the SQL Editor; remove that row to revoke. Do not put privileged credentials, an appointment RPC or real account IDs into Git. The initial production appointment was made only after the owner named and approved the account. Future appointments require the same separate decision.

Client compatibility permits previewing against the old server. The stronger cursor/retry guarantees require the SQL migration. On an old backend a manually repeated timed-out send can still duplicate; the client never silently retries a network error. Missing staff/metrics APIs are handled gracefully.

Review PR first. Do not merge to `campusmy-website`, manually deploy, appoint additional staff or apply further production SQL without the owner's approval.

## Web and operational controls

`vercel.json` adds nosniff, frame denial, a strict-origin referrer policy and a permissions policy retaining same-origin camera access for optional QR scanning. CSP starts in **report-only** mode. Only self-hosted scripts, the exact Supabase HTTP/WebSocket host and Google Fonts are listed. Inline styles remain allowed for timetable positioning. Evaluate actual violations and QR/callback flows before enforcing CSP; report-only does not block XSS.

First-party diagnostics send only an hour-bucketed feature/category/app-version counter. They never send raw errors, stacks, URLs, IDs, emails, tokens, message bodies or timetable locations. No external analytics/moderation service is added. Counters are best-effort, sampled once per category/minute in the client and bounded at 30/account/10 minutes in SQL; users can fabricate these events. Staff see aggregates, not an audit-quality incident feed. Auth/platform monitoring and alert ownership are still operational responsibilities.

The owner can schedule `select public.cm_prune_operational_data();` from a trusted scheduler: it removes only rate events older than two days and counters older than 30 days. It is not executable by browser roles. No paid scheduler or billing change is made. Recent per-account/action rate events contain UUIDs; operational counters do not. Inactive accounts' old rate rows require this maintenance.

The checked-in Supabase browser bundle identifies itself as 2.119.0. Audits of its resolved package dependency graph and the test dependencies reported zero known advisories on 17 November 2026. This is not a proof that a vendored bundle is uncompromised. A pattern scan of 69 historical text blobs across local Git refs found no privileged Supabase JWTs, `sb_secret_` keys, AWS access-key IDs or private-key blocks. The publishable key in `config.js` is intentionally public. Pattern scanning cannot prove all secrets are absent.

Added indexes match DM sequence paging, course/term reviews and listings, friendship directions, blocks and report queues. A real PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` plan is saved only in ignored test output. Small synthetic timings do not establish production performance. Review Supabase query statistics as actual usage grows; avoid logging query parameters/content.

## Recovery and retention

The real-PostgreSQL suite creates a new password-protected loopback-only cluster under ignored `.runtime`, backs up synthetic application rows to JSON, restores all 26 application/auth-shim tables in a fresh database, repairs sequences and checks every row plus private-message access contracts. It shuts down only its own cluster and retains the test directory. This is an **application-schema/data restore drill**, not a full Supabase Auth, roles, extensions, Storage-object or PITR recovery test. No production data is exported by the tests.

For full project recovery, the owner should retain a supported Supabase export/backup, store it outside Git and confirm how to restore it into a separate project. Include required roles/schema/data, Auth dependencies and Storage objects separately. Free-plan projects must not assume managed daily backups. Test a full project restore before making a recovery-time promise. Never paste a database password or service-role key into chat.

If SQL execution fails before commit, its transaction rolls back; inspect the result and issue `ROLLBACK` if the editor retains an aborted transaction. Do not use an old bootstrap as rollback after successful hardening: it is deliberately blocked. Prefer a forward fix. The old 4.2 client remains compatible with the defaulted RPC signatures, so the UI can be reverted without removing sequences, data or access checks. Do not drop new columns/tables or restore over production without a separately approved recovery plan.

No message, review or account retention/cascade policy is changed. Existing messages persist after leaving/removing a friendship and may become visible again if it is accepted again. Account deletion can cascade owned content/rooms under the existing schema. Room ownership transfer, full account export/deletion UX, appeal handling and long-term moderation-log retention need owner decisions before a public launch. Health counters have the bounded retention above; messages are not silently purged.

## Verification and remaining gates

Run `npm ci --prefix tests --cache .runtime/npm-cache`, `npm test --prefix tests`, and `npm run test:concurrency --prefix tests` (the last starts an isolated PostgreSQL instance). Tests never accept a production database URL. Outputs remain under `.runtime`; they are not public artifacts.

Local acceptance passed 255 checks: 113 original database, 26 rooms, 11 permission audit, 12 hardening, 5 retry/compatibility, 77 browser-script and 11 separate-connection concurrency/recovery checks. The isolated DM query plan used campusmy_messages_thread_seq; its small-fixture execution time is not a production benchmark. Real-browser guest checks are distinct from the jsdom+PGlite signed-in tests. The validation record and final PR state specify exact totals and what was actually observed.

Live acceptance passed 16 scenarios using two owner-supplied confirmed accounts on separate origins (hosted preview and local 4.3.1). It covered read-only sharing, per-friend/global revocation of an open view, resuming publication, unread delivery, reverse replies, draft preservation, persisted-auth deep-link reloads, removal revocation, incoming-request acceptance and restoration of original sharing copies/settings. The live run found the startup issue above; both the hosted and local corrected clients passed the reload retest. Three clearly labelled private test messages remain between those test accounts. No public test reviews or rooms were created. The owner-approved staff queue opens; the other account has no staff entry. Positive hide/restore/posting-decision content tests remain isolated, as do bulk/race tests.

Twelve anonymous production probes, including defaulted legacy message signatures, were denied with HTTP 401 / SQLSTATE 42501. The protected Vercel preview displayed 4.3.1 and passed real-browser guest checks; a 390px local responsive frame and explicitly synthetic staff fixture were also inspected. The anonymous HTTP header probe was redirected to Vercel sign-in, so actual application response headers still need verification on the public production deployment. Configuration is reviewed; no header-enforcement claim is based on the login response.

**Remaining owner/operational decisions:** approve website merge/deployment, Auth SMTP/CAPTCHA setup, full-project recovery and retention/ownership policies. Password reset/email change and camera permission remain user-controlled browser handoffs; no email/password change was triggered for acceptance. No new enrolment boundary, Realtime subscription or end-to-end encryption is claimed.

Future universities should have a server-owned university membership table with verification status, evidence/provider, expiry and revocation, separate from user-editable profile labels. Every campus-scoped RPC must derive the authorized institution from that record. Verify official domains and course-data permissions with each institution; do not guess them.

References: [Supabase function security](https://supabase.com/docs/guides/database/functions), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [backup scope](https://supabase.com/docs/guides/platform/backups), [Vercel security headers](https://vercel.com/docs/cdn-security/security-headers).
