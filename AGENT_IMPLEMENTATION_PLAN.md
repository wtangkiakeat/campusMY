# CampusMY implementation plan

Status: local first-release implementation completed; final verification and external provider/public-launch setup are tracked in [implementation status](docs/IMPLEMENTATION_STATUS.md) and [verification results](docs/VERIFICATION.md). The sections below preserve the implementation brief and acceptance requirements.

Prepared: 14 November 2026.

This document is a self-contained handoff for an implementation agent. Build CampusMY into an independent UTAR student platform with a timetable planner, course reviews, exam tips, and a moderated student community.

## 1. Confirmed decisions

- Launch for **UTAR first**. Preserve institution boundaries so expansion is possible later.
- Use **Next.js + TypeScript** for the responsive website.
- Use **FastAPI** for application APIs and business rules.
- Use **SQLAlchemy** for database access and **Alembic** for migrations.
- Use **Supabase PostgreSQL** as the managed database.
- Use **Supabase Auth** for email login, Google login, sessions, and access/refresh tokens.
- FastAPI validates Supabase access JWTs. Do not introduce a second application token issuer by default.
- Keep university verification separate from login. A personal Google account may log in, but community access requires a verified UTAR email membership.
- First release: public course data and guest planner; verified-member reviews, exam tips, comments, and votes; private synchronized timetables; reporting, blocking, moderation, and appeals.
- Start with text content and links. Add attachments, marketplace, messaging, and broad campus boards in later phases.
- Academic meeting times use `Asia/Kuala_Lumpur`, regardless of the visitor's timezone. Store audit timestamps in UTC.

## 2. Instructions for the implementing agent

1. Read this file, the actual source files, and any applicable repository instructions before editing. Reinspect the repository: it may have changed since this plan was written.
2. Implement in dependency order. Finish each milestone's completion checks before expanding the feature set.
3. Preserve the working static planner while building the replacement. Do not remove original files or saved-plan compatibility prematurely.
4. Keep review, timetable, moderation, and membership rules in FastAPI. Next.js may manage rendering, auth callbacks, and HTTP forwarding, but must not maintain a competing implementation of those rules.
5. Use real shared persistence for shared features. Do not present localStorage comments, fake reviews, mocked authentication, or hardcoded roles as working production features.
6. Keep an implementation checklist and record actual commands, test results, decisions, and remaining setup in this document or a companion progress file.
7. Proceed with local implementation and reversible preparation. When external configuration is missing, finish independent work, document the exact setup needed, and request only the missing credentials or owner action. Do not create paid subscriptions or publish publicly without authorization.
8. Never commit credentials, tokens, private documents, production database dumps, or personal student information. Supply `.env.example` files containing placeholders only.
9. Validate package versions and provider APIs against current official documentation when implementation begins. The references below establish the design, not permanently pinned versions.
10. Test security boundaries and critical behavior. Do not mark a milestone complete because its interface renders.

## 3. Existing project and migration constraints

The repository currently contains a static application:

```text
index.html
styles.css
app.js
core.js
data.js
icon.svg
README.md
```

There is no existing FastAPI project, Next.js project, account system, or shared review database in this folder as of this plan.

Useful existing behavior:

- Faculty/campus/term filters and course search.
- Lecture/tutorial/practical group selection.
- Timetable alternatives and manual classes.
- Teaching-week-aware conflict detection in `core.js`.
- Local saving, JSON export, and JSON import in `app.js`.
- Official-source links and unknown-value handling.

Data inspection during planning found:

- 182 offerings, 832 sections, and 1,087 meetings.
- 7,748 curriculum observations, including 7,039 without course codes.
- 137 programmes and 66 room records.
- 13 explicitly registered source URLs, but 142 distinct source URLs across offering, catalogue, and room evidence.
- Ambiguous lecturer labels and course code/title conflicts; for example, `UJMZ32110` occurs with both PROJECT I and PROJECT II labels.

Recount and validate these facts during import. Curriculum observations are not automatically distinct courses. Do not create thousands of review pages from uncoded rows or merge subjects solely because names look similar.

The README mentions `dist/`, `prepare_data.py`, and `test-core.cjs`, which are not present in the current folder. Do not claim those scripts ran. Build or recover a repeatable import and meaningful regression checks.

The saved-plan localStorage key is `campusmy-timetable-v2`. Plans refer to existing offering/section IDs. Preserve those IDs through a versioned mapping to new database UUIDs.

## 4. Architecture and responsibility boundaries

