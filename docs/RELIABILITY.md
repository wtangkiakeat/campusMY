# CampusMY reliability pass (PR #1, branch `redesign/campus-identity`)

A review of the account, timetable and social workflows behind the redesign, tested with isolated
accounts on an isolated database, with three confirmed problems fixed. The redesign, course data,
filters and privacy controls are unchanged.

## How the main workflows connect

- **Course data** is a static bundle (`data.js`): offerings → sections (lecture/tutorial/practical
  groups) → meetings (day, start/end minutes, room, lecturer, teaching weeks). `core.js` holds the
  pure logic shared with tests: overlap/clash detection that respects teaching weeks, time-grid
  filtering and the course filter pipeline.
- **The planner** (`app.js`) keeps plans in `localStorage` under a key that includes the signed-in
  user id (`campusmy-timetable-v2:<uid>`) or no suffix for a guest. `CampusAccount.refresh()` calls
  `CampusPlanner.setIdentity()` whenever the signed-in user changes, which is what keeps guest and
  account plans apart on one device.
- **Accounts** (`account.js`) wrap Supabase Auth and the three private tables (`campusmy_profiles`,
  `campusmy_planners`, `campusmy_todos`), each protected by owner-only row-level security.
  **Save online / Load online** use `campusmy_save_planner`, an optimistic-version function, so a
  stale tab cannot overwrite a newer copy. A profile row is created on first sign-in.
- **Social features** (`social.js`) never read tables directly. Every action is a `cm_*`
  security-definer function in `CampusMY-social-setup.sql` that re-checks the caller: confirmed
  email, friendship status, per-friend sharing flags, blocks, group ownership and capacity. The UI
  polls `cm_friends` every five seconds while the timetable or chat page is visible, which is how
  incoming requests, revoked sharing and unread counts appear without a refresh.
- **Sharing** is a published snapshot (`cm_publish_plan` → `campusmy_shared_plans`), gated three
  ways when a friend reads it (`cm_get_friend_plan`): the friendship must be accepted, the owner's
  per-friend flag must be on, and the owner's global switch must be on. Friends see a read-only
  render; "Stop sharing with everyone" and per-friend pause both take effect on the next read.
- **Chat** (`cm_messages` / `cm_send_message`) is limited to accepted, unblocked friendships; reading
  a thread records a per-user `last_read`, from which `cm_friends` derives unread counts.
- **Reviews, classmates and study groups** key on `campus|code` + trimester; reviews are unique per
  author/course/term/lecturer and only their author can edit or delete them; group organisers
  approve requests and capacity counts the organiser.

## Test environment (local, isolated)

No local PostgreSQL, Docker or Supabase CLI exists on the development machine, so the suite in
`tests/` runs the project's own SQL on **PGlite 0.5.16 (PostgreSQL 17.4 in WebAssembly)** with a
small `auth` schema shim, and acts as separate accounts the way PostgREST does (`set role
authenticated` + JWT subject claim). The browser-side suite runs the real `index.html` and scripts
in **jsdom** with a Supabase client stand-in that routes `auth`, `from()` and `rpc()` into that same
database, so RLS and the `cm_*` functions are exercised end-to-end from the UI.

Test accounts: alice, bob, dave, eve (confirmed), carol (unconfirmed), plus an account with no
username in its auth metadata. Nothing touched the live Supabase project.

    cd tests && npm install && npm test

## Reproduced issues and fixes

| # | Reproduced | Fix |
| --- | --- | --- |
| 1 | **Accounts without a username in auth metadata never got a profile.** `CampusAccountCore.username(undefined)` returned `true` because `RegExp.test` coerces `undefined` to the string `"undefined"`, so `refresh()` inserted `username: undefined` → `null value in column "username"` → `state.problem` set, no profile, and other students could not add that person ("That person is unavailable"). Reproduced in the UI suite by signing in an account created outside the app's sign-up form. | `account-core.js`: `username()` accepts strings only, so the `user_<id>` fallback is used. |
| 2 | **Friend-request dead end.** If Bob had already sent Alice a request and Alice then used *Find student → Send friend request* for Bob, the server returned the existing pending row untouched while the UI toasted "Friend request sent". Reproduced in both suites. | `social.js` request handler: after the call it reads the friendship back; if it is Bob's pending request to her, it accepts it (applying her chosen sharing setting) and says so; if it was already accepted it says so instead of claiming a new request. |
| 3 | **Whitespace-only chat message showed a raw database error** (`violates check constraint "campusmy_messages_body_check"`) because the textarea's `required` passes spaces. Reproduced in the UI suite. | `social.js` message handler trims first and shows "Type a message before sending." |

