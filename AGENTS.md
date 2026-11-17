# CampusMY website

The production branch is campusmy-website. Keep Yee separate. Commit each substantial feature milestone after relevant checks. Preserve all course data and filters. Never invent reviews, friends, messages or popularity counts. Supabase private rows require owner/member authorization; passwords and privileged keys never belong in browser code or Git. Shared timetable views must remain read-only, optional and revocable. Keep local guest and account data separate. Report simulated, local-database and live verification distinctly.


## Backend review in progress — 17 November 2026

`codex/complete-backend-hardening` holds the reviewed 4.3.1 source. Original Claude/Codex commits remain on local milestone branches. Production remains at `e5a3bf8` until an approved merge. Read `docs/SECURITY.md` before changing migrations. Do not reapply legacy bootstraps after hardening. New production SQL, staff appointment and merge/deployment require owner approval. The owner approved and applied both 17 November SQL upgrades, then separately approved one moderator. Do not ask to reapply them unnecessarily. Verified: 255 isolated checks, 16 live two-account scenarios and 12 anonymous production denials. Live testing found and fixed a persisted-auth chat startup race in 4.3.1. Original test-account sharing/friendship settings were restored; no public QA content was created. Merge/deployment still needs owner approval. See docs/SECURITY.md for precise scope and remaining operational decisions.
