# CampusMY — your campus companion

The user's original CampusMY project, version 3.0.0. The Yee branch preview is separate and has not been merged.

## Run locally

Serve the self-contained dist folder with a static HTTP server:

    python -m http.server 4173 --bind 127.0.0.1 --directory dist

Open http://127.0.0.1:4173/. Authentication needs an HTTP/HTTPS origin and matching Supabase redirect URLs. No frontend build is needed to run the checked-in app. To refresh the official browser SDK, run npm ci and npm run build:sdk.

## Pages

- Home: personal week summary, functional todos, campus links, favourite boards, and empty sections ready for real posts/reviews.
- Timetable: the existing campus/faculty, Name/Prof/Code keyword, sort, time-grid, year/type/credit filters, component group selections, lecturer/room details, teaching-week clash checks, manual classes, multiple plans and JSON backup/import.
- My page: user ID/profile, email status, password reset/change, secure email change, theme, notification preferences, interest keywords, default board, support and sign-out.
- Top navigation: search, notifications and My page. Mobile navigation: Home, Timetable, Boards, My page.

Supabase Auth manages login, passwords and email confirmation. Profiles/settings, account todos and explicit online timetable saves use the supplied Supabase project. Guest plans stay separate on this device. Saving online checks the last loaded version; loading asks before replacing a local account copy. Account switching clears pending private UI state. Activity notifications currently remain on the device and are labeled as such.

## Supabase setup

The browser-safe Project URL and publishable key are in dist/config.js. Run supabase/setup.sql in the project's SQL Editor, then follow supabase/README.md for redirect URLs, Confirm email, Secure email change and SMTP. No passwords, secret keys, service_role keys or sessions belong in source control. Private tables use account-owner RLS.

Live connection checks confirmed that the project responds, email/password auth is enabled, email confirmation is required, and anonymous access to the private profile table is denied. Actual signup mail delivery, authenticated CRUD and two-account RLS acceptance testing still need your own verified test accounts. Provider and hosting setup must not be reported as fully verified from source tests alone.

## Course data

832 class groups, 1,087 meetings, 182 trimester offering snapshots, and 136 distinct codes with meeting data. The wider catalogue includes 677 distinct codes and 137 programme records. Meeting snapshots cover selected Kampar sources in February, June and October 2026; this is not a complete live registration database. Unverified fields remain blank. Source links and teaching weeks are retained. No student reviews, posts, ratings, ads or popularity counts are fabricated.

## Checks and commits

Run npm test for source-data integrity, week-aware clashes, account input/key validation, pending-write isolation after sign-out, and cloud overwrite protection. Browser checks covered desktop/mobile layouts, home-task persistence, top search, timetable addition/removal and appearance settings. See CHANGELOG.md for milestones. AGENTS.md requires a commit for each substantial addition.
