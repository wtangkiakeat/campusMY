# CampusMY milestones

## 4.1.0 — 15 November 2026 (branch redesign/campus-identity)

- `ce95372`: Expand minified stylesheets into readable lines.
- `60f0a5f`: Introduce the CampusMY design system; restyle timetable and class explorer.
- `274a53f`: Restyle the app shell and Home; list today's classes; follow system appearance.
- `dadfec2`: Restyle friends, sharing, course space, reviews and chat.
- `d7bfe2b`: Add redesign notes with desktop and mobile screenshots.
- `71b6d02`: Open in the bright theme by default and add a header light/dark toggle.
- `ba4fb89`: Record the theme toggle in the 4.1.0 milestone.
- `875fdfd`: Validate usernames as strings so accounts without metadata get a profile.
- `b9a0358`: Accept an existing incoming request instead of silently re-sending.
- `575b5bf`: Reject empty chat messages before they reach the database.
- `9e8f750`: Add isolated database and browser-side test suites.
- `62e9892`: Document the reliability pass.

Visual redesign on the supplied burgundy and gold logo colours with light and dark themes; course data, filters, Supabase integration and privacy controls unchanged. Local browser checks covered both themes at desktop and phone widths, timetable editing, filters and dialogs. A reliability pass added isolated database and browser-side suites (tests/, 155 checks on PGlite + jsdom) and fixed profile creation for metadata-less accounts, the friend-request dead end and empty chat messages; live sign-in and signed-in Supabase flows still need the two-account acceptance test. Details: docs/REDESIGN.md and docs/RELIABILITY.md.

## 3.0.0 — 14 November 2026

- `16ed0b3`: Supabase browser SDK/config, account validation, and owner-only profiles, planners and todos schema.
- `9257e15`: home dashboard, top search/notifications/My page navigation, mobile navigation, account forms and Supabase integration.
- `fef560e`: account-switch isolation, guarded cloud loads/saves, regression tests, and minor home/navigation refinements.

The prior timetable-only version is retained at `eee0e4c`. The Yee preview was not merged into this project.

UI checks covered home todos and refresh persistence, search, class group addition/removal, mobile/desktop layouts and guest account forms. Live checks confirmed the supplied Supabase project's email provider and required email confirmation, and confirmed anonymous access to the private profile table is denied. Signup email delivery, authenticated CRUD and two-account RLS behavior still require a real account acceptance test.
