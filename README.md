# Classwork — Assignment Management Platform

An assignment management platform for small teaching groups. Built with a React + TypeScript frontend, a NestJS API, and PostgreSQL, using an independent implementation and synthetic demo data.

Delivery scope: **a complete local version and deployment preparation**. A hosted application has not been provisioned. See [Acceptance](docs/ACCEPTANCE.md) for scope checks, [Verification](docs/VERIFICATION.md) for check results, and [Architecture](docs/ARCHITECTURE.md) for system design and business rules.

Code hosting: [GitHub repository](https://github.com/yunke-l/assignment-management-platform) · [GitHub Actions check history](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml). Source hosting and CI are separate from application deployment; the application runs locally.

The interface features Ollie the owl, balancing a welcoming learning environment with teachers' daily productivity: [Design notes and previews](docs/DESIGN.md).

## Screenshots

Captured from the locally running application on 2026-10-23 using an isolated database and synthetic demo accounts. The mobile screenshot uses a Chromium phone viewport.

**Teacher workspace** — search assignments, filter by class or status, and open drafts or published work.

![Teacher workspace showing assignment filters, two drafts, and a published assignment](docs/evidence/readme-workspace.png)

<details>
<summary>Sign-in page</summary>

The sign-in page pairs Ollie the owl with account access and invitation registration.

![Classwork sign-in page with the owl illustration, email and password fields, and registration link](docs/evidence/readme-login.png)

</details>

<details>
<summary>Assignment editor</summary>

Create questions, mark correct answers, assign points, and check the draft before publication.

![Assignment editor showing class and deadline fields, a single-choice question, scoring, and publication checks](docs/evidence/readme-editor.png)

</details>

<details>
<summary>Teacher results and student progress</summary>

After a student submits, the teacher can see submission counts, final averages, and individual results.

![Teacher report showing one graded submission, a 100 percent final average, and the student progress table](docs/evidence/readme-teacher-results.png)

</details>

<details>
<summary>Mobile student result</summary>

Students can review their submitted answers and score in the mobile layout.

<img src="docs/evidence/readme-student-mobile.png" alt="Mobile student result showing the submitted answer and a score of 10 out of 10" width="390" />

</details>

## Implemented features

- Teacher/student sign-in, invitation registration, persistent login after refresh, session revocation on logout, and revocation of all sessions after a password change.
- Teacher class creation, invitations with expiry and usage limits, invitation revocation, paginated member lists, and member removal.
- Draft creation, preview, editing, deletion, and publication; version checks detect editing conflicts, and published questions are immutable.
- Seven scored question types: single choice, fill-in-the-blank, cloze choice, grouping, matching, ordering, and manually graded responses; reading/general groups contain answerable child questions.
- Up to 20 top-level questions, 100 answerable questions, and 200 scoring units per assignment, with server-side validation and one final submission per student.
- Image/audio teaching materials and student answer attachments, with bounded uploads, media processing, authenticated playback, and private original-file storage.
- Objective grading plus manual rubric drafts, grade publication, and revision history; reports distinguish pending review, graded, and not submitted.
- Idempotent submission requests, database deadline checks, transaction rollback, and database uniqueness constraints.
- Filters by class, title, and status; paginated queries; teacher reports showing submitted/not-submitted students, scores, and averages.
- Desktop/mobile layouts, keyboard operation, loading and error states, and retries after failures.
- Data migrations, HTTP integration tests, Playwright browser tests, real PostgreSQL validation support, and synthetic-data query measurements.
- A same-origin production Web/API entry point, Dockerfile, HTTPS proxy configuration, CI, and deployment and backup/restore instructions.

## Membership and historical assignment rules

The recipient list is **frozen at publication**. New members receive only assignments published after they join. Removing a student immediately revokes their access to view and submit existing assignments in that class; teachers retain historical grades. Rejoining does not restore access to old assignments, but the student can receive new ones.

The statistics denominator is the recipient list at publication, including students removed later. Final averages include only released final grades and exclude submissions pending manual review. Missing submissions display “Not submitted”; the average is `null` when no final grades are available. Draft preview statistics use the current class size.

## Run locally (no Docker required)

Requires Node.js 22.13+ (22.x) or 24+; validation used Node 24. Audio processing also requires executable `ffmpeg` and `ffprobe`, available on `PATH` or configured with `FFMPEG_PATH` and `FFPROBE_PATH`. Run from this directory:

```sh
npm ci
npm run dev:demo
```

Open **http://localhost:5173**. The API is at `http://127.0.0.1:3100/api`. Use this localhost address to match the browser request Origin.

| Account                      | Password          | Role            |
| ---------------------------- | ----------------- | --------------- |
| `teacher@example.test`       | `LocalStudy2026!` | Class A teacher |
| `student@example.test`       | `LocalStudy2026!` | Class A student |
| `other.teacher@example.test` | `LocalStudy2026!` | Class B teacher |
| `other.student@example.test` | `LocalStudy2026!` | Class B student |

Demo mode uses PGlite (embedded PostgreSQL) in `.local/database`, without mocked HTTP. Existing data is upgraded through new migrations; rerunning the seed does not overwrite seeded account passwords. Run only one instance per data directory. Press Ctrl+C to stop.

Demo accounts are public test data and must not be used on the public internet. The demo launcher restores the fixed demo accounts' membership in the fixed classes. Demonstrate member removal in a class you create yourself to avoid confusion when restarting restores seeded memberships.

### Port already in use at startup

The demo needs ports `3100` (API) and `5173` (web). If an instance is already running, open http://localhost:5173 directly. To restart, press **Ctrl+C** in the original terminal, wait for it to exit, then run `npm run dev:demo` again. Do not run two instances against the same data directory.

The launcher checks ports before migrations and seeding. If a port is occupied, it lists the port and corrective steps without terminating other programs. A normal Ctrl+C stops the development processes and their children started by this run, preventing ports from remaining occupied. If another phase fails, read the original error log above the brief exit message.

## Suggested acceptance walkthrough

1. Sign in as a teacher, create a class in **Classes**, and generate a student invitation code.
2. In another browser or private window, select **Have an invitation? Create an account** and register a student using a new email address and the invitation code.
3. In **Assignments**, create an assignment, save the draft, edit and save it, then publish it to the new class.
4. As the student, refresh the list, answer, and submit. Refresh again to read the saved result.
5. As the teacher, open **Student progress** and check the submission count, student scores, and average.
6. Remove the student in **Classes**. After refreshing, the student cannot see old assignments; the teacher report retains the grades and the Removed label.
7. Logging out and refreshing should return to sign-in. **Account** supports changing the password and revoking all sessions for that account.

## Use a separate PostgreSQL instance

With Docker available:

```sh
cp .env.example .env
docker compose up -d db
npm run db:migrate
ALLOW_DEMO_SEED=true npm run db:seed
npm run dev
```

The development database binds to localhost:5434 by default. Do not compete with the demo for ports 3100/5173. Production must use PostgreSQL.

An administrator of the runtime environment creates teacher invitations through the CLI, without a separate public admin site or public teacher registration:

```sh
npm run accounts -- invite-teacher teacher@your-domain.example
```

The CLI uses the database specified by the root `.env`. Invitations are bound to an email address, expire after 48 hours, and allow one registration. Administrators pass them on privately; the application does not send email automatically. Existing students use **Classes → Join class** to join additional classes.

## Checks and tests

```sh
npm run check
npm run format:check
npm run test:recovery
```

`check` includes ESLint with zero warnings, type checks for applications/scripts/tests, development-process regression tests, frontend request-handling tests, HTTP integration tests, a production build, and smoke checks of the compiled entry point. `test:recovery` creates a synthetic PGlite data directory to validate offline backup, restoration, credential revocation, and historical grades without touching the local demo database. Integration tests use isolated in-memory PGlite by default; real PostgreSQL tests must target an empty, disposable, dedicated database:

```sh
TEST_DATABASE_URL=postgresql://amp:test_only_password@localhost:5432/amp_test npm run check
```

Do not point this at real data: tests write synthetic accounts, change test assignment deadlines, and temporarily inject database failures. Passing with PGlite's single connection does not replace real PostgreSQL validation.

Install browser dependencies before the first end-to-end run:

```sh
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:e2e
```

Tests start their own services on ports 3111/5175 with a fresh in-memory database, leaving the demo database untouched. HTML reports are in `playwright-report/`; screenshots and failure traces are in `test-results/`. CI uploads these as workflow artifacts. Mobile tests use Chromium mobile viewports and touch emulation, rather than physical-device Safari tests.

Synthetic query measurements require a separate empty database whose name ends in `_bench`:

```sh
BENCH_DATABASE_URL=postgresql://amp:password@localhost:5432/classwork_bench npm run benchmark
```

The script rejects databases that already contain a users table, generates isolated samples, and records HTTP latency and `EXPLAIN (ANALYZE, BUFFERS)`. See [Query measurements](docs/PERFORMANCE.md) for results and limitations.

## Project structure

```text
apps/web/src/              Sign-in, assignment, class, and account interfaces
apps/api/src/auth/         Revocable sessions, password authentication, Origin protection
apps/api/src/classes/      Membership, invitations, and authorization rules
apps/api/src/assignments/  Assignments, publication recipients, submissions, and reports
apps/api/src/database/     Database adapters, migrations, seeding, and admin CLI
apps/api/migrations/       Append-only SQL migrations
apps/api/test/             HTTP and real-database integration tests
packages/contracts/       Shared Zod schemas and response types
scripts/                  Demo launcher, isolated E2E server, and benchmark scripts
e2e/                      Desktop and mobile browser workflows
docs/                     Design, API, verification, and deployment documentation
deploy/                   HTTPS proxy and environment-variable examples
```

After contract changes, run `npm run build -w @amp/contracts` and restart the API if needed. `npm run check` and the demo launcher build contracts automatically.

## Deployment and boundaries

[Deployment, migration, rollback, and recovery instructions](docs/DEPLOYMENT.md) include Docker/Caddy/PostgreSQL commands. Local PGlite offline recovery has passed. Individual CI results are recorded in GitHub Actions. The CI `container` job builds the production image and runs PostgreSQL migrations, static-asset/API smoke checks, and Caddy configuration validation. There is currently no hosted application deployment; public HTTPS and production PostgreSQL backup/restore still require validation in the target environment.

The current version excludes multiple attempts, AI grading, automatic email, self-service forgotten-password recovery, and distributed rate limiting. Attachments are limited to the supported image/audio formats; arbitrary document uploads are not supported. Sessions expire after a fixed seven days. Filtering uses case-insensitive title substring matching. Each pagination request uses a consistent snapshot; refresh the list if data is added or removed while browsing across pages.

Further design details: [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [Verification evidence](docs/VERIFICATION.md). Do not describe synthetic test results as real user scale or production performance.

## License

This project's original source and documentation are licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
