# Full-stack member browser checks

From the project root, after `scripts/setup.sh`:

```bash
node tests/member-browser/run.mjs
MEMBER_BROWSER_VIEWPORT=mobile node tests/member-browser/run.mjs
```

This launches a disposable real FastAPI application on port 8001 with its own
SQLite database, the actual reviewed course seed, and ephemeral RSA-signed test
JWTs. A separate Next.js development instance runs on port 3001 with an isolated
`.next-member-tests` build directory. Existing servers on 8000/3000 are untouched.
The fixture process and Next process are stopped when the run ends, and its
OS-temporary token/database files are removed.

The tests exercise actual Next pages and actual FastAPI/SQLAlchemy persistence:
member access, review/tip submission, pending state, moderator decisions, comments,
helpful votes, reporting, anonymity response checks and private cloud timetables.

The Supabase provider session is explicitly **simulated** using the supported
`@supabase/ssr` cookie encoding and browser-scoped provider endpoint mocks. The
private signing key exists only in the fixture process. Inline fixture public
keys are accepted by backend settings only in `environment=test`. No test login
route or production bypass is introduced. This does not verify actual Supabase,
Google OAuth, university email delivery or production authorization grants.

The runner requires installed Chrome on macOS (or a Playwright Chromium browser
on other platforms). Set `PLAYWRIGHT_CHANNEL` if needed. Browser traces/screenshots
are written under the ignored `test-results/member-browser/` directory on failure.
Use free ports 8001 and 3001. A failed runner prints server output for diagnosis.
