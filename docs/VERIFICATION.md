# Verification record

Date: 2026-09-24. Delivery scope confirmed by the user: local application plus deployment preparation; no public application deployment in this task. The user subsequently requested private GitHub source hosting.

The September records below are historical. The latest code audit and current test totals are in [Code audit, 2026-10-07](#code-audit-2026-10-07).

## Completed checks

| Check                                                         | Result                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TypeScript: API, web, scripts, HTTP tests and E2E definitions | Passed                                                                   |
| HTTP/database suite on PostgreSQL 17.10                       | **39 passed**, 0 failed, 0 skipped                                       |
| Same suite on isolated in-memory PGlite                       | **34 passed**, 0 failed, 5 PostgreSQL-only cases intentionally skipped   |
| Contracts, NestJS and Vite production build                   | Passed                                                                   |
| Built Node entry serving compiled web assets and API          | Passed: HTML, JS asset, migration, login, class read and DB health       |
| Playwright desktop and mobile viewport workflows              | **8 passed**, 0 failed; Chromium 153                                     |
| Existing local demo database upgrade and `npm run dev:demo`   | Passed; HTML and proxied `/api/health` both returned 200                 |
| Synthetic PostgreSQL HTTP/query measurement                   | Completed; [method, results and limits](PERFORMANCE.md)                  |
| Local PGlite backup and restore into a fresh directory        | Passed; all 10 tables match, credentials revoked, saved results readable |

The default check command is `npm run check`. Real PostgreSQL was an isolated, loopback-only instance on port 55432 using a disposable `amp_verification` database. The binary reported PostgreSQL 17.10 x86_64; Node 24.5.0 ran on the ARM64 macOS host. The PostgreSQL test server was stopped after verification. The PGlite and browser tests use separate in-memory databases.

Before upgrading the existing local demo, its `.local/database` directory was backed up to `.local/backups/demo-before-upgrade-20260924.tgz`. The original SQL migration was not rewritten. Demo migrations and repeatable seed completed, and the development application was left running at http://localhost:5173 for review. The archive is a local precaution, not a verified production backup/restore exercise.

## What the tests establish

- Session tokens are hashed in storage, cookies are HttpOnly/SameSite, reload restores login, mismatched/missing browser Origin is rejected, logout revokes old credentials, and password changes revoke all sessions.
- Registration cannot self-assign a teacher role. Teacher invitations are email-bound/single-use; class invites expire, revoke and enforce usage limits under concurrent joins. Failed registration does not consume an invitation.
- Cross-teacher and student ownership boundaries hold. New members do not receive old assignments. Removed students lose read/submit/replay access while teachers retain scores and report rows; rejoining only enables future assignments.
- Draft edits detect stale versions; simultaneous editors cannot silently overwrite each other. Published content cannot be edited/deleted. Failed question replacement rolls back the title, version and all questions. Concurrent publish requests create one audience snapshot.
- UUIDs are normalized across route parameters, filters and payloads. Uppercase IDs refer to the same resource, and an unchanged submission remains an idempotent replay after UUID case changes.
- PostgreSQL read regressions deliberately interleave metadata reads with another connection's draft edit or publication. Assignment details, statistics and roster responses use one repeatable-read snapshot instead of combining old metadata with new questions or membership counts.
- Student responses omit answer keys. Malformed answers are rejected. Scores are server-generated; same request and reordered answers replay the same result; changed payload/assignment or a second request conflicts.
- A post-insert trigger failure rolls back the entire submission. The same request can then succeed. A synthetic DB outage gives a generic traceable error and the service recovers.
- The PostgreSQL-specific checks prove different backend connection IDs and observe an HTTP submission waiting on a recipient row lock before moving the deadline to the database clock; the delayed request is rejected with no saved submission.
- Scoped title/class/status filtering and stable ordering work on a fixed dataset. Reports distinguish unsubmitted students and a null average.
- In the browser, the teacher creates a class and invitation, a separate student context registers, the teacher creates/edits/publishes a draft, and the student submits. The test deliberately discards the first successful submission response; retry succeeds without a second submission. Both roles reload the saved result. Removal and revoked-session replay are checked through the UI/API.
- Keyboard sign-in, empty filtered results, temporary list errors, retry and expired-session return to login pass in both viewport configurations. Screenshot checks found no horizontal page overflow.
- The editor preserves the correct answer index when options are removed, enforces the 2–6 option range, saves edits, and supports cancelling or confirming draft deletion in both viewport configurations.

The browser test startup was corrected to use the API TypeScript configuration and ESM scripts, and readiness now waits for the proxied API health endpoint. An option-removal button was moved outside the input label so assistive technologies get the intended input name. The final browser run passed after these corrections.

The four new UUID/read-consistency regressions were first run against the previous implementation: all four failed. After canonical UUID parsing and snapshot transactions were added, all four passed, followed by the complete 39-case PostgreSQL suite. This is a recorded correction, not a claim that the application has no remaining defects.

## Local recovery evidence

`npm run test:recovery` creates a separate synthetic persistent PGlite fixture, publishes and submits an assignment, shuts down cleanly, copies its directory, and restores into a previously absent directory. It never opens the user's `.local/database` or a database from `.env`. All ten table counts and logical SHA-256 digests matched, migration checksums remained valid, restored sessions/invitations were revoked, both users signed in again, and the teacher report and student result retained the original submission and score. Student answer keys remained hidden.

The measured copy took 543 ms and restore plus table verification took 1,459 ms with PGlite 0.5.8 and Node 24.5.0. [Raw recovery evidence](evidence/recovery.json) records the method and assertions. This proves same-version, offline local PGlite recovery only; PostgreSQL `pg_dump` and production recovery remain separate target-environment checks.

## Visual and demo evidence

- [Desktop teacher report](evidence/desktop-teacher-results.png)
- [Desktop student result](evidence/desktop-student-result.png)
- [Mobile teacher report](evidence/mobile-teacher-results.png)
- [Mobile student result](evidence/mobile-student-result.png)
- [Automated teacher workflow recording](evidence/teacher-workflow.webm)
- [Automated student workflow recording](evidence/student-workflow.webm)

All evidence uses synthetic data. These are automated workflow recordings, not evidence of real adoption or of the project owner's independent understanding. Playwright also writes the local HTML report and test recordings; CI is configured to retain them as artifacts.

## Remaining external verification

- Docker is not installed on this host. The current CI `container` job builds and smoke-tests the production image with PostgreSQL and validates Caddy configuration. Check the commit's hosted result before deployment; public TLS remains a target-environment check.
- Source hosting is configured at [the private GitHub repository](https://github.com/yunke-l/assignment-management-platform). Hosted CI results and artifacts are available per commit in [GitHub Actions](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml); local results above do not by themselves prove a hosted run succeeded.
- No public domain/HTTPS deployment, production backup restore, failover or long-running load test has been completed. See [deployment and recovery](DEPLOYMENT.md) for the commands and acceptance steps.
- Mobile coverage uses Chromium viewport/touch emulation, not physical iOS/Safari hardware. This is not a comprehensive assistive-technology audit.
- The September build's two third-party Zod PURE-comment warnings were corrected in the October code audit below.

Do not describe synthetic data sizes, this single local latency sample, or generated implementation as production users, uptime guarantees, measured commercial impact or independently demonstrated interview proficiency.

## Demo startup correction (2026-09-25)

The previously retained demo process still held ports 3100 and 5173. Starting a second web server reproduced `Port 5173 is already in use`; the outer demo script reduced that failure to an unhandled `npm run dev exited with 1` stack trace.

The launcher now checks both ports before migrations or seeding, prints actionable errors, and terminates the process group it starts when interrupted. The prior instance was stopped gracefully, and the existing demo directory was backed up before verification. The revised launcher completed migrations and seeding, served the page and proxied database health endpoint with HTTP 200, and released both ports after Ctrl+C. It was left stopped so the project owner can start it from VS Code.

Five new `npm run test:dev` regressions passed on macOS: an occupied port leaves its listener untouched; probe sockets are released; child failures report their exit code; interrupted startup does not launch another command; stopping a parent releases ports held by its descendants. They are included in `npm run check`; the process-group regression covers macOS/Linux and is explicitly skipped on Windows. The README now documents the port-conflict recovery procedure.

## Owl interface update (2026-09-25)

The login, assignment workspace, editor, class management, account and submission result screens now share an original SVG owl mascot, warm neutral surfaces and forest-green controls. The desktop list/detail layout remains; smaller screens navigate to the detail panel when opening or creating an assignment and provide a return-to-list button. Application permissions, grading and database rules are unchanged.

TypeScript checks, the Vite production build, built-entry smoke test and all **8 Playwright tests** passed after the update. The two new appearance tests cover the main screens, 320px and 768px layouts, horizontal overflow, unhandled JavaScript errors and mobile detail navigation. Screenshots were visually reviewed; updated evidence uses synthetic test data. See [design notes and previews](DESIGN.md).

## Controls and unfinished-work protection (2026-10-07)

The editor now uses compact answer rows with inline answer-key selection, removable choices with Undo, field-level validation, separate native date/time controls and a persistent save bar. Editing hides the list and large welcome decoration. Buttons and fields share lighter borders, consistent sizing and restrained green focus styles. Class invitations include copy feedback and duration presets. The interface remains English.

Unfinished assignments and student answers are isolated by account and retained in this tab's session storage. Failed saves and version conflicts keep edits; submit retries retain the same request ID. Local edits must be saved or discarded before publication. Successful save/submit clears its recovery copy, and explicit sign-out clears the account's unfinished work after confirmation. Class inputs and invitation secrets stay only in page memory, including reauthentication after expiry; passwords are never stored. Sensitive navigation and browser reloads warn before loss, including the expired-session sign-in screen. Storage failure shows a warning and keeps work in memory. This is not server autosave or recovery after arbitrary tab closure, browser storage deletion or mobile process termination.

The final browser suite contains **18 desktop/mobile Chromium cases**, including ten protection cases. Coverage includes:

- New work across section navigation and reload, Undo preserving the correct choice, cancellation, dialog Escape and sign-out cleanup.
- Saved draft edits across assignment switches, failed PATCH and stale-version rejection without overwriting another editor's save; publication is disabled while local edits exist.
- Student answers across navigation, reload and expiry, account isolation, retry request identity and cleanup after successful submission.
- Invitation copy feedback, memory-only retention across sections and reauthentication, replacement cancellation, password-leave confirmation and reload warning; secrets are absent from session storage.
- Blocked storage with memory fallback, and disabled navigation/sign-out during an outstanding save.

The isolated E2E server raises only its in-memory rate-limit threshold because all browser contexts share loopback. Production configuration is unchanged; the HTTP suite still verifies that login attempts are rate-limited. An initial fixture PATCH was corrected to send ISO datetime rather than the database's display format. The browser installation is project-local on this host (`PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/playwright"`).

Final local results: **18/18 browser cases passed**, full TypeScript checks passed, **34 HTTP/PGlite cases passed** with the same five PostgreSQL-only skips, **5/5 startup-process cases passed**, and the production build and built-entry smoke test passed. Changed text files pass Prettier and `git diff --check`. This update did not rerun the local PostgreSQL-specific suite; the September results above are historical. The existing two non-failing Zod build annotation warnings remain.

Computer Use repeated the teacher flow at 1280×900 and 390×844: fill an assignment, choose native deadline controls, switch to Classes and back, remove/undo the correct option, keep working from the discard dialog, save, edit again, check the publication guard, resume and save. After the last protection change, the mobile edit/navigation/undo/keep/save flow was repeated. The saved title, instructions and answer key remained correct. The phone viewport and document width were both 390px; the option controls and save actions remained visible and usable. Empty-submit validation focused the title and showed field errors. Unsaved reload restoration is established by the automated tests; Computer Use's reload attempt was stopped by the warning and is not counted as a completed recovery test.

Evidence: [desktop editor](evidence/controls-desktop.png), [Computer Use phone editor](evidence/controls-mobile.jpg), [discard confirmation](evidence/controls-confirmation.jpg). Tests and screenshots use synthetic accounts in an isolated in-memory database. The regular local demo database was not opened. Temporary servers are stopped after verification. Mobile evidence uses a resized browser, not a physical phone or an on-screen keyboard audit.

## Code audit, 2026-10-07

Reviewed the application sources, shared contracts, SQL migrations, operator and development scripts, test fixtures, build configuration and deployment files. This audit fixes observed failures and adds repeatable checks; it does not establish that all possible inputs, browsers or deployment environments are defect-free.

Corrections:

- PostgreSQL idle-client and checked-out transaction connection errors no longer become unhandled events that crash the API. Failed rollback preserves the original error and discards the unusable client. An isolated child-process regression first reproduced the crash; both idle and transaction termination now reconnect successfully.
- The JSON parser now accepts the full contract-sized Unicode assignment and returns a traceable 413 for oversized bodies. Invalid production origins with credentials, query strings or fragments are rejected. Demo seed passwords must satisfy the same 12–128-character contract as sign-in.
- Assignment, submission and invitation timestamps no longer expose PostgreSQL display-format strings. They serialize as portable ISO timestamps. Before these fixes, regressions failed for Unicode payloads, oversized bodies, timestamp format and malformed production origins.
- Non-JSON/null/primitive success responses are rejected instead of allowing save callers to discard unfinished content. Cancellation remains cancellation, and non-JSON error bodies retain their HTTP status. Browser tests verify that a failed save survives reload and can be retried.
- Cancelling conflicted edits refreshes the server detail before reopening the editor. A desktop/mobile regression confirms that the latest title, question, answer key and version can be edited and saved without refreshing the browser.
- The answer-cleanup effect now has complete dependencies and a stable callback. ESLint checks hooks and unused code with zero warnings allowed; TypeScript also checks unused locals/parameters and includes all test fixtures.
- Updated vulnerable source-map-js and shell-quote dependencies; concurrently's pinned shell-quote dependency uses a compatible patched override. `npm audit --audit-level=low` reports **0 vulnerabilities**. Supported Node versions are 22.13+ within 22.x, or 24+; Node 23 is excluded because ESLint 10 does not support it.
- A narrowly scoped Vite transform corrects two invalid PURE-directive references in Zod 4.6.5 prose comments. Executable code and real optimization annotations remain unchanged; warning reporting is not disabled. Production builds now emit no warnings. Playwright also avoids passing contradictory NO_COLOR/FORCE_COLOR variables to child processes.
- CI actions use pinned current releases and Node 24 runtimes; the runner is explicitly Ubuntu 24.04. CI includes dependency auditing and the production-container verification described above.
- Reviewing the first successful hosted run's full logs also found npm install-script and PostgreSQL initialization warnings. The reviewed esbuild installation script is approved only for its locked version through npm's `allowScripts` policy. PostgreSQL images use Bookworm's system locales and explicit SCRAM authentication; maintenance commands receive the existing database password. Ephemeral CI runners initialize Git with the repository's actual `main` branch name. These changes configure the causes rather than filtering warning output. See [npm script approvals](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/) and [PostgreSQL image initialization](https://hub.docker.com/_/postgres).

Current local evidence (Node 24.5.0, macOS ARM64):

| Check                                     | Result                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                           | Passed: lint, all TypeScript targets, process/web/API regressions, production build and compiled-entry smoke                |
| PostgreSQL suite, isolated port 55433     | **47 passed**, 0 failed, 0 skipped; includes multi-connection concurrency and termination recovery                          |
| PGlite suite                              | **40 passed**, 0 failed; 7 PostgreSQL-only checks skipped and verified separately above                                     |
| Development process regressions           | **5 passed**                                                                                                                |
| Frontend response-handling regressions    | **6 passed**                                                                                                                |
| Desktop/mobile Chromium browser suite     | **22 passed**; protection scenarios also assert no unhandled page errors or browser warnings                                |
| Dependency audit                          | **0 vulnerabilities** at all severities                                                                                     |
| Prettier and whitespace checks            | Passed                                                                                                                      |
| Compiled application backup/restore drill | Passed; all 10 table counts/digests, credential revocation and historical scores verified                                   |
| Synthetic query script                    | Completed against a fresh `_bench` database; 50 successful requests per route; see [measurement and limits](PERFORMANCE.md) |

The recovery and benchmark JSON files now record this audit's runs. Recovery copied the fixture in 2,966 ms and restored/verified it in 2,512 ms; these are local measurements, not recovery guarantees. Computer Use also exercised the current teacher UI: validation, creating/saving/publishing a synthetic assignment, class-member confirmation, account navigation and the 390px editor. The two injected-response/concurrent-editor boundaries are established by automated browser tests, not claimed as manual fault injection. The normal `.local/database` was never opened by this audit.

Hosted verification is recorded per commit in [GitHub Actions](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml). The `check` job runs the complete suite on PostgreSQL; `container` independently validates the built production environment. Neither job constitutes public deployment, production disaster recovery, long-duration load testing or physical iOS/Safari validation.
