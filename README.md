# CampusMY — your campus companion

**Live website: [campusmy-website.vercel.app](https://campusmy-website.vercel.app/)**

CampusMY brings UTAR course snapshots, a personal timetable and account settings into one responsive website.

## Live deployment and automatic updates

- Hosting: Vercel
- Connected repository: wtangkiakeat/campusMY
- Production branch: campusmy-website
- Application preset: Other
- Root directory: ./
- No build or dependency installation is required for this branch's checked-in HTML, CSS and JavaScript files.

Commits pushed to campusmy-website automatically trigger Vercel deployments. A successful deployment updates the live website. Saving local files alone does not upload changes. Yee is a separate branch and is not the production branch for this website.

### Update from your computer

Before editing, open PowerShell in your local CampusMY-website folder and pull the latest version:

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

## Pages and features

- Home: personal week summary, todos, campus links and favourite boards.
- Timetable: campus/faculty filters, Name/Prof/Code search, sorting, time selection, year/type/credit filters, lecture/tutorial/practical groups, lecturer and classroom details, teaching-week clash checks, manual classes, multiple plans and JSON backup/import.
- My page: user ID/profile, email verification, confirmation resend, password reset/change, email change, appearance, notification preferences, interest keywords and sign-out.
- Navigation: top search, notifications and account menu; mobile Home, Timetable, Boards and My page tabs.

Boards, popular posts and recent reviews have empty states until real community content is available. No student posts, ratings or reviews are fabricated.

## Supabase setup

Supabase Auth manages login, passwords and email confirmation. The browser-safe project settings are in config.js. Run CampusMY-supabase-setup.sql in your project's SQL Editor and follow Supabase-setup.md.

In Supabase → Authentication → URL Configuration:

- Set Site URL to https://campusmy-website.vercel.app/
- Add https://campusmy-website.vercel.app/ to Redirect URLs.
- Keep http://127.0.0.1:4173/ and http://localhost:4173/ for local development if needed.

Keep Confirm email and Secure email change enabled, and configure SMTP before inviting real users. Never put a database password, secret key or service_role key in the website.

Private account data uses campusmy_profiles, campusmy_planners and campusmy_todos with owner-based row-level security. Guest timetables stay separate on the device. Signed-in users explicitly save/load online plans; loading asks before replacing a local account copy. Activity notifications currently remain on the device.

The live website and Supabase connection have been checked, and anonymous access to all three private tables is denied. Actual email delivery, authenticated account operations and two-account row isolation still need acceptance testing with verified accounts.

## Course data

The reviewed collection contains 832 class groups, 1,087 meetings, 182 trimester offering snapshots and 136 distinct course codes with meeting data. The wider catalogue includes 677 distinct codes and 137 programme records.

Meeting snapshots cover selected Kampar sources for February, June and October 2026. This is not a complete live registration database. Unknown fields remain blank; source links and teaching weeks are retained. Confirm availability and registration eligibility with UTAR.

## Project files

This branch contains the deployable website. Full development source, automated test scripts and the SDK update tooling are maintained in the separate development project. No npm commands are required to serve this website branch. Commit significant changes with a clear message before pushing.
