# Connect your Supabase project

The supplied Project URL and publishable key are already in `dist/config.js`. Passwords and email confirmation are handled by Supabase Auth; CampusMY never writes passwords to a profile table.

1. In your project's **SQL Editor**, paste and run `setup.sql`. It creates only the three `campusmy_*` tables and an account-owned save function. RLS restricts each user's private rows to their account. There is no public profile directory.
2. In **Authentication → URL Configuration**, set your app's Site URL. For the local preview use `http://127.0.0.1:4173/`. Add that exact URL and `http://localhost:4173/` to Redirect URLs. Add the final HTTPS site URL when deployed.
3. Under the Email authentication provider, enable email/password sign-in and keep **Confirm email** and **Secure email change** enabled. Configure production SMTP before inviting real users. Password resets and email changes use Supabase's confirmation flows.
4. Open My page → Create account. Use your own email; confirm the link. Check that My page shows the email as verified. A verified email is not proof of university enrollment.
5. After signing in, save a profile, add a todo, and use timetable → Save online. Sign out and verify another account cannot see those records. Use Load online to retrieve a plan; the app asks before replacing local plans.

The publishable key can access only what your Supabase policies permit. Do not place a database password, secret key or service_role key in config.js. Do not disable RLS to fix a permission error.

Database objects: `campusmy_profiles` (user ID, username, campus, settings), `campusmy_planners` (private plans and save version), `campusmy_todos` (private tasks). Email and password records stay in Supabase Auth. Profile creation happens after authentication; signup metadata is not used for authorization.

Boards, recent reviews and popular posts currently have honest empty states. No student posts, ratings, advertisements or badge counts are fabricated. No general community posting backend is enabled by this update.