```text
Browser / Next.js website
  ├── Supabase Auth: email login, Google login, session refresh
  └── HTTPS JSON requests carrying a Supabase access JWT
          ↓
       FastAPI
          ├── Validate JWT and application membership
          ├── Validate inputs and enforce ownership/roles
          ├── Reviews, tips, timetables, votes, reports, moderation
          ├── SQLAlchemy → Supabase PostgreSQL
          └── Jobs → transactional email / imports / cleanup
```

The browser must never connect to PostgreSQL using database credentials. The only public provider configuration is the intended public Supabase URL/key and public API origin. Database passwords, secret/service keys, SMTP credentials, Google client secrets, and OTP hashing keys stay on trusted servers.

### Suggested repository layout

```text
apps/
  web/                       # Next.js / TypeScript
    src/app/
    src/components/
    src/lib/api/
    src/lib/auth/
services/
  api/                       # FastAPI
    app/
      main.py
      config.py
      auth/
      db/
      models/
      schemas/
      routers/
      services/
      jobs/
    alembic/
    tests/
    pyproject.toml
data/
  source-snapshots/           # Reviewed public seed data only
  manifests/
scripts/
docs/
```

Adapt the layout if needed, and document the choice. One repository and one FastAPI application are enough initially. Organize backend modules by responsibility; do not start with microservices.

### Request flow and API client

- Next.js calls versioned `/api/v1/...` FastAPI endpoints using HTTP and JSON.
- Use an API client that handles response validation, authentication expiry, errors, cancellation, and pagination consistently.
- Use FastAPI's OpenAPI schema to generate TypeScript API types/client code when practical. Avoid maintaining incompatible Python and TypeScript DTOs manually.
- Default to direct browser-to-FastAPI calls with a bearer access token, using Supabase's supported Next.js/browser session integration.
- Server-rendered member requests may forward the verified session access token. Do not cache personalized responses across users.
- If a same-origin Next.js proxy is introduced, keep it thin and re-authorize at FastAPI. Document session/refresh behavior and CSRF protection for cookie-authenticated endpoints.
- Configure CORS for explicit local and production frontend origins. CORS is a browser policy, not authentication, and does not block non-browser API clients.
- Do not manually persist access/refresh tokens in ad hoc storage or put them in URLs. Follow the supported Supabase session flow and document cookie behavior. Do not claim browser-readable SDK cookies are HttpOnly.

## 5. Authentication, JWTs, and UTAR membership

### 5.1 One authentication provider

Supabase Auth owns email/passwordless login, Google sign-in, token issuance, and refresh. Start with email OTP login and Google login; email/password can be added if needed.

JWT is the access-token format. Google sign-in uses OAuth 2.0/OpenID Connect. These are complementary pieces, not alternative authentication architectures.

FastAPI accepts the **Supabase application access token**, not an arbitrary Google access token, Google ID token, or merely decoded JSON claims.

### 5.2 JWT validation in FastAPI

- Use a maintained verification library and configured Supabase signing keys/JWKS. Prefer an asymmetric signing-key setup for this design.
- Validate signature, allowed algorithms, expected issuer, expected audience, expiry, and required subject. Validate other time claims as applicable with bounded clock skew.
- Treat issuer/JWKS URLs as trusted configuration, never a token-supplied arbitrary URL.
- Cache keys with a defined refresh/rotation policy, including bounded retry for unknown key IDs. Do not fetch JWKS for every ordinary request.
- Derive actor identity from the validated subject. Do not accept client-supplied author IDs as authority.
- Check current membership, restrictions, and privileged roles using trusted database state. Define bounded caching only if necessary; suspensions must not wait for a long JWT lifetime.
- Document that local JWT signature verification alone does not immediately establish session revocation. Use stronger current-session checks for sensitive actions where required.
- Return consistent 401/403 responses without leaking tokens or private account data.

### 5.3 Google setup and account linking

- Configure the Google provider through Supabase, with owner-controlled OAuth credentials and exact callback/redirect configuration.
- Request only the identity scopes needed for login. Google Drive/Gmail access is not required.
- Use provider-supported account linking with reauthentication as appropriate. Do not merge accounts just because an untrusted email field matches.
- Keep the internal account ID stable across linked login methods.

### 5.4 University verification is a separate workflow

UTAR's official guide documents student addresses as `<email ID>@1utar.my`. A successful challenge earns the badge **UTAR email verified**. It does not prove current enrollment, campus, or course attendance.

Unlike an email-only restricted signup design, do **not** reject all non-UTAR account creation: Google users may use personal Gmail. Gate community privileges at membership verification instead.

Recommended membership verification flow:

