# API v0.2

Base path `/api`. JSON requests/responses; UUID identifiers; accepted uppercase hex digits are normalized to lowercase before identity comparisons and idempotency hashing. Browser requests use the same-origin HttpOnly session cookie. API clients can use `Authorization: Bearer <opaque token>` returned by login/registration. Unsafe browser requests must carry the exact configured Origin. This release replaces the starter's JWTs: old credentials must sign in again.

Errors contain `{statusCode,message,requestId}` and responses include `x-request-id`. Validation errors return 400, unauthenticated/expired/revoked sessions 401, wrong roles/Origin 403, missing or other-owner resources 404, version/finality conflicts 409, oversized JSON bodies 413, unsupported request encodings 415, rate limits 429, unexpected failures 500. Internal error details are not sent to clients. JSON parsing is bounded at 512 KiB, enough for the maximum assignment permitted by the contract, including Unicode text. Timestamp responses use ISO 8601 with a time-zone designator; input deadlines must also include a time zone.

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

| Method | Path                                            | Behavior                                                                                         |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | /assignments                                    | Scoped list; supports `page`, `pageSize`, `classId`, `status`, `search`                          |
| POST   | /assignments                                    | Teacher; creates draft and questions atomically                                                  |
| GET    | /assignments/:id                                | Owner/active recipient; students cannot read drafts or answer keys                               |
| PATCH  | /assignments/:id                                | Owner; complete draft content plus current `version`; stale version 409; cannot change its class |
| DELETE | /assignments/:id                                | Owner; deletes a draft and its questions atomically; published work returns 409                  |
| POST   | /assignments/:id/publish                        | Owner; publishes an unexpired draft and freezes its audience atomically; repeats are safe        |
| POST   | /assignments/:id/submissions                    | Student active recipient; final answers plus a request UUID                                      |
| GET    | /assignments/:id/stats                          | Owner; `{enrolled,submitted,averagePercent}`                                                     |
| GET    | /assignments/:id/submissions?page=1&pageSize=20 | Owner; paged roster with submission/null and removed flag                                        |

Pages are `{items,total,page,pageSize}`; page starts at 1 and page size is 1–50. Assignment sort is `createdAt DESC,id DESC`; title search is a trimmed case-insensitive literal substring (SQL wildcards have no special meaning). DRAFT filters drafts, PUBLISHED filters published and unexpired, CLOSED filters published and due. Stored `status` remains DRAFT/PUBLISHED; CLOSED is derived from the database clock. Count and items share a repeatable-read snapshot within one request; navigation between pages is not a frozen dataset.

### Create/edit example

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

### Submission example

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
