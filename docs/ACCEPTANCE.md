# Local version delivery acceptance

> The 2026-09-24 content below is historical. For the 2026-10-08 upgrade covering multiple question types, media, manual grading, and compatibility, see [Implementation and 45-item acceptance mapping](MULTI_TYPE_ACCEPTANCE.md) and [Latest verification](VERIFICATION.md#multi-type-upgrade-2026-10-08). Per the user's latest requirements, this acceptance covers browser functionality and mobile-browser UI, without requiring physical-device validation. Container and target deployment checks are deferred until release; historical CI results cannot validate these uncommitted changes.

Date: 2026-09-24. Scope covers the product and business rules described in [Architecture](ARCHITECTURE.md): complete the local version and deployment preparation, keep the application local, and adjust it based on feedback.

## Scope and evidence

| Requirement                                 | Delivery and acceptance evidence                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product definition and business rules       | [Architecture](ARCHITECTURE.md) documents system structure, roles, authorization, assignment lifecycle, and historical grade retention                                                                                                           |
| Full-stack initialization and local startup | npm workspaces, shared contracts, React pages, NestJS API, SQL migrations, PGlite demo, and PostgreSQL support; [README](../README.md) provides installation and startup commands                                                                |
| Accounts, sessions, and class management    | Controlled teacher invitations, student invitation-code registration, class creation/joining, invitation expiry/usage limits/revocation, member pagination/removal, HttpOnly sessions, and revocation on password change                         |
| Assignment creation through results         | Draft creation/preview/editing/deletion, version conflict detection, publication, one student submission, server-side grading, teacher statistics, and student details                                                                           |
| Confirmed historical assignment rules       | Recipients frozen at publication; no old assignments for new members; removal immediately revokes read/write access while teachers retain grades; rejoining does not restore old access; covered by HTTP and browser workflows                   |
| Correctness and failure handling            | 39 tests passed against real PostgreSQL, covering ownership authorization, sessions, transaction rollback, multi-connection concurrency, database deadline boundaries, submission idempotency, UUID normalization, and consistent read snapshots |
| Browser usability                           | 6 desktop/mobile-viewport tests passed, covering both roles, refresh persistence, retry after lost responses, keyboard operation, empty states, error recovery, session expiry, and option editing; screenshots and workflow recordings saved    |
| Query and performance evidence              | Filtering, stable sorting, pagination, report definitions, and synthetic-data execution plans; [Performance record](PERFORMANCE.md) explains methods, samples, and limitations                                                                   |
| Local persistence and recovery              | Demo database backed up before upgrade; isolated synthetic PGlite database validated offline copy/restore, integrity comparisons for 10 tables, credential revocation, and historical results; [Recovery evidence](evidence/recovery.json)       |
| Build and deployment preparation            | Type checks, production build, and compiled-entry smoke checks passed; Docker, Compose, Caddy, CI, migration, rollback, and recovery documentation supplied                                                                                      |

See [Verification](VERIFICATION.md) for exact check counts and environments. Source, configuration, and synthetic demo evidence are stored in the [GitHub repository](https://github.com/yunke-l/assignment-management-platform); dependencies, databases, environment variables, and runtime artifacts are excluded from version control. The application continues to run locally; hosted CI results are available in [Actions](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml).

## Outside this delivery scope

- Domain, HTTPS, and public application deployment: pending platform selection. GitHub source hosting and CI do not deploy the application.
- Docker builds/container execution: subsequent code review added the CI `container` check; use Actions results for the corresponding commit. Production PostgreSQL backup/restore still needs acceptance in the target environment.
- Physical-device Safari, a full assistive-technology audit, sustained load, and production capacity: local Chromium or one synthetic test run cannot replace these.
- Example performance target: the two local list-query P95 measurements varied considerably. Although the latest run was below 300 ms, this does not establish stable capacity; multiple runs in the target environment are required.

The local delivery scope above is complete. Verification establishes that the listed scenarios passed, without promising defect-free software. Subsequent feedback should become reproducible issues, fixes, and corresponding regression checks.