1. Signed-in user submits a UTAR email.
2. Server parses and validates the exact allowed domain `1utar.my`; reject lookalikes and appended domains. Apply deliberate canonicalization, without inventing provider-specific dot/plus alias rules.
3. Server issues an account-bound, purpose-bound, short-lived verification challenge and sends an OTP through a transactional email provider.
4. Store a keyed digest of the OTP, expiry, resend state, attempt count, and challenge/account binding privately. Do not store or log plaintext codes. Numeric OTPs have low entropy, so a plain unsalted digest is not adequate protection against offline guessing.
5. Enforce per-account/email and IP request limits, resend cooldown, attempt limits, and atomic single-use consumption. Use a bot challenge where justified.
6. Successful confirmation updates the signed-in account's membership in a transaction. It must not create a second Supabase login account.
7. Enforce a private uniqueness rule for active UTAR email ownership and define a support/recovery path for conflicts. One mailbox should not verify multiple active accounts.
8. Store method, verified_at, expires_at, and status privately. A proposed renewal period is 12 months; renewal only reconfirms mailbox control.
9. Changing the university email requires a fresh challenge. Expired/revoked/suspended memberships lose community permissions server-side.

Supabase's ordinary `signInWithOtp` is a login flow. Do not call it with a different university email and assume it attaches evidence to an existing Google account. Use the dedicated account-bound membership workflow above or a documented supported identity-linking design that preserves that binding.

Do not collect student portal credentials, NRIC/passport numbers, transcripts, or student cards for the first release. No supported UTAR enrollment integration was established during planning. Seek an institutional integration if stronger evidence is needed later.

## 6. Database design and access policy

### 6.1 SQLAlchemy and connections

- Supabase PostgreSQL supports SQLAlchemy through a normal PostgreSQL connection string.
- Select a supported SQLAlchemy release and PostgreSQL driver together. Use one consistent sync or async request/session pattern.
- If using async database access, create a session per request/task; do not share a mutable session across concurrent tasks. Keep blocking work out of async request execution.
- Use bounded pools, transaction timeouts, rollback/cleanup, and encrypted connections with appropriate certificate verification.
- Choose direct, session-pooler, or transaction-pooler connectivity based on the actual deployment and network support. Validate driver/prepared-statement compatibility for that choice.
- Across deployments, budget connections as replicas × workers × per-worker pool capacity, including overflow and job workers.
- Use Alembic as the authoritative migration history for application tables, indexes, policies, and grants. Do not introduce a conflicting second migration history.
- Use separate migration/admin and runtime database roles. The runtime role must not own all tables or carry broad administrative privileges.

### 6.2 Critical direct-database security distinction

A browser JWT does **not** automatically become PostgreSQL request identity when FastAPI connects with SQLAlchemy. Policies using `auth.uid()` do not automatically inherit that JWT.

Launch baseline:

- Application and private authorship/membership tables live in non-exposed database schemas, with no browser `anon`/`authenticated` grants and no accidental Data API exposure.
- FastAPI is the application data access boundary. Enforce actor, membership, role, and ownership checks in centralized service/query functions.
- Runtime database grants cover only the required application operations. Keep migrations and privileged operator jobs separate.
- Keep managed `auth` records under Supabase's control; do not edit provider-managed authentication tables arbitrarily.
- Where tables are exposed through Supabase services, configure RLS and grants explicitly. Restrict Storage independently when added.
- Additional RLS for direct SQLAlchemy requests is useful only with a deliberate non-bypass role and safe, transaction-local verified identity context. Never leave user context on pooled connections. Define and test that design before relying on it.

Do not imply that enabling RLS alone protects SQLAlchemy requests made as a privileged owner. Do not use the Supabase service key or `postgres` administrator as the routine student request identity.

### 6.3 Academic tables

- `institutions`, `campuses`, `faculties`, `programmes`: UTAR organization and future institution boundaries.
- `courses`: stable institution-scoped identity, canonical code/title, identity status and version information.
- `course_aliases`: reviewed alternate codes/titles and historical mappings; do not merge unrelated courses by name.
- `terms`: institution/campus scope, label, year, verified dates and teaching-week calendar.
- `offerings`: course + campus + term with publication/source status; a catalogue row does not confirm a scheduled offering.
- `sections`: offering, lecture/tutorial/practical type, group label.
- `meetings`: section, weekday, start/end minutes, teaching weeks, room and delivery information.
- `lecturers`, `lecturer_aliases`, `teaching_assignments`: curated identities and many-to-many assignments; preserve unresolved raw lecturer text.
- `rooms`, `buildings`: campus-scoped identities and verified mappings.
- `curriculum_entries`: programme/version/year/term observation, raw course fields, optional resolved course ID and source.

### 6.4 Provenance and migration tables

