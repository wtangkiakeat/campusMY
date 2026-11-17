# CampusMY — your campus companion

**Live website: [campusmy-website.vercel.app](https://campusmy-website.vercel.app/)**

CampusMY brings UTAR course snapshots, personal timetables, friends, course reviews and study groups into one responsive website.

The website header and browser icon use the supplied CampusMY logo in `icon.svg`, preserving its burgundy gradient, white bars and gold centre bar. The responsive header uses the same SVG on every page.

## Live deployment and automatic updates

- Hosting: Vercel
- Connected repository: wtangkiakeat/campusMY
- Production branch: campusmy-website
- Application preset: Other
- Root directory: ./
- No build or dependency installation is required for this branch's checked-in HTML, CSS and JavaScript files.

Commits pushed to campusmy-website automatically trigger Vercel deployments. A successful deployment updates the live website. Saving local files alone does not upload changes. Yee is a separate branch and is not the production branch for this website.

### Update from your computer

Before editing, open PowerShell in your current CampusMY project folder and pull the latest version:

    git pull --ff-only

After making and checking your changes:

    git add .
    git commit -m "Describe your changes"
    git push

You can also edit a file directly on the campusmy-website branch in GitHub and commit it there. Check the Vercel dashboard for deployment status and any errors.

## Run locally

From this branch's root folder, serve the website with Python:

    python -m http.server 4173 --bind 127.0.0.1

Open http://127.0.0.1:4173/. The index.html file is in the root of this branch; there is no dist folder here. Authentication requires HTTP/HTTPS and matching Supabase redirect URLs.

## Community chat (4.2.0)

Local, Campus and My Chats provide topic/search discovery, member-only rooms, organiser controls, reporting and muting, alongside existing private friend messages. No advertising or invented community content is included. Local uses a selected area; campus selection is currently self-declared, not verified enrolment.

Apply `supabase/20261116_chat_rooms.sql` after the original account/social setup to enable rooms. See [chat setup, privacy and test notes](docs/CHAT-ROOMS.md). Existing friend messages work without the new room migration. See [the backend/security brief for Claude](docs/FABLE-BACKEND-BRIEF.md) for recommended follow-up work.

## Pages and features

- Home: personal week summary, todos, campus links and favourite boards.
- Timetable: campus/faculty filters, Name/Prof/Code search, sorting, time selection, year/type/credit filters, lecture/tutorial/practical groups, lecturer and classroom details, teaching-week clash checks, manual classes, multiple plans and JSON backup/import.
- My page: user ID/profile, email verification, confirmation resend, password reset/change, email change, appearance, notification preferences, interest keywords and sign-out.
- Appearance opens in the bright (light) theme; the sun/moon button in the header switches to dark, and My page → Appearance offers Light, Dark or System default.
- Design notes and screenshots for the burgundy-and-gold redesign are in docs/REDESIGN.md.
- Friends: QR/link invitations, exact user-ID search, accepted requests and optional read-only timetable sharing.
- Course spaces: ratings, lecturer reviews, opt-in classmates and organiser-approved study groups.
- Chat: private conversations between accepted friends, history and unread counts.
- Navigation: top search, notifications and account menu; mobile Home, Timetable, Boards, Chat and My page tabs.

Boards and popular posts remain unavailable. Recent reviews show real saved content, with honest empty states. No student posts, friends, messages or ratings are fabricated.

## Friends, reviews and study groups

Press **Add classes** on the timetable to open the existing class explorer and filters. Expand a class to choose groups, **Add to timetable**, read **Reviews** or **Find classmates**. Click a class already on your timetable to see room/lecturer details, **Rate & review**, or open its **Classmates & study groups**.

Use **Add friend** to search an exact CampusMY user ID or show a **QR / invitation link**. Links expire after seven days and can be replaced. A signed-in student must send a request and the recipient must accept. An invitation never grants public timetable access. QR images are decoded on the device; the camera starts only on request.

Each person chooses whether to share the selected timetable. Friends see a read-only weekly calendar and agenda, with shared rooms and lecturers. Manually added events are excluded unless explicitly included. One selected plan is shared per account: choosing another shared plan updates the copy visible to all permitted friends. Other plans, email addresses, settings and to-dos remain private.

**Share timetable** can keep that selected plan updated while CampusMY is open on the device where sharing was enabled. The shared view shows the last-update time. On another device, choose **Share selected timetable** to update the copy. **Stop sharing with everyone** disables access; a friend's **Manage** menu can pause just that friend's access. Chat remains available while sharing is paused. Removing a friend ends both timetable and chat access. Previously viewed information cannot be erased from another person's screenshots.

Open **Chat** from a friend or the navigation. Conversations refresh about every five seconds while visible. Messages are stored in Supabase and are not end-to-end encrypted. Removing/blocking a friend hides the conversation; stored history is retained and may reappear if a friendship is accepted again.

Reviews are separated by course, trimester and lecturer. Students can edit/delete their own reviews and hide their name from other students. Lecturers are selectable only when present in that trimester's published snapshot; unknown information stays blank. Attendance is self-reported: email confirmation does not verify university enrolment or course attendance. Average ratings appear after five reviews. Popularity sorting remains unavailable.

Course classmate listings are opt-in, expire after 90 days and can be hidden. Study groups expire after 30 days, have a member limit including the organiser, and require organiser approval for join requests. Group membership does not automatically add friends or share timetables. Social features require a confirmed email.

## Supabase setup

Supabase Auth manages login, passwords and email confirmation. The browser-safe project settings are in config.js. See [Supabase-setup.md](Supabase-setup.md) for installation order; an existing installation must not rerun legacy bootstrap files after hardening.

## Backend reliability and moderation review (4.3.0)

This branch adds atomic abuse controls, stable DM paging/unread markers, safe send retries, immediate sharing rechecks, staff report decisions, temporary community posting pauses and privacy-preserving operational counters. Security headers include a CSP in report-only mode. The catalogue, filters and existing visual identity are preserved.

The changes require review and the two new SQL migrations before their backend guarantees apply to production. No staff account is appointed automatically. Production migration, merge/deployment and live two-account acceptance require the owner's participation. See [security findings, rollout and recovery](docs/SECURITY.md).

Run the isolated suites with `npm ci --prefix tests`, `npm test --prefix tests` and `npm run test:concurrency --prefix tests`. No production database URL or real credentials are used. The concurrency suite retains only synthetic local fixtures under ignored `.runtime`.

For a new project, run **CampusMY-social-setup.sql** after the base setup. This atomic migration creates social tables and protected functions and seeds identities and lecturer observations from the existing source-backed collection. It creates no fake reviews, accounts or friendships. The production project received this migration on 15 November 2026; existing users do not need to run it again. Website deployments do not automatically run SQL migrations.

Social tables grant no direct anonymous/authenticated access. API functions check the current user, accepted friendship and group membership and return only allowed fields. Existing private planner policies are preserved.

### Manual moderation

Reports are stored in `campusmy_review_reports` for the site operator to review in Supabase. Reporting does not automatically hide content. Set `campusmy_reviews.hidden` to true to hide abusive content without deleting it, or false to restore it. Students cannot change moderation flags. The 4.3 review adds a staff-only report dashboard with hide/restore, posting pauses and a decision audit trail after its migrations are approved. No external automatic moderation service is used. An operator can reverse a block by removing its row from `campusmy_blocks`; that does not restore the friendship automatically.

In Supabase → Authentication → URL Configuration:

- Set Site URL to https://campusmy-website.vercel.app/
- Add https://campusmy-website.vercel.app/ to Redirect URLs.
- Keep http://127.0.0.1:4173/ and http://localhost:4173/ for local development if needed.

Keep Confirm email and Secure email change enabled, and configure SMTP before inviting real users. Never put a database password, secret key or service_role key in the website.

Private account data uses campusmy_profiles, campusmy_planners and campusmy_todos with owner-based row-level security. Guest timetables stay separate on the device. Signed-in users explicitly save/load online plans; loading asks before replacing a local account copy. Activity notifications currently remain on the device.

The live website and Supabase connection have been checked, and anonymous access to all three private tables is denied. Actual email delivery, authenticated account operations and two-account row isolation still need acceptance testing with verified accounts.

## Course data

The reviewed collection contains 832 class groups, 1,087 meetings, 182 trimester offering snapshots and 136 distinct course codes with meeting data. The wider catalogue includes 677 distinct codes and 137 programme records.

The social lookup combines existing records into 689 campus/code identities and 327 course/trimester/lecturer observations; these are not newly discovered classes.

Meeting snapshots cover selected Kampar sources for February, June and October 2026. This is not a complete live registration database. Unknown fields remain blank; source links and teaching weeks are retained. Confirm availability and registration eligibility with UTAR.

## Tests

`tests/` holds isolated database and browser-side suites that need no Supabase project: `cd tests && npm install && npm test`. They run the project's SQL on PGlite (PostgreSQL in WebAssembly) and the real pages in jsdom. See `tests/README.md` and `docs/RELIABILITY.md` for what they cover and what still needs the live project.

## Project files

This branch contains the deployable website, database setup SQL and vendored browser dependencies with licence notices. No npm commands are required to serve it. The development archive additionally includes migration fragments, QR/privacy tests, seed generation and isolated PostgreSQL permission/UI tests. Significant stages are committed separately. Vercel serves the root HTML/CSS/JavaScript; Yee stays separate.

Release validation includes real local PostgreSQL checks with confirmed, unconfirmed and unrelated identities; browser checks for friend acceptance, read-only and revoked sharing, chat delivery, reviews and opt-in course listings/groups; QR encode/decode tests and original course-count checks. Production checks cover the migration, anonymous denials and deployment. A full production acceptance test with two real confirmed student accounts remains for the account holders. No live student content was created for testing.
