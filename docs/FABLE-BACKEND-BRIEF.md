# Backend work to give Claude Fable 5.1

Current project: `C:\Users\willi\Documents\Codex\CampusMY`.

Repository: https://github.com/wtangkiakeat/campusMY . Production branch: `campusmy-website`. Inspect current branches and working changes before starting. Coordinate with any other editor; do not overwrite the chat feature branch or assume an old OneDrive checkout is current.

## Why give it this work?

Anthropic documents a 1M-token context window for Fable 5.1 and describes agentic coding, sustained tasks and vision capabilities. Those are useful for tracing account → JavaScript → RPC → SQL → tests across this project. That is a suitable use of a capable coding model, not evidence it is better than every current model or that its output is secure automatically. The current documentation labels 5.1 legacy and lists newer alternatives. Its prompting guide specifically recommends keeping scope and tests bounded because it can make adjacent changes.

Sources checked 16 November 2026:

- https://platform.claude.com/docs/en/models/fable-5-1/overview
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- https://www.anthropic.com/claude-fable-and-mythos-5-1

## Priorities for CampusMY

1. **Permission and concurrency audit.** Inventory every browser-callable RPC, table/sequence grant, RLS policy and SECURITY DEFINER function. Test anonymous, unconfirmed, A/B/third-party, blocked, removed and changed-campus identities. Prove users cannot substitute IDs to read another student's plans, messages or reports. Check search paths, helper execution privileges, JSON projection and stale requests after account switching. Test membership/capacity and rate limits using separate real PostgreSQL connections, including actions happening at the same instant. Existing functions already contain checks; identify bypasses with reproductions instead of replacing the architecture indiscriminately.

2. **Abuse controls that survive concurrency.** Review the old friend-request and direct-message count-based limits, especially requests to different recipients concurrently and repeatedly reusing an old request row. Add shared, server-side rate accounting where a bypass is demonstrated. Bound account discovery, joins/leaves, reports and expensive read endpoints. Keep user-facing retry guidance clear. Email confirmation is not proof of being a university student. Evaluate CAPTCHA/auth abuse settings with the owner; never disable email confirmation or RLS as a shortcut.

3. **Reliable messaging and unread state.** The new room API uses a sequence cursor. The older direct-message API still pages by timestamp only; reproduce the equal-timestamp boundary issue and introduce a stable cursor/index without losing history. Review send retries and an idempotency token so a network retry cannot duplicate a message. Keep drafts intact during polls and disconnects; fix stale unread counts using actual reads. If moving to Supabase Realtime, use private channels and authenticated membership authorisation, not a supposedly secret room name. Verify revocation and unsubscribe/account-switch behaviour explicitly. Private-channel admission does not by itself prove continuing access after membership changes.

   Official reference: https://supabase.com/docs/guides/realtime/authorization

4. **Moderation that an operator can actually use.** Build a staff-only report queue with message context, hide/restore and suspension decisions, reasons and an audit trail. Verify ordinary users and room organisers cannot grant themselves moderator rights. Rate-limit report spam. Keep reporters' identities and reports private. Avoid automatic bans based only on report count. Do not send student conversations to an external AI moderation service without owner approval and a clear data-handling decision.

5. **Web hardening and operations.** Review XSS sinks in every template, user-generated links, error messages, vendored browser dependencies, secrets accidentally committed, CSP/security headers and auth callback URLs. Start a restrictive CSP in report-only mode and test actual planner inline styles, fonts, QR scanning and Supabase HTTP/WebSocket traffic before enforcing it. Add sanitised error monitoring, slow-query/index review and a backup/restore drill in an isolated database. Keep emails, message bodies, tokens and timetable locations out of logs. Review account deletion, room ownership and data retention with the owner before changing cascade behaviour.

6. **Future university boundaries.** The current app only supports UTAR and campuses are self-declared profile fields. Design a server-controlled university-membership model before claiming verified campus-only access or supporting other institutions. A user-editable campus/university field must not be treated as verified authorisation. Verify official domain/source/permission requirements instead of guessing student email domains or copying another university's data.

## Copy-ready assignment

Read this brief, AGENTS.md, docs/CHAT-ROOMS.md, the current SQL and tests. First provide a short threat model and ranked findings with exact reproductions. Then fix demonstrated permission leaks, concurrency bugs and message reliability failures in small commits on a fresh branch based on the latest appropriate branch. Preserve the current UI, course catalogue, filters and optional/revocable read-only sharing. Use isolated test identities and a separate database for destructive/abuse/load tests. Do not create fake public content, contact real students or print secrets. Ask the owner to handle passwords and verification codes in the browser.

For each fix, add a meaningful regression test and distinguish code inspection, simulated SQL/browser tests and actual live verification. Prepare additive SQL migrations and a rollback/recovery plan; obtain approval before applying new production security policy or role changes. Commit each coherent milestone. Push a review branch and open a PR; do not merge, deploy, change billing or loosen protections without approval. Report remaining untested assumptions candidly. Prefer focused improvements over a framework/backend rewrite.