- `source_documents`: original URL, kind and source identity.
- `source_versions`: content hash, fetch/check/publication metadata and retrieval outcome.
- `import_runs`: extractor version, staging/publish status and review decision.
- `source_observations`: raw record, page/location, validation notes and mapped entity.
- `legacy_id_mappings`: original dataset version and legacy ID to canonical UUID.

### 6.5 Account and community tables

- `profiles`: optional nickname and preferences; do not publicly join these to anonymous content.
- `memberships`, `university_verifications`, `verification_challenges`: private institution membership and email-control evidence.
- `account_roles`, `account_restrictions`: scoped privileged roles, suspensions and audit metadata.
- `review_contexts`: unique course + campus + term; optional matching offering; distinguish official evidence from self-reported historical context.
- `reviews`: context, overall/difficulty/workload scores, feedback/advice, teaching context, publication state and timestamps.
- `review_authors`: private owner and context binding; database uniqueness for one review per account/context.
- `exam_tips`, `tip_authors`: term/context, assessment type, experienced format, preparation advice, state and private ownership.
- `comments`, `comment_authors`: flat comments on reviews/tips, with private ownership and explicit typed target constraints.
- `content_revisions`: private version history and approval state.
- `helpful_votes`: private voter/target relation with uniqueness and no self-voting.
- `content_stats`: published-only aggregates without owner/voter lists.
- `reports`, `moderation_actions`, `appeals`: private reporter/decision/action records.
- `blocks`: private blocking relationships, resolved against content ownership internally.
- `notifications`: private recipient events without anonymous-author leakage.
- `plans`, `plan_entries`, `plan_entry_sections`, `manual_meetings`: private synchronized timetables.
- `outbox_jobs`, `admin_audit`, `deletion_jobs`: reliable job delivery, accountable operations and deletion workflow.

Related tables can be simplified when implementation starts, provided the privacy and integrity constraints remain explicit.

### 6.6 Required integrity constraints

- Foreign keys and same-institution/campus/context validation.
- Stable course identities with reviewed handling of reused codes and syllabus versions.
- One review per account/course/campus/term, enforced in the private ownership/context relation as well as the UI.
- A teaching assignment selected for a review must match its context. Do not attach an unrelated lecturer ID.
- Integer scores in 1–5 when supplied; optional unknown values remain null.
- Valid weekday, time range, teaching-week values and section/offering relationships.
- One helpful vote per member/target; atomic no-self-vote check.
- Explicit typed targets for comments, votes and reports; avoid unconstrained IDs pointing at arbitrary content.
- Publication states and controlled transitions; users cannot set their own approval/role/verification fields.
- Optimistic version checks on saved plans to avoid silent stale-device overwrites.
- Transactional creation of content plus private ownership; no orphaned anonymous posts.

## 7. First-release features and pages

### Public course browsing

- Search by course code/title and curated lecturer aliases.
- Campus, faculty and term filters.
- Clear distinction between curriculum catalogue and published class offerings.
- Source links, coverage, source-check dates and correction reporting.
- Leave unknown credits, eligibility and room mappings unknown.

### Course page

- Permanent course identity with current and historical offering context.
- Overview, sections and timetable addition.
- Verified-member reviews and exam tips, filtered by term and validated lecturer context.
- Published review counts, rating sample size and useful empty states.

### Planner

- Guest local planner and optional private account sync.
- Lecture/tutorial/practical choices, multiple plans and manual classes.
- Teaching-week-aware clashes, export/import and migration preview.
- Preserve local plans on network failure or failed account import.
- Sharing remains a later opt-in, revocable feature.

### Reviews, tips and comments

- Reviews: overall experience, difficulty, workload, assessment experience, teaching feedback and advice.
- Tips: term/year, assessment type, formats experienced and preparation advice.
- Flat comments, helpful votes, report and block actions.
- Draft/preview/submission status and management of own content.
- No fake starter reviews. Student course attendance remains self reported.

### Account and operator pages

- Login, Google callback, UTAR verification, membership expiry and account settings.
- Own timetable/content management, data export and deletion.
- Moderator queues, pending versions, reports, restrictions and appeals.
- Operator data-import diff, source failures, mapping conflicts and audit events.
- Guidelines, privacy, terms, support and independent-platform identification.

Suggested routes:

```text
/
/courses
/courses/[courseId]
/timetable
/login
/auth/callback
/verify-university
/account
/notifications
/admin
/guidelines
/privacy
/terms
/help
```

## 8. Suggested API contract

Define pagination, status/error shapes, request bounds and authorization in OpenAPI. Paths below are a starting contract, not pre-existing endpoints.

