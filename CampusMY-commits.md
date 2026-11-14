# CampusMY milestones

## 3.0.0 — 14 November 2026

- `16ed0b3`: Supabase browser SDK/config, account validation, and owner-only profiles, planners and todos schema.
- `9257e15`: home dashboard, top search/notifications/My page navigation, mobile navigation, account forms and Supabase integration.
- `fef560e`: account-switch isolation, guarded cloud loads/saves, regression tests, and minor home/navigation refinements.

The prior timetable-only version is retained at `eee0e4c`. The Yee preview was not merged into this project.

UI checks covered home todos and refresh persistence, search, class group addition/removal, mobile/desktop layouts and guest account forms. Live checks confirmed the supplied Supabase project's email provider and required email confirmation, and confirmed anonymous access to the private profile table is denied. Signup email delivery, authenticated CRUD and two-account RLS behavior still require a real account acceptance test.
