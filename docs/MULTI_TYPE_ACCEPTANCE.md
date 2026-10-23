# Multi-type and media upgrade: implementation and acceptance record

This record covers the development described in the [Requirements document](MULTI_TYPE_QUESTIONS_PRD.md). Date: 2026-10-08 (Vancouver; test evidence uses 2026-10-09 UTC). Per the user's latest requirements, acceptance covers browser functionality and mobile-browser UI, without physical-device validation. Evidence below uses desktop Chrome and mobile viewports. Container and target deployment checks are follow-up release work and do not block this delivery. Local results and older CI records are not production deployment evidence.

## Implemented scope

- Teacher editing, duplication, reordering, preview, incomplete draft saves, publication-error navigation, and versioned publication. Supports single choice, fill-in-the-blank, cloze choice, grouping, matching, ordering, and manual responses; reading/general composites use one-level containers with answerable children.
- Images/audio in prompts, answer-area materials, and options. Students can upload answer attachments; objective evidence is separated from manual scoring. Attachment captions freeze on submission; teaching originals and teacher transcripts remain private.
- Server validation by stable IDs, objective grading, submission idempotency, frozen published content, manual rubric drafts, grade publication, and revision history with reasons. Statistics distinguish pending, graded, and not submitted.
- Streaming uploads, real image decoding and audio decoding/transcoding, durable job leases, authorized access proxy, Range support, account quotas, resource binding, grace-period cleanup, and coordinated database/media recovery.
- Append-only migrations 004–006 preserve historical questions/grades and support legacy single-choice requests. Browser recovery preserves original copies of old drafts; unchanged legacy submissions retain their original request IDs.

## Evidence entry points

| Key | Automated evidence                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q   | [Question contracts and grading tests](../apps/api/test/questions.test.ts)                                                                                                  |
| A   | [Multi-type HTTP and database tests](../apps/api/test/multi-type-api.test.ts)                                                                                               |
| M   | [Real media, authorization, quota, cleanup, and lease tests](../apps/api/test/assets.test.ts)                                                                               |
| L   | [Version, deadline, authorization, and real PostgreSQL concurrency tests](../apps/api/test/lifecycle.test.ts), [Original workflow tests](../apps/api/test/workflow.test.ts) |
| U   | [Historical database upgrade tests](../apps/api/test/multi-type-migration.test.ts), [Browser draft migration tests](../apps/web/test/work-migration.test.ts)                |
| B   | [Mixed-type browser workflow](../e2e/multi-type.spec.ts), [Work recovery and upload races](../e2e/protection.spec.ts)                                                       |
| C   | [Required attachment capacity reservation tests](../apps/web/test/answer-capacity.test.ts)                                                                                  |
| P   | [Maximum legal assignment workload script](../scripts/benchmark-multi-type.ts), [Raw performance results](evidence/multi-type-benchmark.json)                               |
| R   | [Recovery drill script](../scripts/recovery-drill.mjs), [15-table and media verification manifest](evidence/recovery.json)                                                  |

Tests use synthetic data, in-memory PGlite, or newly created temporary PostgreSQL instances. Existing `.local/database` was not opened, upgraded, or cleaned. Media decoding tests use real files; attachment rows in A are explicitly labeled binding-validation fixtures, not evidence of file decoding.

## Local coverage of 45 requirements

“Coverage” means the behavior is implemented and supported by the local evidence below; it does not mean every device and deployment condition has passed acceptance. Where tests use equivalent fixtures with different points, the test assertions are authoritative. Requirement example values are not reported as separate measured results.

