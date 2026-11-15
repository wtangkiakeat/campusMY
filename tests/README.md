# CampusMY tests

Isolated tests that need no Supabase project, network or Docker. They run the project's own SQL
(`CampusMY-supabase-setup.sql` and `CampusMY-social-setup.sql`) on PGlite — PostgreSQL 17 compiled
to WebAssembly — behind a small `auth` schema shim, and act as separate test accounts the way
PostgREST does (`set role authenticated` plus a JWT subject claim).

    cd tests
    npm install
    npm test

- `db.test.mjs` — row-level security and optimistic plan saves, friend requests/acceptance/decline/
  blocking/invitations, reciprocal sharing and revocation, chat and unread counts, review ownership
  and moderation, study-group requests/approval/capacity, classmate listings.
- `ui.test.mjs` — the real `index.html` and scripts in jsdom with a Supabase client stand-in that
  routes `auth`, `from()` and `rpc()` into the same test database: sign-in/sign-out and plan
  separation across guest and accounts, clashes, teaching weeks, group selection, the friends panel,
  read-only sharing and revocation, chat unread badges.

Nothing here touches the live project. Live sign-in emails, PKCE redirects and SMTP still need the
two-account acceptance test described in the main README.
