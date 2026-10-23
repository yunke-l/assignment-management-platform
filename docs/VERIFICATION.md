# Verification record

This record covers local application checks and deployment preparation. The latest checks are in [Repository cleanup, 2026-10-23](#repository-cleanup-2026-10-23). The dated sections below distinguish baseline checks from later changes; test counts apply to their recorded runs.

## Repository cleanup, 2026-10-23

Reviewed all 92 tracked TypeScript/JavaScript source, configuration, script, and test files. Import tracing from application, CLI, test, and script entry points found no unreachable source files. Dependency inspection confirmed that `@nestjs/platform-express`, `rxjs`, and `@mantine/hooks` remain required peer dependencies despite having no direct application imports.

Removed:

- Twelve superseded screenshots and workflow recordings (1,723,336 bytes), replaced by the five current screenshots below. Test-generated videos remain available through CI artifacts.
- Eighty-four unused CSS rules and five unused entries in shared selector lists from previous login/editor layouts, plus the unused `--yellow` variable. Dynamic state selectors and Mantine-generated class selectors were retained.
- The obsolete account-navigation icon branch, the uncalled legacy draft-deletion method now handled by `MultiTypeService.remove`, and the unused `SubmissionRow` and `ResponseQuestion` types.
- Superseded September/October 7 verification summaries and obsolete design descriptions; acceptance and screenshot references now match the current application.

Historical SQL migrations, active API compatibility paths, local-work migration, regression tests, performance/recovery manifests, and deployment files remain in use. Local databases, media, backups, private documents, and installed tools were not modified by this cleanup.

| Check                                  | Result                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                        | Passed: lint, all TypeScript targets, 5 process tests, 25 frontend tests, 83 API tests, production build and compiled-entry smoke |
| PostgreSQL-only API cases              | 7 skipped in the isolated PGlite run; PostgreSQL was not rerun for this cleanup                                                   |
| Complete desktop/mobile Chromium suite | 68 passed                                                                                                                         |
| Final account-icon cleanup             | Lint, web type check/build and 2 desktop/mobile appearance reruns passed                                                          |
| Visual inspection                      | Desktop editor and mobile sign-in/workspace screenshots inspected                                                                 |
| Formatting and repository whitespace   | Passed                                                                                                                            |
| Documentation references               | All 8 retained evidence files referenced; no broken local file links or heading anchors                                           |

Checks used Node 24.5.0 on macOS ARM64 and the installed Chrome executable. API and browser tests used isolated synthetic databases.

## Current visual evidence

Screenshots captured from the current local application on 2026-10-23:

- [Desktop sign-in](evidence/readme-login.png)
- [Teacher workspace](evidence/readme-workspace.png)
- [Assignment editor](evidence/readme-editor.png)
- [Teacher results](evidence/readme-teacher-results.png)
- [Mobile student result](evidence/readme-student-mobile.png)

The capture used an isolated in-memory database and synthetic accounts. A teacher created and published an assignment, a student submitted it, and the teacher report showed the saved grade. All five screenshots were visually inspected; the capture checked for unhandled page errors and horizontal page overflow. The mobile view uses Chromium phone emulation.

Browser tests generate screenshots, videos, traces, and an HTML report in `test-results/` and `playwright-report/`. CI retains these as workflow artifacts. Superseded screenshots and recordings are no longer stored in the source tree.

## Recovery and performance evidence

The [recovery drill](../scripts/recovery-drill.mjs) validates paired database/media restoration, credential revocation, and retained historical grades using a separate synthetic fixture. Its [raw manifest](evidence/recovery.json) records the environment, table digests, media hashes, and assertions. It does not open `.local/database` or the database configured in `.env`.

[Query measurements](PERFORMANCE.md) retain the methods, raw results, and limitations for the list/report workload and the maximum-count multi-type workload. These local measurements do not establish production capacity or an SLA.

## Remaining external verification

- Hosted check results are recorded per commit in [GitHub Actions](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml). Local results do not establish that a hosted run passed.
- The CI `container` job builds and smoke-tests the production image with PostgreSQL and validates Caddy configuration. Public TLS, target-environment load, and production PostgreSQL backup/restore require validation before deployment; see [deployment and recovery](DEPLOYMENT.md).
- Browser coverage uses Chromium desktop and mobile viewports. Physical-device Safari/Android and a comprehensive assistive-technology audit remain separate checks.

## Multi-type upgrade, 2026-10-08

Scope: the complete local implementation of [multi-type requirements](MULTI_TYPE_QUESTIONS_PRD.md), including private media, manual grading, historical-data compatibility and browser work recovery. [The acceptance map](MULTI_TYPE_ACCEPTANCE.md) links all 45 requirements to tests and explicitly identifies device/deployment checks still pending.

Current local checks use Node 24.5.0 on macOS ARM64. PostgreSQL 17.10 reports x86_64; its disposable, loopback-only cluster is stopped after verification. No test opens or migrates the existing `.local/database`.

| Check                           | Result                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full check                      | Passed: zero-warning lint, API/web/scripts/test TypeScript, production build and compiled-entry smoke                                                            |
| PostgreSQL HTTP/database suite  | **87 passed**, 0 failed, 0 skipped; independent connections, concurrent submissions/grades, cleanup binding and termination recovery                             |
| PGlite HTTP/database suite      | **80 passed**, 0 failed; the same 7 PostgreSQL-only cases are verified above                                                                                     |
| Frontend pure regressions       | **16 passed**; API response validation, required attachment reservations, legacy work migration and late-save upload preservation                                |
| Development process regressions | **5 passed**                                                                                                                                                     |
| Desktop/mobile viewport Chrome  | **30 passed**; multi-type editing/submission, actual image/audio, stable option IDs, keyboard interactions, work/retry recovery and grading                      |
| Paired backup/restore           | Passed: 15 table counts/logical SHA-256 digests plus 5 original/derived media SHA-256 checks, restored media playback and grades                                 |
| Maximum-count mixed workload    | 20 roots, 100 leaves, 200 units; 50 concurrent requests per operation, all successful; see [performance evidence](PERFORMANCE.md#multi-type-workload-2026-10-08) |

Prettier, whitespace checks and the recovery script lint passed. The current dependency audit returned **0 vulnerabilities**.

Real media checks include exactly 10 MiB PNG and 50 MiB PCM WAV, 600-second decoded audio, malformed/signature/dimension/pixel/codec rejection, private GET/HEAD/Range, persistent expired-lease recovery, shared-file undo and cleanup races. Metadata-only attachment fixtures are clearly marked and are not substituted for decoding evidence.

A later acceptance audit added real three-stream account concurrency (a fourth stream returns 429; another account continues; abort releases the slot) and the exact 9/10 graded + pending + unsubmitted statistics fixture. The final PostgreSQL run passed all 87 cases. Five additional independent workflow databases each passed all 12 workflow cases, including 12 simultaneous exact retries after the deadline (60 such retries in total). The updated workflow also passed separately on PGlite.

An intermediate PostgreSQL run returned one unexpected 401 on an after-deadline exact retry. The stored synthetic student sessions were active and unexpired when inspected. The cause was not established; it did not recur in the five independent runs or the final complete suite. The test now asserts session validity and records the safe response body on failure. Authentication logic and acceptance criteria were not relaxed. This observation is retained for future diagnosis rather than described as a proven fix.

Browser checks use the installed Chrome executable because the cached Playwright browser was absent. The mobile project uses a 390px iPhone viewport with Chromium. A supplementary desktop/mobile mixed-question run also checks editor, answer and grading layouts at 320, 360, 390 and 768px, with no page-level horizontal overflow. New question action buttons have a minimum 44px height; the order-confirmation control is checked at each tested viewport. Per the user’s updated scope, acceptance requires browser functionality and mobile browser UI, without physical-device verification. The new production container, current hosted CI, target-environment load/media latency and production PostgreSQL paired recovery are future deployment checks, outside this browser delivery. Configuration alone does not establish those results or physical Safari/Android compatibility. This supersedes earlier evidence totals without claiming all environments are defect-free.

## Question-authoring P1 fixes, 2026-10-20

Six authoring issues are addressed: typed newlines in accepted fill answers survive editing; unit-scored totals derive from their units; publication checks provide a focused summary with links to individual fields; checks validate the current unsaved snapshot and discard late responses after further editing; removal undo preserves subsequent edits and supports successive removals; publication requires reviewing the class, current recipients, deadline, question count, total points and immutable publication consequences.

Local checks use isolated PGlite databases and desktop/mobile Chromium viewports. They do not modify `.local/database`.

| Check                        | Result                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and TypeScript          | Passed                                                                                                                                                                                                                                          |
| Production build             | Passed                                                                                                                                                                                                                                          |
| Frontend regressions         | **21 passed**, including removal history and totals for every unit-scored question type                                                                                                                                                         |
| API/database regressions     | **81 passed**, 0 failed; 7 PostgreSQL-only checks skipped in this PGlite run                                                                                                                                                                    |
| Existing browser regressions | **28 passed** across desktop/mobile: mixed types, actual uploads, work protection and the teacher/student workflow                                                                                                                              |
| New P1 browser regressions   | **10 passed** across desktop/mobile: typed newline and persisted answers, derived totals, error focus and exact-option navigation, unsaved snapshot and late-response isolation, successive removal undo, publish confirmation and cancellation |
| Layout inspection            | Desktop/mobile validation-summary and publish-confirmation screenshots inspected                                                                                                                                                                |

The new API regression verifies that snapshot validation leaves saved questions and their version unchanged, reports the exact invalid option, and preserves version, ownership and role checks. New browser tests are in `e2e/authoring-p1.spec.ts`. An initial run exposed an unstable implicit label on the accepted-answers textarea after typing; an explicit accessible label fixed it, and the complete new P1 suite then passed.

## Authoring interaction redesign, 2026-10-20

The scoring, error-navigation and check-feedback interactions now share a review panel. Desktop uses a sticky sidebar; narrower layouts place a compact panel above the editor, with bounded issue lists and collapsible question groups. The initial mobile state suppresses explanatory copy until a check is requested.

Scoring appears before each question's content. Whole-question scores remain editable; unit-scored questions show a read-only total, a breakdown and links to the unit point inputs. The assignment overview updates its total immediately and provides links to individual question scores. Empty configurations explain how to add scoring units.

Publication review distinguishes not checked, checking, checked, edited since checking and interrupted checks. Local content and teaching-file verification are described separately. Editing invalidates the file-check result immediately and late responses remain ignored. Service failures display a retryable check error separately from question issues. Hints appear after an explicit check, update while editing and do not interrupt typing. Errors are grouped by assignment details and question; the first-issue action follows that order. Field navigation moves keyboard focus, and focused invalid controls expose their actual correction text through accessible descriptions.

Validation: 21 frontend regressions passed. The existing 28 desktop/mobile browser cases passed; the expanded authoring suite passed all 14 desktop/mobile cases, including interrupted-check recovery, state transitions, scoring navigation, accessible error descriptions and grouped issue navigation. Layout checks cover 320, 390, 768 and 1280px without page-level horizontal overflow. Lint, TypeScript and the production build passed. Screenshots were inspected for desktop and mobile layouts. These are local Chromium checks, with no deployment or physical-device verification implied.

## Simpler question-type editing, 2026-10-20

This refinement simplifies the existing editor without changing question schemas or scoring rules. Rich text, media, short labels, matching modes, response limits, optional evidence and private explanations remain available through expandable settings. Choosing a file opens the upload tools so progress and cancellation stay visible.

| Type                         | Simplified authoring flow                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single choice                | Write options and mark the correct answer on its option card                                                                                                     |
| Fill in the blanks           | Short instructions explain adding and placing blank markers, with alternative accepted answers on separate lines                                                 |
| Cloze choices                | Mark each blank's correct answer on its option card                                                                                                              |
| Grouping                     | Create categories, then assign each item on its own card                                                                                                         |
| Matching                     | Create possible matches first, then choose each item's match on its card; reuse rules remain expandable                                                          |
| Ordering                     | Write cards, then explicitly set the correct order; additional valid orders remain supported                                                                     |
| Written/image/audio response | Choose answer formats with checkboxes, then add plainly named grading criteria; detailed requirements stay expandable and their current values remain summarized |
| Shared/reading group         | Explain shared material once and add independently scored child questions                                                                                        |

The new `e2e/simple-authoring.spec.ts` acceptance case authors all seven scored types and a reading group with a child question through the actual UI. It saves nine questions, validates the persisted keys, verifies custom matching/response requirements and runs the saved draft's publication check. Existing browser coverage also exercises actual image/audio uploads, private materials, undo, recovery and concurrent-save protection. Desktop/mobile grouping and response screenshots were inspected.

Final local verification: **44 desktop/mobile browser cases passed**, including upload cancellation and overlapping saves; **21 frontend regressions passed**. Lint, TypeScript, the web production build, formatting and whitespace checks passed. No backend schema or scoring rules changed in this refinement.

## Assignment list/detail navigation, 2026-10-20

The assignment list, detail, new-assignment editor and existing-draft editor now have separate URLs. Class and account navigation also use URLs. Production serves the application entry for these routes on direct visits and refreshes, while API and missing-asset requests retain their normal 404 responses.

Returning to the list restores its submitted search, class/status filters, page, unfinished search text, scroll position and assignment focus. Navigation memory is scoped to the account and browser tab, with an in-memory fallback when storage is unavailable. Browser back/forward preserves local assignment and answer work, confirms leaving password fields, and blocks leaving during a pending save. Resuming grading from an already-open detail page reopens the corresponding review.

Validation: **58 desktop/mobile Chromium browser cases passed**, including eight new navigation cases and the existing authoring, submission, grading and protection flows. **21 frontend tests passed**; the PGlite API suite had **81 passed, 7 PostgreSQL-only skips**. Lint, all TypeScript targets, production build, compiled-entry route smoke, formatting and whitespace checks passed. Desktop list and mobile detail screenshots were inspected. These checks used isolated synthetic data; no deployment or physical-device verification was performed.
