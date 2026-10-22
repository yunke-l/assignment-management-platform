# API v0.3

Base path `/api`. JSON requests/responses; UUID identifiers; accepted uppercase hex digits are normalized to lowercase before identity comparisons and idempotency hashing. Browser requests use the same-origin HttpOnly session cookie. API clients can use `Authorization: Bearer <opaque token>` returned by login/registration. Unsafe browser requests must carry the exact configured Origin. This release replaces the starter's JWTs: old credentials must sign in again.

Errors contain `{statusCode,message,requestId}` and responses include `x-request-id`. Validation errors return 400, unauthenticated/expired/revoked sessions 401, wrong roles/Origin 403, missing or other-owner resources 404, version/finality conflicts 409, oversized JSON bodies 413, unsupported request encodings 415, rate limits 429, unexpected failures 500. Internal error details are not sent to clients. JSON parsing is bounded at 2 MiB; multipart media uses a separate streamed limit. Individual text limits and the total UTF-8 payload limit both apply. Timestamp responses use ISO 8601 with a time-zone designator; input deadlines must also include a time zone.

## Sessions and registration

| Method | Path           | Behavior                                                                                                                     |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| POST   | /auth/login    | `{email,password}` → `{user,token,expiresIn:604800}` plus cookie; 10 attempts/minute/IP                                      |
| POST   | /auth/register | `{email,name,password,invitation}`; 12–128-character password, invite determines role; logs in after atomic account creation |
| GET    | /auth/me       | Current actor `{id,name,email,role}`                                                                                         |
| POST   | /auth/logout   | Revokes the supplied current session and clears cookie; idempotent                                                           |
| POST   | /auth/password | `{currentPassword,newPassword}`; requires authentication, revokes all sessions and clears cookie                             |

No public endpoint creates teacher invitations: use `npm run accounts -- invite-teacher EMAIL`. A class invite creates a student account, while a teacher invite is single-use and email-bound. Expired/revoked/exhausted invites return 400. Duplicate accounts return 409 without consuming an available invitation. Existing students should sign in and join through `/classes/join`.

## Classes and invitations

| Method | Path                                    | Role and behavior                                                                                         |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | /classes                                | Authenticated; owned/enrolled classes `{id,name}[]`                                                       |
| POST   | /classes                                | Teacher; `{name}` (1–100 trimmed characters)                                                              |
| POST   | /classes/join                           | Student; `{invitation}`; joins current membership, never adds historical assignments                      |
| GET    | /classes/:id/members?page=1&pageSize=20 | Owner; paged `{id,name,email}` members, ordered by name/id                                                |
| DELETE | /classes/:id/members/:studentId         | Owner; removes membership and revokes past assignment access; retains grades                              |
| POST   | /classes/:id/invitations                | Owner; `{expiresInHours:48,maxUses:1}`; hours 1–168, uses 1–100; returns metadata plus a one-time `token` |
| GET    | /classes/:id/invitations                | Owner; usable invitations, including usage/expiry metadata, never token/hash                              |
| DELETE | /classes/:id/invitations/:invitationId  | Owner; revokes invitation; repeated revocation is safe                                                    |

Invitation tokens are 43-character base64url values. Membership changes, publication and invitation consumption coordinate through the classroom row lock. Repeated join by an existing member does not consume another use, provided the invitation is still usable. Removed recipients remain revoked even if the student rejoins.

## Assignments

| Method | Path                                            | Behavior                                                                                                            |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | /assignments                                    | Scoped list; supports `page`, `pageSize`, `classId`, `status`, `search`                                             |
| POST   | /assignments                                    | Teacher; creates draft and questions atomically                                                                     |
| GET    | /assignments/:id                                | Owner/active recipient; students cannot read drafts or answer keys                                                  |
| PATCH  | /assignments/:id                                | Owner; complete draft content plus current `version`; stale version 409; cannot change its class                    |
| DELETE | /assignments/:id                                | Owner; deletes a draft and its questions atomically; published work returns 409                                     |
| POST   | /assignments/:id/publish                        | Owner; explicit `{version}` (legacy) or `{schemaVersion:2,version}`; freezes audience; repeated publication is safe |
| POST   | /assignments/:id/submissions                    | Student active recipient; final answers plus a request UUID                                                         |
| GET    | /assignments/:id/stats                          | Owner; `{enrolled,submitted,averagePercent}`                                                                        |
| GET    | /assignments/:id/submissions?page=1&pageSize=20 | Owner; paged roster with submission/null and removed flag                                                           |

