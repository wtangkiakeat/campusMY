# CampusMY isolated checks

From the repository root:

    npm ci --prefix tests
    npm test --prefix tests
    npm run test:concurrency --prefix tests

Installation downloads development packages. Test execution uses only synthetic identities and local databases, never the live Supabase project. No production URL/password is accepted by the test kit.

- `db.test.mjs`: original owner RLS, private saves, social and group behavior.
- `rooms.test.mjs`: membership, capacity, room privacy and original room behavior.
- `audit.test.mjs`: exact RPC/table/sequence grants, empty search paths, RLS, ID substitution and legacy migration downgrade prevention.
- `hardening.test.mjs`: retry authorization/content binding, equal-time cursors and unread watermarks, staff report decisions, posting pauses, aggregate counters and repeatable migrations.
- `reliability.test.mjs`: uncertain send retries, missing-signature-only fallback, account isolation and bigint cursor precision.
- `ui.test.mjs`: actual index/scripts in jsdom with Auth/RPCs routed into isolated PGlite; includes sharing focus/reconnect, draft edits during a delayed response and staff hide/restore/posting/revocation flows.
- `concurrency.test.mjs`: a real embedded PostgreSQL instance and independent connections for simultaneous operations, plus a synthetic schema/data backup restored into a separate database. It binds loopback, uses a new random password and unique ignored `.runtime/pg-audit-*` directory, shuts down its own cluster and retains the fixture backup. No recursive cleanup is run. Windows uses `pg_ctl` for graceful shutdown.

The default suite uses PGlite (PostgreSQL in WebAssembly) and jsdom. These are simulated application/auth browser flows, not real email or live Supabase acceptance. The real PostgreSQL concurrency suite is separate because PGlite serializes a single connection. The fixture restore is not a full Supabase Auth/Storage/PITR disaster-recovery test.

GitHub Actions runs both commands with read-only repository permissions and no production secrets. Read [security scope, rollout, retention and outstanding live checks](../docs/SECURITY.md).
