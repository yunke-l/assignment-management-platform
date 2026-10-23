# Local application acceptance

Scope: the local application and deployment preparation described in [Architecture](ARCHITECTURE.md). Acceptance covers browser functionality and mobile-browser layouts. The application has no provisioned public deployment.

## Scope and evidence

| Area                          | Implementation and evidence                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local startup and persistence | npm workspaces, React frontend, NestJS API, PostgreSQL migrations, and an embedded PGlite demo; [startup instructions](../README.md#run-locally-no-docker-required)                                                          |
| Accounts and classes          | Teacher invitations, student registration, revocable sessions, class invitations and membership management; HTTP and browser workflow tests                                                                                  |
| Assignment authoring          | Seven scored question types, reading/general groups, private teaching media, draft recovery, previews, publication checks and immutable published questions; [requirements and acceptance mapping](MULTI_TYPE_ACCEPTANCE.md) |
| Submissions and grading       | Server-side objective grading, manual rubric drafts, grade publication/history, submission retries and student answer attachments; API and browser regressions                                                               |
| Historical membership rules   | Recipients frozen at publication; removed students lose access while teachers retain grades; [business rules](ARCHITECTURE.md) and workflow tests                                                                            |
| Navigation and usability      | Separate list/detail/editor URLs, list-state restoration, browser back/forward, keyboard interaction and mobile layouts; navigation, appearance and protection tests                                                         |
| Recovery                      | Isolated paired database/media restore drill with logical digests, credential revocation and historical-grade checks; [recovery manifest](evidence/recovery.json)                                                            |
| Query measurements            | Reproducible synthetic PostgreSQL workloads and raw plans/latencies; [methods and limits](PERFORMANCE.md)                                                                                                                    |
| Deployment preparation        | Docker, Compose, Caddy, pinned CI, migrations and backup/restore procedures; [deployment guide](DEPLOYMENT.md)                                                                                                               |

See [Verification](VERIFICATION.md) for dated results and environments, and the [README gallery](../README.md#screenshots) for current screenshots. Test counts belong to their recorded runs; source hosting and successful CI do not constitute public application deployment.

## Follow-up release checks

Public domain/HTTPS, target-environment container execution, production PostgreSQL backup/restore, sustained load, physical devices and comprehensive accessibility validation require separate acceptance in the intended environment. Synthetic data and local latency samples do not establish real adoption, production user scale or uptime guarantees.