Fixes are client-side only; no SQL migration is needed.

## Checks passed (local)

Database suite — 113 checks:
- RLS: other users and anonymous visitors cannot read, update or insert private profiles, planners
  or todos; each account gets an independent online planner; stale optimistic saves are rejected.
- Friends: find by exact ID (case-insensitive, never yourself), request → incoming/outgoing views →
  accept only by the recipient, third parties rejected, decline hides and re-request reuses the row,
  remove ends chat and sharing, blocking removes the friendship and hides the blocker from search
  and requests, invitation tokens resolve/rotate/expire correctly, unconfirmed emails are refused.
- Sharing: publish enables; friends read a read-only payload with person info; sharing is
  reciprocal but independent; per-friend pause and global stop both hide the plan immediately;
  non-friends, pending requesters and removed friends are refused; payload validation (campus,
  day, times, weeks 1–52, 80-entry cap, string truncation); internal `cm_clean_plan` not callable.
- Chat: unread counts per friendship, cleared on read, not affected by loading older pages;
  non-participants refused; 30-per-minute limit; 50-message pages.
- Reviews: author-only edit (same id) and delete; anonymous vs named author; course-level and
  lecturer reviews are separate; unknown lecturer/assessment/short body/unknown course rejected;
  others cannot delete; reporting stored, self-report refused; hidden reviews only visible to the
  author; averages appear at five reviews; recent and my-reviews feeds.
- Study groups: organiser counted as member; pending requests visible only to the organiser;
  capacity enforced on approve and on request; non-organiser cannot approve; leave frees a seat;
  close/reopen; five-active-group limit; classmate listing opt-in and hide.

Browser-side suite — 42 checks:
- Guest plan vs alice vs bob: separate storage keys, sign-out restores the guest plan, Save/Load
  online returns only the account's own copy, wrong password rejected, profile created on sign-in
  (including the no-metadata account after fix 1).
- Timetable: overlapping class opens the clash dialog and is not added until *Add anyway*; conflicts
  marked and cleared; same slot in disjoint teaching weeks is not a clash, shared week is; the
  teaching-week filter shows only that week's classes; choosing another group updates selection,
  meeting details and the saved entry; saved-class details offer Change group / Rate & review /
  Classmates & study groups.
- Friends panel: incoming request appears within one poll; after acceptance View timetable / Chat /
  Manage appear; the read-only view shows the shared class with no edit controls; revocation by the
  owner reaches the open view within one poll; unread badge shows after a message and clears when
  the thread is opened; replies render as "mine" and count as unread for the other side.

Earlier redesign checks (both themes, desktop and phone, no console errors, no horizontal page
scroll) still hold; see `docs/REDESIGN.md`.

## Not tested here (needs the live project)

- Supabase Auth itself: sign-up confirmation emails, PKCE redirects, password reset and email
  change flows, SMTP delivery. The client stand-in only emulates sessions.
- Real network timing of the five-second polling, and the Vercel deployment.
- QR scanning with a camera (decoding is a vendored library; the dialogs were only opened).
- Behaviour with the production data already in the live tables.

A two-account acceptance pass on the live project remains recommended before merging to
`campusmy-website`, as the README already notes.

## Suggestions (not changed)

- Chat sidebar unread pills only refresh when the thread list re-renders; a poll that changes
  unread counts updates the friends panel and badges but not the open chat list until navigation.
- `refreshFriends()` returns early when a poll is already in flight, so an explicit refresh right
  after an action can be skipped until the next poll (≤5 s). A small queued-refresh flag would
  make post-action updates deterministic.
- The `user_<8 chars>` fallback username could collide in theory; retrying with a longer suffix on
  a `23505` error would make first sign-in bullet-proof.
- `cm_request_friend` could accept an existing incoming request server-side as well, so other
  clients get the same behaviour as fix 2 without depending on the UI.
- Message pagination uses `created_at <` the oldest loaded message; two messages with identical
  timestamps could straddle a page boundary. Ordering by `(created_at, id)` with a keyset would
  remove that edge.