```text
GET    /health/live
GET    /health/ready

GET    /api/v1/courses
GET    /api/v1/courses/{course_id}
GET    /api/v1/courses/{course_id}/offerings
GET    /api/v1/terms

GET    /api/v1/me
POST   /api/v1/me/university-verification/challenges
POST   /api/v1/me/university-verification/confirm
GET    /api/v1/me/timetables
POST   /api/v1/me/timetables
PATCH  /api/v1/me/timetables/{plan_id}
DELETE /api/v1/me/timetables/{plan_id}
POST   /api/v1/me/timetables/import
POST   /api/v1/me/export
POST   /api/v1/me/deletion-request

GET    /api/v1/courses/{course_id}/reviews
POST   /api/v1/courses/{course_id}/reviews
PATCH  /api/v1/reviews/{review_id}
DELETE /api/v1/reviews/{review_id}
GET    /api/v1/courses/{course_id}/exam-tips
POST   /api/v1/courses/{course_id}/exam-tips
PATCH  /api/v1/exam-tips/{tip_id}
DELETE /api/v1/exam-tips/{tip_id}
GET    /api/v1/{content_type}/{content_id}/comments
POST   /api/v1/{content_type}/{content_id}/comments
PATCH  /api/v1/comments/{comment_id}
DELETE /api/v1/comments/{comment_id}
PUT    /api/v1/{content_type}/{content_id}/helpful
DELETE /api/v1/{content_type}/{content_id}/helpful
POST   /api/v1/reports
POST   /api/v1/blocks                  # Resolve a target content author internally
DELETE /api/v1/blocks/{block_id}       # An opaque block record, not an account ID
POST   /api/v1/appeals

GET    /api/v1/admin/moderation-queue
POST   /api/v1/admin/moderation-actions
GET    /api/v1/admin/imports
POST   /api/v1/admin/imports/{import_id}/publish
```

Allowlist `content_type`; do not turn it into an arbitrary table name. Make retried creates/imports idempotent where duplicate submission is a concern. Member-content reads require active membership even though course metadata is public.

## 9. Anonymous content, rating integrity and moderation

### Anonymity boundary

- Public/member content DTOs exclude account UUIDs, emails, verification evidence, student identifiers and global anonymous profile identifiers.
- Ownership stays in private tables. Do not serialize SQLAlchemy models directly as unrestricted API responses.
- Check rendered HTML, Next.js serialized props, errors, analytics, notifications, caches and any realtime events for leaks.
- Use thread-local labels where needed; avoid public posting histories that correlate anonymous reviews across courses.
- Explain that posts are anonymous to students, with restricted operator accountability. Do not promise anonymity from the service itself.
- Moderators should not receive unrestricted auth-email or private-timetable access. Sensitive identity lookup requires a distinct privileged workflow and recorded reason.
- Blocking must work through private owner resolution without returning the author's account identity.

### Review and aggregate rules

- One editable review per owner/context; multiple tips do not multiply ratings.
- Show sample size and term coverage. Proposed product policy: numerical averages appear after three published reviews, with small-sample labeling as appropriate.
- Treat difficulty and workload as descriptors, not automatic negative ratings.
- Do not label a mixed course score as a particular lecturer's score.
- Only published eligible reviews contribute to aggregates. Hidden/removed/deleted content must leave aggregates.
- Keep edit revisions and review state separate. Unapproved edits must not appear as already approved content.
- Reconcile aggregate caches with source records periodically.
- Flag repeated text, suspicious bursts and coordinated voting for review. Shared university IP addresses are not sufficient grounds for a ban.

### Moderation workflow

- Launch with first contributions pending review. Define when established accounts may publish automatically later.
- Provide reasons for spam, personal information, harassment, impersonation, incorrect context, unauthorized material and confidential exam content.
- Permit honest criticism of teaching. A negative opinion alone is not a removal reason.
- Do not automatically delete posts simply because many people report them.
- Allow preparation strategies and permitted resources; prohibit leaked/current confidential assessments and unauthorized uploads.
- Record approve/request-edit/hide/remove/restrict actions with reason, actor and timestamp.
- Notify authors appropriately and offer appeals. Keep reporter identity private.
- Name an operator/moderator who can triage reports daily during the invite beta, with urgent privacy issues prioritized.

## 10. Importing official data and local plans

### Source pipeline