Pages are `{items,total,page,pageSize}`; page starts at 1 and page size is 1–50. Assignment sort is `createdAt DESC,id DESC`; title search is a trimmed case-insensitive literal substring (SQL wildcards have no special meaning). DRAFT filters drafts, PUBLISHED filters published and unexpired, CLOSED filters published and due. Stored `status` remains DRAFT/PUBLISHED; CLOSED is derived from the database clock. Count and items share a repeatable-read snapshot within one request; navigation between pages is not a frozen dataset.

### Legacy create/edit example

```json
{
  "classId": "30000000-0000-4000-8000-000000000001",
  "title": "Reading comprehension",
  "description": "Choose one answer per question.",
  "dueAt": "2035-10-01T18:00:00Z",
  "questions": [
    {
      "prompt": "Which word is a noun?",
      "options": ["Book", "Quickly"],
      "correctIndex": 0,
      "points": 10
    }
  ]
}
```

Use a future timestamp with a timezone. PATCH uses the same fields plus `version` from the latest detail response. Edits replace question IDs; clients must read the returned detail. Published question IDs/content are immutable. See `packages/contracts/src/index.ts` for exact limits.

### Legacy submission example

```json
{
  "requestId": "40000000-0000-4000-8000-000000000001",
  "answers": [{ "questionId": "QUESTION_UUID_FROM_DETAIL", "selectedIndex": 0 }]
}
```

All questions must be answered exactly once with valid option indices. The server grades from stored answers; supplied scores or unknown properties are rejected. An exact replay (including reordered answers) returns the same saved result, even after the deadline, if the student's access remains active. Different answers or assignment with the same request ID return 409. A different request ID cannot create a second final submission. New submissions at or after the database deadline return 409.

Result: `{id,assignmentId,score,maxScore,submittedAt}`; initial submission and exact replay return 201. The UUID is an idempotency identifier, not an authentication credential. Student detail includes their result but never `correctIndex`.

### Report shape

