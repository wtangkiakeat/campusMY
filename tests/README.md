# Test suites

Tests live separately from application source.

## Docker and YAML

The verified local runs execute Python, Next.js, Chrome and an isolated real PostgreSQL process directly on the host. They do **not** use Docker.

`.github/workflows/checks.yml` is a GitHub Actions workflow that instructs CI to install dependencies and run these checks after pushes/pull requests. Writing the YAML is not evidence that hosted CI has run.

`services/api/Dockerfile` packages the API for a container deployment. It is separate from the test runner and has not been built/run here; the Docker CLI is unavailable in this environment. There is no Docker Compose test configuration in the current project.

- `backend/`: isolated API/domain/security tests with test-only signed JWTs. No production impersonation endpoints.
- `data/`: strict source parsing, invalid/injected input, mapping, referential integrity, stable IDs and real seed counts.
- `frontend/`: pure planner tests using Node's test runner, including malformed plans and teaching-week boundaries.
- `browser/`: real Next.js-to-FastAPI public flows at desktop and phone widths, plus setup/auth gating.
- `postgres/`: real PostgreSQL migrations, seed idempotency and database checks.
- `security/`: independent security regression cases when applicable.
- `operations/`: safe local backup/restore rehearsal including private ownership and deletion tombstones.
- `member-browser/`: real multi-account UI/API/database flows with an explicitly simulated identity provider.

After setup:

Run `npm run check:all` with local application/test ports free to execute the full isolated sequence, including both member-browser widths. It stops its servers and removes disposable databases afterward.

For a frontend-only change, `npm run check:ui` runs planner tests, type checks, a production build and the desktop/mobile public/member browser flows without repeating unchanged backend/PostgreSQL suites.

```bash
npm run test:api
npm run test:frontend
npm run typecheck
npm run build
npm run test:postgres
```

The PostgreSQL runner uses a temporary project-local binary dependency, binds only to loopback, generates a random test password, and removes the isolated cluster after execution. It never targets a configured production database. On restricted agent environments, permission to listen on a local port may be required.

For browser tests, start `npm run dev` in another terminal, then run:

```bash
npm run test:browser
```

On this Mac the suite uses installed Google Chrome. Elsewhere install Playwright Chromium (`npx playwright install chromium`) and run with `PLAYWRIGHT_CHANNEL=chromium` if needed. Failure traces and screenshots go to ignored `test-results/`; the report is `playwright-report/index.html`.

Cloud-provider login, actual UTAR email delivery, vendor configuration, public deployment, and realistic hosted load are separate checks after provider setup. Locally signed test sessions exercise application permissions and data integrity; they do not establish that Google or SMTP has been configured correctly.