| ID   | Covered behavior                                                                                                           | Evidence and limitations                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AC01 | Image/audio options, option reordering, grading by stable ID, playback without selection                                   | Q, A, B                                                                                                                            |
| AC02 | Trimming and explicit case rules                                                                                           | Q, A                                                                                                                               |
| AC03 | Apostrophes, accents, NFC, repeated whitespace; no autocorrection                                                          | Q                                                                                                                                  |
| AC04 | Independent blank weights; missing blanks rejected                                                                         | Q, A                                                                                                                               |
| AC05 | Per-blank cloze grading; options from other blanks rejected                                                                | Q, A, B                                                                                                                            |
| AC06 | Blank/answer-key consistency; regenerated IDs on duplication                                                               | Q, U, B                                                                                                                            |
| AC07 | Reading-child scoring and progress; no parent score                                                                        | Q, A, B                                                                                                                            |
| AC08 | Nested, orphaned, and cross-assignment parents rejected                                                                    | Q, A                                                                                                                               |
| AC09 | Grouping partial credit, irrelevant within-group order, duplicate items rejected                                           | Q, A, B                                                                                                                            |
| AC10 | Occupied one-to-one targets do not overwrite answers; many-to-one works                                                    | Q, B                                                                                                                               |
| AC11 | Matching distractors need not be used                                                                                      | Q, A                                                                                                                               |
| AC12 | Explicit ordering confirmation; changes revoke confirmation; incorrect sequence scores zero                                | Q, U, B                                                                                                                            |
| AC13 | Multiple accepted sequences; duplicate/missing cards rejected                                                              | Q, A                                                                                                                               |
| AC14 | Equivalent permutations of visibly identical cards validated                                                               | Q                                                                                                                                  |
| AC15 | Incomplete drafts saved; precise publication errors; hidden from students                                                  | Q, A, L, B                                                                                                                         |
| AC16 | Save/publication version conflicts preserve browser edits                                                                  | A, L, B; legacy publication requests also require a version                                                                        |
| AC17 | Published content, answer keys, points, and resource bindings frozen                                                       | A, L, M                                                                                                                            |
| AC18 | Real 10 MiB PNG and 50 MiB PCM WAV decoded; declared limit +1 byte returns 413; actual-byte mismatch rejected              | M; no leftover quota/upload events                                                                                                 |
| AC19 | Invalid formats, signatures, corruption, pixel limits, animated WebP, ADPCM WAV, and ALAC M4A rejected                     | M; AAC-LC M4A and MP3 actually transcoded                                                                                          |
| AC20 | 600-second boundary, excessive duration rejected, real playback and speed control                                          | M, B; actual browser play, pause, speed, and Range passed                                                                          |
| AC21 | Durable lease recovery, failure states, no revival after cancellation, attachment refresh, interleaved saves/uploads       | M, B                                                                                                                               |
| AC22 | Resource ownership, question context, originals, GET/HEAD/Range authorization                                              | M, A                                                                                                                               |
| AC23 | Student removal revokes reading, playback, and submission; teachers retain historical access                               | M, L, B                                                                                                                            |
| AC24 | Concurrent temporary quota reservation, at most 3 active transfers, release on failure; independent final attachment limit | M: fourth transfer rejected, account isolation, cancellation release; A: 150 MiB references rejected atomically without binding; C |
| AC25 | Grace-period revocation/recovery after reference deletion; retention for multiple references                               | M, U                                                                                                                               |
| AC26 | Cleanup races: failed draft binding fully rolls back; resources retained after successful publication/submission           | M, rerun against real PostgreSQL; expired-answer cleanup isolated by deadline + 7 days                                             |
| AC27 | Required attachments, READY state, ownership, correct question and type                                                    | M, A, B, C                                                                                                                         |
| AC28 | Wrong objective answer plus photo still scores zero; attachment saved without manual conversion                            | A                                                                                                                                  |
| AC29 | Mixed and manual-only submissions pending; final score null; statistics do not count them as zero                          | Q, A, B                                                                                                                            |
| AC30 | Grade publication, revision reasons, historical versions, consistent student final results                                 | A, B, R                                                                                                                            |
| AC31 | Rubric bounds/completeness and private drafts; no changes to student final results                                         | A, B                                                                                                                               |
| AC32 | Grading versions, concurrency, exact retries; recovery after lost save response                                            | A, B; canonical comparisons support JSONB object-key order                                                                         |
| AC33 | One graded 9/10, one pending, one not submitted: submitted=2, graded=1, pending=1, average=90                              | A, L                                                                                                                               |
| AC34 | averagePercent=null when there are no graded results                                                                       | A, L                                                                                                                               |
| AC35 | Missing/extra questions, parents, cross-question IDs, and client scores rejected; no partial bindings left by transactions | A, Q, L                                                                                                                            |
| AC36 | Normalized retries for unordered sets; changes to original text and ordering detected                                      | Q, A, L                                                                                                                            |
| AC37 | Concurrent final-submission uniqueness and duplicate requests                                                              | A, L, real PostgreSQL with multiple connections                                                                                    |
| AC38 | Database deadline decisions; exact retries after success while access remains valid                                        | L, A                                                                                                                               |
| AC39 | Student public projections and resource metadata; isolation of teacher examples/transcripts/unpublished grading            | M, A, B, R                                                                                                                         |
| AC40 | Historical data/request compatibility, old browser drafts, and original retry identity recovery                            | U, A, B                                                                                                                            |
| AC41 | Count, unit, Unicode, resource, and JSON limits; required attachment capacity reservation                                  | Q, A, M, C, B; independent frontend/backend validation                                                                             |
| AC42 | Native grouping selectors, matching buttons/selectors, ordering buttons/position selectors; no drag dependency             | B: desktop keyboard and mobile-viewport taps; not a full assistive-technology audit                                                |
| AC43 | Desktop/mobile-viewport uploads, proxy playback, and UI adaptation                                                         | B: Chrome workflows and 320/360/390/768px layouts passed; physical devices not required                                            |
| AC44 | 20 top-level questions, 100 leaves, 200 units, 50 concurrent reads/objective submissions; on-demand media                  | P, B: proposed local 1-second threshold met; recheck target environment at release                                                 |
| AC45 | Coordinated data and original/derived media restoration, checking files and historical submissions/grades                  | R: local coordinated restore passed; recheck production PostgreSQL coordinated recovery at release                                 |