1. Preserve a seed snapshot and manifest of the current data.
2. Parse `data.js` as a controlled data format; do not execute arbitrary imported JavaScript on the server.
3. Expand the source registry from all record references, preserving URLs, pages and raw evidence.
4. Import high-confidence institution/campus/term/course identities first.
5. Stage offerings, sections and meetings; validate references, weeks, times, duplicates and campus mappings.
6. Hold ambiguous names/codes/lecturers for human mapping. Preserve unmapped curriculum observations.
7. Review a publish diff and keep rollback/version information. Re-import of the same source version must be idempotent.
8. Preserve historical reviews and plan references through cancelled/changed offerings.
9. Build scheduled refreshes with source allowlists, bounded fetches, unsafe/internal-URL rejection, parse limits and failure alerts.
10. Show data freshness and coverage honestly; do not claim live seats, registration eligibility or complete UTAR coverage without a supported source.

### Existing saved plans

- Detect `campusmy-timetable-v2` after login and offer a previewed migration.
- Map legacy offering/section IDs to canonical UUIDs.
- Offer merge/keep-separate behavior; never automatically replace all account plans.
- Preserve manual classes and mark unresolved old entries for repair.
- Keep the original local/export copy until account persistence succeeds.
- Use idempotency and optimistic concurrency to prevent duplicate imports and stale overwrites.
- Notify affected users of official time/room changes and let them review choices rather than silently rewriting plans.

## 11. Security, privacy and reliability requirements

- Enforce authentication, active membership, roles, ownership and object/context relationships on every protected operation.
- Validate inputs, bound request sizes, parameterize queries, limit pagination and allowlist link protocols.
- Render student content as text. Do not insert comments into the existing app's `innerHTML` templates without safe handling.
- Use HTTPS, explicit allowed origins/redirects, appropriate session settings, CSP/security headers and CSRF protection where cookie-authenticated writes exist.
- Apply durable per-account/email/IP rate limits to OTP, publishing, comments, votes, reports and expensive queries. Supabase Auth limits do not protect custom FastAPI endpoints.
- Do not use in-process counters as the only rate limit after deploying multiple workers/instances.
- Require MFA and scoped roles for privileged operators. Audit sensitive actions and identity access.
- Keep secrets server-side; separate development, staging, preview and production databases/configuration. Preview deployments must not mutate production.
- Configure production email delivery and domain authentication. Monitor OTP delivery, failures, bounces and provider quotas.
- Use an outbox/queue for reliable imports, notifications, cleanup and aggregate reconciliation. Make jobs retry-safe.
- Avoid caching member content or tokens in public caches, social previews or PWA service workers. Cache public catalogue data separately.
- Define data export, deletion and retention policies before public launch. Avoid collecting unnecessary identity documents.
- Document applicable Malaysian privacy duties and vendor/cross-border processing before launch; choosing Singapore hosting alone does not establish compliance.
- Configure encrypted backups and rehearse restoration. Database backups do not contain Storage file objects; add separate permitted-object backups when uploads are introduced.
- Define backup expiry and a deletion ledger/workflow so a restore does not silently resurrect deleted accounts/content.
- Add health checks, error/uptime monitoring, job/import alerts, spending alerts and an incident owner. Keep sensitive content, OTPs and anonymous author mappings out of logs.

If uploads are added later, require private quarantine, generated names, content/type/size validation, malware checks, metadata handling, authorized expiring downloads, quotas and takedown handling before enabling them.

## 12. Implementation milestones and completion checks

All items below are unimplemented unless a future agent records evidence otherwise.

### Milestone 1 — Foundation and data audit

- [ ] Establish repository layout, reproducible dependencies, lint/type-check commands and `.env.example` files.
- [ ] Preserve the original planner and inventory its behavior.
- [ ] Define API DTOs, database identities, privacy boundaries and initial migration strategy.
- [ ] Recount seed data, list conflicting identities and produce an import manifest.
- [ ] Document the local development commands and required external configuration.

Completion: frontend/API start locally; health endpoints work; migration/import design is concrete; original planner remains available.

### Milestone 2 — Auth and private database foundation

- [ ] Integrate Supabase email and Google login using supported session handling.
- [ ] Implement FastAPI JWT verification and trusted role/membership checks.
- [ ] Create SQLAlchemy models, Alembic migrations and limited runtime database access.
- [ ] Implement account-bound UTAR email verification with delivery, expiry and abuse controls.
- [ ] Verify actual delivery to a UTAR mailbox when owner credentials/test access are available.
- [ ] Test cross-account access denial, invalid/expired tokens and restricted membership.

Completion: an account can sign in, verify UTAR email and access a protected API; another account cannot access its private data. Google login alone does not grant UTAR community privileges.

### Milestone 3 — Course data and private planner

