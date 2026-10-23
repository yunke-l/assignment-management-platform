# Synthetic-data query measurements

This is one local measurement run, not evidence of production capacity or user scale. Raw machine information, timestamps, HTTP measurements, and full execution plans are in [benchmark.json](evidence/benchmark.json). The script is `scripts/benchmark.ts`.

## Environment and method

- Date: 2026-10-07; macOS ARM64, 8 logical CPUs, Node 24.5.0.
- PostgreSQL 17.10: the packaged binary reports x86_64; the host Node reports arm64. This local test environment is not equivalent to a production Linux container.
- 20 synthetic classes, 2,000 synthetic students, 2,000 assignments, 200,000 fixed-recipient records, and 100,000 submissions, plus 2 classes and 4 accounts from the demo seed.
- One API process, pg pool limit 10; each endpoint receives 5 warm-up requests followed by 50 concurrent HTTP requests, all successful.
- The same HTTP listening port is reused. Measurements include session validation, business SQL, and JSON responses. Database and client are local; data has been ANALYZEd and caches are relatively warm.
- The sample-generation transaction alone has a relaxed 120-second limit; application queries retain the 10-second limit. The database must be empty and its name must end in `_bench`; the script does not clear existing databases.
- Synthetic IDs use deterministic RFC-variant UUID v8 values. Converting MD5 directly to UUID can produce version or variant bits that violate API contracts; this generation issue was fixed before remeasurement.

## Results

| Endpoint                                                            | P50      | P95      | Maximum  |
| ------------------------------------------------------------------- | -------- | -------- | -------- |
| Assignment list (including authorization and pagination)            | 38.41 ms | 52.31 ms | 52.53 ms |
| Student submission details (including authorization and pagination) | 20.51 ms | 29.82 ms | 30.11 ms |

EXPLAIN execution time was 0.416 ms for the list query and 0.195 ms for the report query. These are the extracted main queries alone, not complete HTTP latency.

## Index assessment

In this sample, the list scans only 2,000 assignments; the plan selects a sequential scan and top-N sort. Reports use `assignment_recipients_pkey` and `submissions_assignment_id_student_id_key` by assignment_id, then join student data. No slow query requiring a new index was measured at this scale, so existing indexes were retained without claiming before/after optimization gains.

Titles use case-insensitive literal substring matching; the existing B-tree cannot directly optimize arbitrary substrings. Larger data volumes, complex title searches, and concurrent changes across pages need remeasurement, with pg_trgm or cursor pagination considered if necessary.

This samples only one round of 50 requests, without evidence for sustained stability, cold caches, cross-network access, write pressure, or real user distributions. List P95 was 717.67 ms on 2026-09-24 and 52.31 ms in this run. No query or index changes were made for this measurement, so the difference cannot be attributed to code optimization. This run met the development plan's example 300 ms threshold without establishing stable capacity. Isolated main-SQL execution plans cannot explain complete HTTP tail latency; connection-pool waits, event-loop behavior, and multiple request distributions still need collection in a stable, isolated target environment. A single run does not establish a production SLA.

## Multi-type workload, 2026-10-08

A local measurement was added using a multi-type fixture at the maximum allowed counts. Raw results are in [multi-type-benchmark.json](evidence/multi-type-benchmark.json), using [benchmark-multi-type.ts](../scripts/benchmark-multi-type.ts). Test time: 2026-10-09T05:13:29.983Z. Node 24.5.0, macOS ARM64, 8 logical CPUs; PostgreSQL 17.10 reports x86_64. One API process, pg pool limit 10, local HTTP client and database, warmed reads.

The assignment contains 20 top-level questions, 100 leaves, and 200 scoring units, covering six objective types and reading/general containers. Public JSON is 137,042 bytes; answer JSON is 29,931 bytes. Reaching allowed counts does not mean every field simultaneously reaches its text or 2 MiB limit. Each endpoint receives 50 concurrent requests. Submissions use separate students, sessions, and requestId values; all succeeded on the first attempt with server-calculated scores of 200/200.

| Operation                       | P50       | P95       | Maximum   | Proposed threshold for this version |
| ------------------------------- | --------- | --------- | --------- | ----------------------------------- |
| Authorized public metadata read | 114.80 ms | 187.55 ms | 193.88 ms | P95 ≤ 1,000 ms                      |
| Objective-only final submission | 200.87 ms | 286.80 ms | 288.48 ms | P95 ≤ 1,000 ms                      |

This run meets the local threshold without establishing an SLA for the target deployment. The script rejects nonempty databases and requires names ending in `_multi_bench`; the isolated PostgreSQL instance was stopped afterward. The run provides no performance evidence for media transfer, cold caches, cross-network access, sustained pressure, target containers, or physical phones. Browser tests separately cover on-demand media loading and actual playback; this table does not measure media network latency. The production environment requires requirement-based revalidation, recording multiple distributions and recovery points.