## Browser acceptance and follow-up release checks

The development machine needs executable `ffmpeg` and `ffprobe`, or environment variables `FFMPEG_PATH` and `FFPROBE_PATH`. Sharp uses lockfile dependencies. Configure private storage through `ASSET_DIRECTORY`; production requires an absolute path and persistent volume. Before connecting existing data, back up the database and media, then run `npm run db:migrate` and use the existing startup flow. New-feature tests do not replace real-data backups or automatically upgrade the existing demo database.

```sh
npm run check
npm run test:e2e
npm run test:recovery
npm run format:check
npm audit --audit-level=low
```

Real PostgreSQL tests use `TEST_DATABASE_URL` for a dedicated test database. Performance scripts require `BENCH_MULTI_DATABASE_URL` to point to an **empty database** whose name ends in `_multi_bench`; existing databases are not cleared. Tests use temporary media directories, not teaching-file storage.

Browser acceptance used the installed Chrome. The complete desktop and 390px mobile-viewport suite passed 30 tests. Additional mixed-type checks at 320, 360, 390, and 768px covered teacher editing (including image/audio options and answer-area materials), student answers (including attachments), and teacher grading, without page overflow. New question-type action buttons have at least 44px tap height; assertions check ordering-confirmation buttons at each viewport. Real-file uploads, image zoom, audio play/pause/speed, answer recovery, submission, and final grades passed. Screenshots are in the locally ignored `test-results/` directory. These viewport tests are not certification for every mobile browser engine.

At formal deployment, recheck container execution, target PostgreSQL/media restoration to the same recovery point, multiple load runs, and media download latency. Docker/Caddy configuration and CI now include FFmpeg, Sharp, and private-media-volume checks. Docker is not installed on the current development machine; this delivery did not build containers or run hosted CI for these changes. These follow-up tasks are not unfinished items for this browser delivery.

The legacy workflow once returned a 401 that could not be reproduced. See [Latest verification](VERIFICATION.md#multi-type-upgrade-2026-10-08) for rerun results and retained diagnostics.