- [ ] Import reviewed course/offering/section/meeting data with provenance and legacy-ID mappings.
- [ ] Build course browse/detail pages and port existing planner behavior.
- [ ] Add private timetable CRUD, optimistic concurrency and local-plan migration.
- [ ] Preserve unknown values and teaching-week-aware conflict logic.
- [ ] Test repeated imports, changed sources, manual classes and unresolved local entries.

Completion: a student finds a real course, builds a timetable and retrieves it on a second device; another user cannot read or mutate it.

### Milestone 4 — Complete review and moderation loop

- [ ] Add structured anonymous reviews, text exam tips and flat comments.
- [ ] Enforce private ownership and one-review-per-context constraints.
- [ ] Add helpful votes and published-only aggregates.
- [ ] Add pending/publication/edit-version states, reports, blocks and appeals.
- [ ] Add scoped moderator UI, reasoned decisions and audit events.
- [ ] Inspect actual responses and rendered payloads for author identity leakage.

Completion: student A submits a review; a moderator approves it; student B reads/comments/votes/reports; a moderator hides it; feeds and aggregates reflect the change without exposing A's account identity.

### Milestone 5 — Production readiness

- [ ] Complete the security and regression tests in section 13.
- [ ] Verify mobile layouts, keyboard accessibility, session-expiry behavior and slow/failing network handling.
- [ ] Configure production delivery, secrets, monitoring, durable limits and background jobs.
- [ ] Implement export/deletion/retention behavior and run a restore rehearsal.
- [ ] Publish accurate guidelines/privacy/terms/help content and document actual moderator coverage.
- [ ] Prepare deploy/rollback instructions and record unresolved owner actions before launch.

Completion: critical privacy/ownership tests pass, restoration is demonstrated, operational responsibilities exist and missing external setup is explicit.

### Milestone 6 — Invite beta and measured expansion

- [ ] Invite a manageable set of real UTAR students; 30–50 is a proposed beta target, not an existing audience.
- [ ] Collect genuine reviews across a small set of courses; fix verification and data-quality problems.
- [ ] Measure returning use, review usefulness, report workload, data freshness and infrastructure cost.
- [ ] Expand UTAR coverage before adding other institutions.
- [ ] Add Q&A/boards/resources only when moderation and maintenance capacity support them.

Planning estimate: roughly 10–14 weeks to a controlled beta for an experienced developer working consistently, subject to scope and setup. This is not a deadline or fixed quote. Part-time beginner work should be planned in months.

## 13. Required verification evidence

Use meaningful automated tests plus manual browser checks where needed. Never report tests as passed unless actually run.

### Identity and permission tests

- Invalid signature/issuer/audience/expiry/algorithm rejected; key rotation behavior covered.
- Unverified, expired and suspended memberships cannot bypass protected actions through direct API calls.
- User A cannot read/edit/delete user B's timetable, drafts, private account details or author mappings.
- Forged owner, role, verification and moderation-status fields rejected.
- Ordinary browser Supabase credentials cannot read/write private application schemas.
- Concurrent membership challenges cannot verify one mailbox into multiple active accounts.
- Membership OTPs are account-bound, single-use, expiring, attempt-limited and absent from logs.
- Google identity does not silently become enrollment verification or a duplicate UTAR login account.

### Content and anonymity tests

- API responses, SSR HTML/serialized props, notifications and errors contain no private author IDs/emails.
- No global anonymous identifier exposes cross-course posting history.
- Blocking applies consistently without revealing target account IDs.
- Concurrent duplicate review submissions produce one review.
- Duplicate/self votes rejected; removal and retries do not corrupt counts.
- Hidden/removed/deleted reviews leave aggregates and feeds.
- Pending edit content never leaks as an approved version.
- Reports and reporter identities remain private; moderator scope/MFA checks enforced.
- Script/HTML payloads render safely as text; link protocols validated.

### Academic data and planner tests

- Stable IDs across imports; no duplication from repeated source versions.
- Unknown credits/years/rooms remain unknown.
- Meetings, weeks and section/offering/context relationships validated.
- Existing week-aware conflict behavior preserved, including multi-meeting courses.
- Local migration retains manual/unmapped entries and survives retries/network failures.
- Stale device writes produce an explicit conflict rather than silently overwriting plans.

### Operational checks

- Actual UTAR email delivery and failure handling checked when configured.
- Rate limits work across multiple workers; shared campus IP does not trigger indiscriminate bans.
- Background jobs retry without duplicate content/email effects.
- Restore into staging demonstrated; deletion handling reapplied after restore.
- Export/deletion authenticated, bounded and private.
- Member content does not leak through caching, public indexing or previews.
- Mobile/keyboard behavior, validation errors and session expiry checked in a real browser.

## 14. Deployment, scale and operating budget