```json
{
  "items": [
    {
      "studentId": "STUDENT_UUID",
      "name": "Sam Chen",
      "email": "student@example.test",
      "removed": false,
      "submission": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Non-null submission uses the result fields above. Published denominators include all recipients frozen at publication, including later removals. Average percentage only includes saved submissions; no submissions means null. Draft previews use the current membership and do not expose students to draft content.

## Structured questions (schema version 2)

The browser sends `schemaVersion:2` on create, update, publish, validation and submission. Read detail, stats and the submission roster with `?schemaVersion=2`; legacy plain choice reads default to version 1 and reject incompatible structured questions. Exact fields, discriminated unions and limits are defined in `packages/contracts/src/questions.ts` and `grading.ts`.

`POST /assignments` accepts `{schemaVersion:2,classId,title,description,dueAt,questions}`; PATCH adds `version`. Drafts may have no questions or incomplete keys/configuration, but IDs, references and structural limits must be valid. V2 replacement preserves existing question IDs. `POST /assignments/:id/validate` accepts `{schemaVersion:2,version,questions?}` and returns `{valid,version,errors}`. An optional question snapshot checks the current unsaved editor content and its teaching assets without saving it; omitting it checks the saved draft. Both modes enforce teacher ownership and the saved draft version. Publishing repeats all question, resource, version and deadline checks under locks. Validation errors include safe `{questionId?,path,code,message}` entries for positioning feedback.

Every question has `{id,parentId,position,type,prompt,answerAreaContent,points,evidenceEnabled,explanation,config,answerKey}`. `COMPOSITE` is a top-level `READING` or `GENERAL` container with zero points and only leaf children. Other types are `SINGLE_CHOICE`, `FILL_BLANK`, `CLOZE_CHOICE`, `GROUPING`, `MATCHING`, `ORDERING`, and manually graded `RESPONSE`. Maximums: 20 roots, 100 leaves, 200 scoring units; child nesting is forbidden. Only positive integer leaf/unit points are accepted. Ordering `initialOrder` is generated and persisted by the server, distinct from every private acceptable answer; clients never shuffle a private key.

Content is an allowlisted AST: paragraph, heading, list, image and audio blocks identified by UUID. Text inlines allow bold/italic; fill/cloze prompt blanks reference persistent blank IDs. Image/audio blocks reference private `assetId` values and neutral public labels/captions; images require an alternative description for publication. HTML, arbitrary attributes, external resource URLs and unknown fields are rejected. Teacher explanations, keys, private exemplars and transcripts are omitted from student projections.

### V2 final submission

`POST /assignments/:id/submissions` takes `{schemaVersion:2,publishedVersion,requestId,answers}`. Each answer has `{questionId,type,payload,evidenceAssetIds}`. Payloads:

| Type          | Payload                           |
| ------------- | --------------------------------- |
| SINGLE_CHOICE | `{optionId}`                      |
| FILL_BLANK    | `{blanks:[{blankId,text}]}`       |
| CLOZE_CHOICE  | `{blanks:[{blankId,optionId}]}`   |
| GROUPING      | `{placements:[{itemId,groupId}]}` |
| MATCHING      | `{pairs:[{leftId,rightId}]}`      |
| ORDERING      | `{orderedItemIds,confirmed:true}` |
| RESPONSE      | `{text,assetIds}`                 |

All leaves appear exactly once; containers cannot receive answers. IDs must belong to the frozen question. Weighted fill, cloze, grouping and matching give per-unit partial credit; ordering is all-or-nothing. Fill matching trims outer Unicode whitespace, normalizes NFC and optionally folds ASCII case; punctuation, accents and interior whitespace remain significant. The request hash canonicalizes unordered ID collections but retains raw text and sequence order. Exact retries preserve the saved result even after the deadline when access remains active. Final results include `gradingStatus`, objective totals, nullable final `score`, `maxScore`, `gradingVersion`, `gradedAt` and `submittedAt`. Any manual response keeps the final score null until the teacher publishes grading.

`GET /assignments/:id/submissions/:submissionId` is restricted to the owning teacher or that submission's active student. It returns answers and results; teacher results include per-unit scoring, grading draft and revision history. Student results expose only their answers, released feedback and allowed aggregate grades. Draft grades, correctness, scoring units, explanations and keys remain private. Stats and per-question/unit analyses exclude pending final scores from final averages and return null for empty denominators.

### Manual grading

`PATCH /submissions/:id/grading` accepts `{gradingVersion,answers:[{questionId,dimensions:[{dimensionId,score}],feedback}]}`. Partial drafts are allowed, including missing dimensions; unknown dimensions and out-of-range/noninteger scores are rejected. Each save advances `gradingVersion`; stale saves return 409. Teacher grading drafts never alter published scores or student feedback.

`POST /submissions/:id/grading/publish` accepts `{gradingVersion,requestId,reason}`. All required rubric scores must be present; publication atomically updates manual/final totals, released feedback and an immutable revision. Adjustments after a published grade require a reason. Exact publish retries return the same revision; divergent use of a request ID conflicts. There is no API for arbitrary supplied final totals.

## Private media

| Method   | Path                                                     | Behavior                                                                                                                                |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | /assets/uploads                                          | `{uploadRequestId,assignmentId,questionId,contentNodeId,purpose,kind,name,mime,bytes}`; idempotent init returns metadata + `uploadUrl`  |
| POST     | /assets/uploads/:id/content                              | Multipart with exactly one `file` part; bytes must match declaration; returns PROCESSING                                                |
| GET      | /assets/:id                                              | Authorized metadata; status, safe error, original byte count, dimensions/duration and proxy URLs                                        |
| GET      | /assets?assignmentId=UUID                                | Owner's active temporary files with bound flags for cleanup                                                                             |
| PATCH    | /assets/:id                                              | Exactly one of `{transcript}` (teacher, unpublished teaching resource) or `{caption}` (student, own unsubmitted answer before deadline) |
| DELETE   | /assets/:id                                              | Owner's unbound file only; bound published/submitted files are protected                                                                |
| GET/HEAD | /assets/:id/content?variant=display\|thumbnail\|original | Reauthorizes every request; supports one byte range; original is a teacher-only attachment                                              |

Original names and private transcripts are never sent to students. Answer captions are public to their author and grading teacher and freeze at final submission. URLs are same-origin authenticated proxies, contain no bearer credentials, and issue `private,no-store` plus `nosniff`. Students access only public published teaching references and their own answer files; removed recipients lose subsequent media access. Teacher access to student answer originals starts only after submission.

Input formats: JPEG, PNG, static WebP (10 MiB); MP3, PCM WAV, AAC-LC M4A (50 MiB, up to 600 fully decoded seconds). Extension, MIME, magic signature and a real decoder must agree. Images correct orientation, strip metadata and generate PNG/thumbnail outputs; audio strips metadata and produces a safe MP3 without denoising. Animation, corrupt/oversized media and unsupported codecs fail closed. Media never goes into question JSON or public static hosting.

Quota enforcement combines DB-locked declarations, streamed exact-byte validation and final binding checks. Upload init: 30/minute/account; active transfers: 3/account. Temporary teaching workspace: 120 files/400 MiB per draft; student workspace: 60 files/200 MiB per assignment. Bound teaching: 100 distinct files/300 MiB; final student answers including evidence: 30 files/100 MiB. Per-location and per-question count/byte limits also apply. Failed/cancelled resources release workspace quota. Required answer paths must fit the final capacity before publication; optional uploads reserve capacity for remaining required answers.
