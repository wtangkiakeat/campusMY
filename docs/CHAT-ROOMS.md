# Community conversations â€” 4.2.0

The chat page follows the supplied Local / Campus / My Chats references, using CampusMY's existing burgundy-and-gold light and dark themes. There is no advertising banner, advertisement placeholder or ad integration. No example rooms, participants, reviews or messages are seeded into the product.

## What works

- Local: choose Kampar or Sungai Long area. No geolocation permission or GPS is used.
- Campus: rooms for the campus in the account profile. This is currently self-declared campus selection, **not verified university enrolment**. Only UTAR is currently supported; the UI does not imply otherwise.
- My Chats: joined rooms and existing private friend conversations. Existing `#chat/<friendship-id>` links remain valid.
- Search room titles/descriptions or friend names, filter topics, create and explicitly join a room.
- Member-only room history and sending; 50-message pages use a monotonically increasing sequence cursor, avoiding equal-timestamp skips.
- Owner close/reopen/remove-member controls, leaving rooms, per-room mute and private message reports. Removed members cannot rejoin.
- Current members are shown only to other current members; emails, private plans and to-dos are never projected by room APIs.
- Server limits: 3 new rooms/day, 30 active memberships/account, 30 messages/minute/account across community rooms, 2â€“100 room capacity and 2000-character messages. The creator counts toward capacity. Mutations use transaction locks for capacity and send/create rate checks.

Rooms update every five seconds while the chat page is visible. Existing friend chat continues using its previous APIs. Realtime is a possible follow-up, not part of this release. Muting excludes a room from unread indicators; there are no new push notifications.

## Setup

Run `supabase/20261116_chat_rooms.sql` once in the existing project's SQL Editor, after the original account/social schema. It is additive and transaction-wrapped; it does not alter existing student rows or weaken existing table policies. It is safe to reapply. The four new tables have RLS enabled and no direct browser grants. Only the explicitly listed authenticated RPC entry points are exposed; each checks a confirmed email and relevant membership/campus/owner permissions. Internal helper functions are not browser-callable.

The migration was applied successfully to the existing production Supabase project on 16 November 2026. Until the migration is applied to another environment, room discovery shows an honest connection/setup state and existing friend messages remain available in My Chats. Do not rerun the older base schema to resolve a missing room endpoint.

New tables: `campusmy_rooms`, `campusmy_room_members`, `campusmy_room_messages`, `campusmy_room_reports`.

## Moderation and privacy

Reports are stored for manual review by the operator, not automatically actioned. There is no new moderator dashboard or automated content classifier. An operator can inspect private reports in Supabase and hide a message by setting `campusmy_room_messages.hidden=true`; normal students have no direct access to these tables. Future moderation tooling needs an explicitly authorised staff role and an audit trail.

Blocking hides the blocked student's messages and member identity in the caller's room views. Blocking the organiser makes that room unavailable. Shared rooms may still contain mutual members; this is explained in Chat settings. Removing/leaving a room stops further API access. Already viewed content or screenshots cannot be remotely erased.

Messages are stored by CampusMY and are **not end-to-end encrypted**. Joining does not enable timetable sharing. Leaving retains existing messages in the room. Closing a room stops joining/sending and hides it from discovery while members can still read its history. An owner must close before leaving.

## Verification

`npm ci --prefix tests` then `npm test --prefix tests` runs the original database tests, community-room tests and browser-script tests against isolated PostgreSQL (PGlite) and jsdom. Test accounts/content are created only in that isolated database.

The new database suite covers anonymous/unconfirmed denials, table grants and internal function privileges, campus isolation, non-member denial, true capacity, unread reads, invalid messages, member projections, moderation reporting, ownership, mute, removal/rejoin denial, blocking, leaving/closing, equal-timestamp paging and rate limits.

The browser-script suite additionally drives room creation, a second member's message, HTML-as-text rendering, whitespace validation, reporting, muting, friend/room navigation, topic/search filters, member removal and account isolation through the actual scripts and SQL RPCs. This is distinct from live Supabase Auth, a real browser with signed-in test accounts and simultaneous multi-connection concurrency tests.

Live two-account acceptance remains necessary before describing the entire chat service as production-verified. Keep mock data and test users out of the public community.

Latest local verification: 113 original database checks, 26 room database checks and 59 browser-script checks passed (198 total). Real-browser guest layouts were checked at 390×844 and 1440×900 in both themes, without page-wide horizontal overflow or console errors. Signed-in real-browser acceptance against live Supabase Auth remains untested.
