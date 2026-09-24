# Verification record

Date: 2026-09-24. Delivery scope confirmed by the user: local application plus deployment preparation; no public deployment in this task.

## Completed checks

| Check                                                         | Result                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TypeScript: API, web, scripts, HTTP tests and E2E definitions | Passed                                                                   |
| HTTP/database suite on PostgreSQL 17.10                       | **39 passed**, 0 failed, 0 skipped                                       |
| Same suite on isolated in-memory PGlite                       | **34 passed**, 0 failed, 5 PostgreSQL-only cases intentionally skipped   |
| Contracts, NestJS and Vite production build                   | Passed                                                                   |
| Built Node entry serving compiled web assets and API          | Passed: HTML, JS asset, migration, login, class read and DB health       |
| Playwright desktop and mobile viewport workflows              | **6 passed**, 0 failed; Chromium 153                                     |
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

- Docker is not installed on this host. Dockerfile, Compose and Caddy configuration are supplied, but their container/TLS deployment must be tested on a Docker host.
- No remote Git repository was configured or pushed, and hosted GitHub Actions has not run.
- No public domain/HTTPS deployment, production backup restore, failover or long-running load test has been completed. See [deployment and recovery](DEPLOYMENT.md) for the commands and acceptance steps.
- Mobile coverage uses Chromium viewport/touch emulation, not physical iOS/Safari hardware. This is not a comprehensive assistive-technology audit.
- Vite builds report two non-failing third-party Zod PURE-comment warnings; the compiler strips those comments and the generated application passes the built-entry smoke test.

Do not describe synthetic data sizes, this single local latency sample, or generated implementation as production users, uptime guarantees, measured commercial impact or independently demonstrated interview proficiency.
