# CampusMY website

The production branch is campusmy-website. Keep Yee separate. Commit each substantial feature milestone after relevant checks. Preserve all course data and filters. Never invent reviews, friends, messages or popularity counts. Supabase private rows require owner/member authorization; passwords and privileged keys never belong in browser code or Git. Shared timetable views must remain read-only, optional and revocable. Keep local guest and account data separate. Report simulated, local-database and live verification distinctly.


## Backend review in progress — 17 November 2026

`codex/complete-backend-hardening` preserves Claude's `f44dbf1` and adds the reviewed backend/client work. Production remains at `e5a3bf8` until an approved merge. Read `docs/SECURITY.md` before changing migrations. Do not reapply legacy bootstraps after hardening. New production SQL, staff appointment and merge/deployment require owner approval. Live two-account acceptance is still a separate gate; isolated fixtures are not live evidence.