- Host Next.js on a suitable web platform and FastAPI on a service supporting a persistent Python process/container. Select the FastAPI host when deployment requirements and budget are known.
- Keep database and API processing near Malaysian users where practical; Singapore is an available Supabase region. Assess and document cross-border processing.
- Start with one API service and PostgreSQL. Add API replicas after measuring bottlenecks; do not promise scalability solely because FastAPI is used.
- Index common lookups, paginate lists and keep transactions short. Start with PostgreSQL search and test mixed English/Malay/Chinese text behavior.
- Move expensive imports/email/cleanup into workers. Add shared cache/rate-limit infrastructure when the deployment requires it.
- Budget total connections across replicas/workers, keep secrets out of the browser and use least-privilege runtime access.
- Track latency, query cost, pool saturation, database/storage size, egress, email volume, moderation backlog and backup health.

Pricing checked during planning: Supabase Pro starts at USD 25/month and Vercel Pro at USD 20/month, subject to plan terms and additional usage. Vercel Hobby restricts commercial use. **FastAPI hosting is an additional line item** beyond those two services.

Recalculate the earlier USD 60–100/month infrastructure allowance after choosing the API host, email volume, staging arrangement and backup requirements. It is a provisional allowance, not a quote, and excludes development, moderation, taxes and substantial growth. Do not assume paid service setup is already authorized.

## 15. Definition of done for the first release

The first release is complete only when:

1. A real user signs in, verifies a UTAR mailbox and receives accurately labeled membership.
2. Course data is sourced, stable and honest about missing coverage.
3. Private plans sync across devices while preserving existing local plans.
4. Genuine shared reviews/tips/comments work across accounts with no private-author leakage.
5. Database/API constraints prevent duplicate reviews, unauthorized access and forged state changes.
6. Reporting, blocking, moderation, restrictions and appeals work with assigned operators.
7. Email delivery, backups/restore, monitoring, rate limits and account lifecycle behavior are demonstrated.
8. Local setup, migration, deployment, rollback, external setup and remaining limitations are documented.

## 16. Deferred features

- Course Q&A and followed-course notifications beyond essential first-release events.
- General campus/faculty boards and student-created boards.
- Group chat and direct messaging.
- Resource/past-paper uploads and download libraries.
- Marketplace, food/transport/service information, clubs and events.
- Public or share-link timetables.
- Strong enrollment/course-attendance verification through a university agreement.
- Native mobile apps and additional universities.

Design extension points without implementing these ahead of the complete academic/community loop.

## 17. Primary references

Recheck these when implementing, particularly SDK behavior, pooling compatibility and pricing.

- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [FastAPI JWT/security concepts](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — useful concepts; this design uses Supabase as the issuer rather than copying its custom password-token example.
- [Supabase SQLAlchemy guide](https://supabase.com/kb/troubleshooting/using-sqlalchemy-with-supabase-FUqebT)
- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase connection pooling](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [SQLAlchemy documentation](https://docs.sqlalchemy.org/)
- [Alembic documentation](https://alembic.sqlalchemy.org/)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts)
- [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Supabase Next.js server-side auth setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase production SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [UTAR official email guide](https://www2.utar.edu.my/admStatus/doc/Guidelines_UTAR_Email_Account_Microsoft_Teams.pdf)
- [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Supabase backup limitations](https://supabase.com/docs/guides/platform/backups)
- [Malaysia Commissioner: cross-border transfers](https://www.pdp.gov.my/en/akta/personal-data-protection-guidelines-on-cross-border-transfer-of-personal-data-cbpdt/)
- [Malaysia Commissioner: breach notification guidance](https://www.pdp.gov.my/en/akta/personal-data-protection-guidelines-on-data-breach-notification-dbn/)
- [Supabase pricing](https://supabase.com/pricing)
- [Vercel pricing](https://vercel.com/pricing)
- [Vercel Hobby terms](https://vercel.com/docs/plans/hobby)

## 18. Prompt to start a future agent session

```text
Read AGENT_IMPLEMENTATION_PLAN.md and applicable repository instructions.
Implement CampusMY using the confirmed Next.js + FastAPI + SQLAlchemy +
Alembic + Supabase PostgreSQL/Auth architecture. Begin with Milestone 1
and proceed in dependency order. Preserve the current planner and existing
saved plans. Keep application rules in FastAPI and university verification
separate from Google/email login. Run and record meaningful checks for each
completed milestone. Use real persistence for shared features. Prepare
external setup concretely and document missing owner configuration; never
commit secrets, create paid subscriptions, or publish publicly without
authorization. Keep an honest progress record and report remaining work.
```
