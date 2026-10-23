# English education platform: multiple question types, images, and audio requirements

Version: 1.1\
Date: October 8, 2026\
Audience: product, design, frontend, backend, QA, and operations\
Status: requirements baseline (browser acceptance scope updated)\
Scope: assignment authoring, student answers, submission, grading, results, and resource management

This upgrade lets teachers assign fill-in-the-blank, cloze choice, reading, grouping, matching, ordering, and composite questions, using images and audio in prompts and answer areas. Students can upload image/audio answers where teachers allow them. Delivery must cover the complete authoring-to-results workflow, rather than adding question-type buttons while retaining single-choice data and grading logic.

“Must” denotes acceptance requirements for this version; “default” describes behavior without configuration changes. Question rules, count limits, file specifications, and new endpoints are proposed for this version, not claims of existing implementation. Features marked “future” are outside acceptance scope. Changes agreed during development review must update contracts, interface descriptions, tests, and this document together; frontend and backend must not decide separately.

## 1 Existing capabilities and upgrade goals

### 1.1 Existing project baseline

The baseline below describes shared contracts, assignment services, teacher editors, and student pages before this upgrade. See [Implementation and acceptance](MULTI_TYPE_ACCEPTANCE.md) for upgrade status.

| Area                       | Current behavior                                                              | Change in this version                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Question types             | Plain-text single choice, 2–6 options per question                            | Retain single choice; add the specified types and composite structures                                         |
| Assignment capacity        | At most 20 questions                                                          | Retain 20 top-level questions; add total leaf/scoring-unit limits                                              |
| Points                     | Integer 1–100 per question, server-graded                                     | Leaves remain integer 1–100; add scoring per unit and manual grading                                           |
| Content                    | Prompts/options are strings                                                   | Structured content blocks referencing independently uploaded images/audio                                      |
| Submission                 | Every question required; one final submission per student                     | Validate all answerable leaves; retain one-submission rule                                                     |
| Drafts                     | Server saves require complete valid questions; edits detect version conflicts | Permit incomplete questions; fully validate at publication                                                     |
| Unfinished work            | Same-tab sessionStorage with navigation protection                            | Extend to multi-type answers and resource IDs; no file binaries in browser storage                             |
| Grades                     | Total score returned on submission; teacher lists/averages                    | Distinguish pending/graded; final average includes graded submissions only                                     |
| Answer visibility          | Student APIs never return correct answers, including after submission         | Retain this; answer keys/rubric references stay teacher-only; public assessment dimensions visible to students |
| Attachments/manual grading | Not implemented                                                               | Add resource lifecycle, authorization, and complete manual-grading workflow                                    |

Retain these business rules: teachers manage only their own classes/assignments; publication freezes recipients; new members do not receive old assignments; student removal immediately revokes old assignment access/submission while teachers retain history; rejoining does not restore old access. Published assignments cannot be edited or deleted. CLOSED remains derived from deadlines, rather than a new stored state.

### 1.2 Teaching goals and user tasks

| User       | Task                                                                  | Success condition                                                         |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Teacher    | Combine vocabulary, grammar, reading, listening, and expression tasks | Choose suitable types, configure answers/points, preview as a student     |
| Student    | Read/listen to materials and complete varied interactions             | Work on phone/computer, recover unsubmitted answers, retry failed uploads |
| Teacher    | Review objective results and grade image/audio/open responses         | Access original answers/attachments and publish accurate final grades     |
| Operations | Maintain teaching resources and student-answer files                  | Control access, clean orphaned resources, include files in backup/restore |

Completion means all section 13 acceptance cases pass. Per the user's latest requirements, this delivery covers browser functionality and mobile-browser UI, without physical-device validation. Use desktop Chrome and mobile viewports, emphasizing editing, answering, uploading, and grading at 320, 360, 390, and 768 pixels. Target-environment container execution, capacity, and backup/restore are follow-up release checks that do not block this browser delivery. Local tests do not promise production performance. Teaching effectiveness, completion rates, and learning gains require measurement after launch; no improvement percentage is promised beforehand.

## 2 Scope and shared terminology

### 2.1 First-version scope

This version includes existing single choice, fill-in-the-blank, cloze choice, grouping, matching, ordering, reading groups, general composites, and manually graded responses for image/audio answers. Images/audio serve three purposes: teacher prompt materials, teacher answer-area materials, and student answer attachments.

“Grouping” categorizes words, sentences, or media cards; it does not change student class groups or assignment allocation. “Matching” initially supports one-to-one and many-to-one, excluding one-to-many/many-to-many. “Ordering” lets students reorder words, sentences, paragraphs, or media cards; teacher question reordering is separate.

“Reading” is shared material with child questions; a “general composite” is a shared prompt with children. Neither is an independent answer format. Reading is a teaching template using the same underlying composite model.

### 2.2 Terms and counts

| Term                 | Definition                                                                  | Example                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Top-level question   | Standalone question or group directly in an assignment                      | Question 1: fill-in-the-blank; question 2: reading group                                                                     |
| Container question   | Shared materials and child organization only; no answer or score of its own | Reading group, general composite                                                                                             |
| Leaf question        | Childless question requiring a student answer                               | Single choice, fill-in-the-blank, cloze choice, grouping, matching, ordering, manual response                                |
| Scoring unit         | Smallest independently scored object                                        | One blank, cloze blank, grouping item, or matching left item; single choice, ordering, and manual response each count as one |
| Answer-area material | Teacher-provided content for understanding/interaction                      | Image options, audio matching items, explanatory image above blanks                                                          |
| Answer attachment    | File uploaded by a student as an answer or evidence                         | Handwritten-answer photo, reading-aloud audio                                                                                |

Allowed hierarchy: “assignment → top-level leaf” or “assignment → container → leaf.” Containers cannot contain containers. Cloze blanks are scoring units, not third-level questions.

Example: a reading group with 3 single-choice questions and 1 two-blank question counts as 1 top-level question, 4 leaves, and 5 scoring units. Its total is the sum of the 4 leaf scores, without extra parent points.

### 2.3 Future scope

Multiple-select, true/false, shared-word-bank blanks, many-to-many matching, nested containers, AI grading, automated speech scoring, OCR, in-browser recording, video/PDF attachments, question banks and cross-assignment media libraries, multiple attempts, playback-count limits, cross-device answer synchronization, immediate answer-key release, and grade export are deferred. This version uploads existing recordings without automatically requesting microphone access.

## 3 Roles and pages

| Page or feature                     | Teacher permissions                                                      | Student permissions                                                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Question editor                     | Edit own drafts; configure types, materials, answers, points, rubrics    | None                                                                      |
| Question preview                    | Switch teacher/student views                                             | No draft access                                                           |
| Published assignment                | Read-only content and answer configuration                               | Read own student projection only as an active publication recipient       |
| Upload prompt/answer-area materials | Own drafts only                                                          | None                                                                      |
| Upload answer attachments           | Cannot answer on behalf of students                                      | Upload-enabled leaves in currently answerable assignments only            |
| View submissions/grading            | All submissions for own assignments, including removed students' history | Own submissions only, while assignment access remains valid               |
| Read/listen to attachments          | Teaching materials and student answers for own assignments               | Authorized teaching materials and own answers; no other students' answers |

No new user-facing administrator role. Storage, cleanup, and failures use existing operational permissions.

## 4 Requirements by question type

### 4.1 Single choice SINGLE_CHOICE

Retain 2–6 options with exactly one correct answer. Options use stable optionId values; new-version answers no longer use array indexes. Each option can contain text, images, audio, or combinations and cannot be empty. Media requires a navigable name or description.

Students select one option; selecting another replaces the previous choice. Audio playback controls only the player and must not select the option. Correct answers receive full points; incorrect answers receive 0. New teacher questions have no correct answer selected by default. Deleting the correct option requires a new answer selection, without automatically marking another option correct.

Example: play “ship” and “sheep” audio options and ask for the word matching the prompt image. Correctness binds to the audio card ID, not player position.

### 4.2 Fill-in-the-blank FILL_BLANK

**Teaching uses:** word forms, collocations, prepositions, tenses, phrases, and dictation.

Teachers insert blanks in structured prompts, identified by blankId and displayed in occurrence order as blank 1, blank 2, etc. Each question has 1–20 blanks supporting words/phrases. Each blank has 1–10 accepted answers, each 1–200 characters and nonempty after normalization, integer points, a case policy, and optional teacher-only explanation. Inserting/moving blanks preserves IDs. Deletion removes associated answer configuration/points and provides undo.

Students enter at most 200 characters per blank. Every blank is required; whitespace-only input is unanswered. Incorrect input is a valid answer; clients must not prevent submission based on correctness.

Matching rules must agree across frontend/backend and appear in the teacher UI:

1. Normalize answer keys and student input to Unicode NFC.
2. Trim surrounding whitespace and collapse consecutive internal whitespace to one ordinary space.
3. Ignore English A–Z case by default; teachers can enable case sensitivity per blank. Do not apply ambiguous language-dependent conversions to other characters.
4. Preserve punctuation, hyphens, apostrophes, digits, and accents strictly by default. Do not strip punctuation, autocorrect spelling, or use fuzzy matching.
5. An exact normalized match to any accepted answer earns full points for that blank; otherwise 0. Sum blank scores.

Thus `London` matches `london`, and `a   lot` matches `a lot` by default; `its` differs from `it's`, `don't` differs from `do not`, and curly `don’t` differs from straight `don't`. Teachers must explicitly enter accepted variants. Duplicate variants after normalization cannot be saved twice.

Example: `She [blank 1] to school every day.`, with only `goes` accepted, worth 2 points. `go` is valid input but scores 0.

### 4.3 Cloze choice CLOZE_CHOICE

**Teaching uses:** vocabulary, cohesion, and grammar in passage context. Use the consistent product name “Cloze choice.”

Teachers edit continuous material with 1–20 blanks, each with its own 2–6 options, one correct optionId, and points. Images/audio may be attached. Each blankId occurs exactly once and corresponds one-to-one with its configuration.

Students click a blank to choose an option. Mobile uses a nearby expansion or bottom selection panel without obscuring the current sentence. Selected text appears in the passage; image/audio options show a short label and a viewing action. Numbers and answered states are clear. Each blank accepts one option; the question is complete only after all blanks are answered.

Score blanks independently and sum them. Options are local to each blank, without a shared word bank. Choosing a word in one blank does not disable an option with the same text elsewhere.

Example: `Tom was tired, [blank 1] he finished his homework.`, options `but / because / or`, correct `but`. Earning any points does not require every blank to be correct.

### 4.4 Reading group COMPOSITE with READING

**Teaching uses:** main idea, details, reference, inference, passage structure, and comprehension.

Teachers add shared reading material combining text, images, and audio, then 1–10 leaf children. Multiple sections and clear material titles are allowed. Children may be single choice, fill-in-the-blank, cloze choice, grouping, matching, ordering, or manual response. Each child independently specifies its question, answer method, and points.

On sufficiently wide desktops, provide side-by-side material/questions with independently scrollable materials. On mobile, support expanding/collapsing material and returning to the current child. Viewing material must not clear answers or reset playback. Display child numbers such as 2.1 and 2.2; internal identity uses IDs rather than display numbers.

Parents have no separate input, answer, or extra points. Progress counts leaves. Shared material itself has no automatic answer blanks; place blanks in fill-in-the-blank/cloze children to avoid undefined links between shared materials and child answers.

Example: a passage on urban transport with 2 detail single-choice questions, 1 vocabulary blank, and 1 manual task to read a paragraph aloud and upload audio. The first three are automatic; the last awaits teacher grading.

### 4.5 Grouping GROUPING

**Teaching uses:** parts of speech, semantic categories, inflection rules, and countable/uncountable nouns.

Teachers configure 2–8 categories and 2–20 items. Categories have stable groupId values, names, and optional materials; items have stable itemId values and text/images/audio. Each item has exactly one correct category and independent points. No distractor item may lack a correct category; explicitly create “Other” if needed. Every category must have at least one correct item.

Students drag items or use “select item → click category/use category selector.” Each item belongs to only one category; moving it removes it from the old category. Items can return to the unclassified area. Category capacity is unlimited; do not reveal expected item counts that could disclose answers.

Submission is allowed once every item is categorized. Each correct item earns its points, otherwise 0. Within-group order does not affect grading.

Example: classify `apple / banana / carrot / onion` into `Fruit / Vegetable`, worth 1 point each; 3 correct yields 3/4.

### 4.6 Matching MATCHING

**Teaching uses:** meanings, synonyms, images/words, questions/answers, and audio/text associations.

Teachers configure 2–20 left items and 2–30 right items, each with stable IDs and text/images/audio. Each left item has exactly one correct right target and points; right-side distractors are allowed. Teachers must choose a mode:

| Mode                | Teacher validation                                                                    | Student constraint                                    |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ONE_TO_ONE, default | Correct targets cannot repeat across left items; at least as many right items as left | Each right target used by at most one left item       |
| MANY_TO_ONE         | Several left items may share a correct target                                         | A right target can be selected by multiple left items |

Students can drag connections or click a left item then a right item. Provide a connection list or selectors for keyboard/small screens. Each left item has at most one connection; changing target replaces its old connection. Canceling again or clearing returns it to unconnected.

In one-to-one mode, an occupied target prompts the student to clear the existing connection first, without silently deleting another answer. Many-to-one must not disable used targets. All left items must be connected; not every right item must be used. Score each left item, rather than the number of drawn lines.

Example: left `cat / dog`; right corresponding images plus a bird distractor. One correct connection at 2 points each yields 2/4. Initial matching row positions must not serve as answer keys.

### 4.7 Ordering ORDERING

**Teaching uses:** word order, dialogue sequences, event order, and paragraph structure.

Teachers configure 2–20 cards with stable itemId values and text/images/audio, plus complete correct sequences. The first version accepts up to 5 complete sequences for multiple valid arrangements. Each sequence contains every itemId exactly once; contradictory partial-order rules are not allowed.

Students use move-up/down or move-to-position controls. The complete displayed arrangement is the answer, including an unchanged initial arrangement, without separate confirmation. Changes update it automatically; refresh restores the same sequence.

The first version grades the whole question: an exact match to any accepted sequence earns full points; otherwise 0. Do not award partial credit by position, adjacency, or longest common subsequence, which could produce hard-to-explain scores for invalid sentences.

When saving a complete ordering configuration, the server generates an independent shuffled starting sequence that avoids all accepted answers, persists it as public configuration, and uses it in student preview. Saving unrelated fields does not reshuffle unchanged cards/answers. Card or accepted-sequence changes trigger validation and a new starting sequence if needed. Freeze this configuration at publication so refreshes and all students see the same first-version order; do not send correct sequences to the frontend for shuffling. If every permutation is accepted, publication must reject the question and request a rewrite because no ordering task remains.

Cards with identical content still have distinct IDs. Publication validation must not require students to distinguish hidden identities of identical text or identical media combinations. Merge repeated words into phrases or explicitly configure all equivalent accepted sequences. Rewrite questions needing more than 5 equivalent sequences. Teachers check whether different files convey the same content in preview; automatic image/audio semantic-equivalence detection is not required.

Example: cards `I / like / reading / .`, correct `I like reading .`. After seeing a shuffled sequence, students must interact or explicitly confirm; the system must not submit an answer merely from the initial state.

### 4.8 General composite COMPOSITE with GENERAL

Teachers configure a shared prompt, optional images/audio, and 1–10 leaf children. Hierarchy, progress, and scoring match reading groups; teaching purpose and default wording differ.

Uses include listening to a dialogue then choosing answers/filling keywords, or viewing an image then matching/classifying. Each child can have its own prompt/materials. Shared media is referenced and displayed once, without duplicated storage per child or automatic playback when expanding children.

Deleting a parent deletes its children; show the impact before execution and support undo while editing. Duplicating a parent generates new IDs for every question, option, blank, and card, remapping internal answer relationships. Immutable media can be reused within the same assignment. Cross-assignment copying is excluded initially.

### 4.9 Image/audio and open response RESPONSE

This additional answer format enables student uploads. In the add-question UI it appears as “Upload and open response,” either standalone or as a reading/general-composite child.

Teachers enable text, images, audio, or combinations, with at least one enabled. Configure required text and minimum/maximum image/audio counts. Disabled methods have minimum/maximum 0; enabled image/audio has a maximum of at least 1. Minimums can be 0 but cannot exceed maximums. Enabled text is limited to 2,000 characters.

Every configuration must require nonempty text or at least one valid attachment, never allow an empty answer. Examples: 1–3 images with optional text; 1 audio with optional text; required text with optional images; either an image or audio, with both category minimums 0 but at least one attachment overall.

Teachers must configure total points and a usable rubric. Rubrics have 1–10 dimensions, each with a name, description, and positive integer maximum; dimension maxima sum to the question points. A single “Overall performance” dimension is allowed. Dimensions, requirements, and maxima are public before answering. Reference answers, demonstration audio, and grading anchors are separate teacher-only fields. The system does not infer correctness from image content or audio duration.

Example: upload reading-aloud audio, worth 10 points, with pronunciation clarity 4, accuracy 4, and fluency 2. Successful upload/processing means only that the attachment is ready; students still submit the whole assignment, and teachers determine the score.

## 5 Shared authoring and answering rules

### 5.1 Teacher authoring workflow

1. Enter assignment title, class, and a future deadline; add standalone questions or groups.
2. Select each leaf's type and edit prompts, answer-area instructions, and interactive items.
3. Configure answer keys or rubrics, points, and allowed answer attachments.
4. Save a draft. Before the first upload, create a server draft to obtain assignmentId and save the question/content-location IDs that will reference resources. Zero-question drafts are allowed, but publication needs at least one top-level question and one leaf.
5. Review the publication checklist and fix question, answer, point, and resource errors.
6. Preview desktop/mobile layouts as a student, then publish to the current class.

Draft saves require valid title/class/deadline, structural fields, and ID references. Prompts, answer keys, and rubrics can be incomplete, and resources processing within this draft may be referenced. Publication requires complete content and all referenced resources READY. Deleted items cannot remain in answer keys. Incomplete drafts do not justify arbitrary JSON, unauthorized resources, or invalid hierarchies.

The editor provides type labels, moving, duplication, deletion, group collapse, total points, and completion status. Moving changes display order only, preserving IDs/answers. Saves retain version protection; 409 keeps local edits and guides reload/manual merge without automatically overwriting the server.

Changing type clears incompatible configuration. First explain the blanks, options, answers, point rules, and children that will be removed, with cancellation available. Retain compatible prompt media and answer-area instructions. Do not implicitly convert between containers and leaves. Editing confirmations are separate from the rule prohibiting changes to published content.

### 5.2 Publication validation

The server must validate within one consistent publication flow:

- The assignment belongs to the teacher, is a draft, has a future deadline, and matches the expected version.
- Top-level, leaf, scoring-unit, and resource counts meet this version's limits.
- Containers contain only leaves, without cycles, orphans, or cross-assignment references.
- Every leaf has clear teaching instructions. Body text can be absent only with valid material and a short instruction.
- Options, cards, and blanks are complete; answer-key references exist; blank occurrences match configuration one-to-one.
- Objective answer keys are complete; manual rubrics/input methods are valid.
- Each leaf has integer points 1–100, equal to the sum of scoring-unit points.
- All referenced resources are readable, valid for their purpose, and fully processed, without failed/pending-upload placeholders.
- Status update, content/resource freezing, and recipient snapshot happen atomically.

New publication requests carry the expected version; check it on first publication only. If already published and still owned by the caller, repeated requests return the existing publication without rebuilding recipients. Do not silently publish content updated in another tab after the current preview.

### 5.3 Student answers and unfinished work

The directory/progress shows “completed leaves / total leaves,” excluding parents. Multi-blank/item questions can show internal progress. Complete means structurally valid input, not a correct answer.

Save all answer states, uploaded assetId values, current ordering sequences, and retry requestId within the same tab. sessionStorage records include schemaVersion, userId, assignmentId, and publication-version identity. Recovery revalidates ID sets and resource states. Do not persist files, base64, temporary Blob URLs, or expiring access URLs as answers.

Uploaded attachments still retained can be previewed again by assetId after refresh. Uploading/unprocessed files recover as pending or explicitly require reselection, never as “submitted.” Temporary Blob URLs serve only this page's local preview. Logout clears same-tab unsubmitted work, retaining existing navigation/logout confirmation behavior.

Cross-tab/device recovery is not guaranteed initially. Concurrent final submissions are decided by the database's one-submission constraint; the losing client loads saved results without overwriting winning answers. If browser storage is unavailable, show “Not saved yet; keep this page open,” without claiming reliable draft persistence.

### 5.4 Submission completeness

A submission must contain exactly one answer for every leaf and none for parents. Internal blanks, items, sequences, and attachments must meet requirements. Reject duplicate question/internal IDs, unknown IDs, other assignment IDs, other students' resources, client scores, and answer keys.

Every leaf is required. Skipping questions or submitting unanswered questions for zero is excluded initially. Images/audio cannot replace required objective choices, blanks, grouping, matching, or ordering answers.

Before submission, show leaf completion, attachment readiness, the one-submission notice, and final confirmation. Only a server-confirmed saved submissionId permits a success state and local-answer cleanup. Network timeouts preserve the original request/answers without automatically generating a second submission.

## 6 Images and audio

### 6.1 Locations and scoring relationships

| Location                                                | Uploader | Capability                                                      | Scoring effect                                                   |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Leaf prompts and parent shared material                 | Teacher  | Insert images, audio, and explanatory text in content order     | Teaching material; no automatic points                           |
| Answer-area instructions                                | Teacher  | Images/audio above input or interaction controls                | Instructions, not student answers                                |
| Options, grouping items, matching items, ordering cards | Teacher  | Text/media combinations; media-only items have accessible names | Graded by item IDs and answer-key relationships                  |
| RESPONSE answer area                                    | Student  | Images/audio/text according to teacher configuration            | Manual grading                                                   |
| Objective-leaf supplementary attachments                | Student  | Available only if enabled by teacher; off by default            | Evidence only; no change to automatic objective scores initially |

When objective supplementary attachments are enabled, show “Attachments do not affect automatic scoring for this question.” All are optional, limited to 3 images and 1 audio. Use a separate RESPONSE child to grade attachments. Parents cannot collect attachments; use specific answerable children.

### 6.2 Proposed file specifications

All are configurable upper bounds, with the server as final validator. One MiB is 1,048,576 bytes.

| Area                               | First-version specification                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image input                        | JPEG, PNG, static WebP; extension must match actual content                                                                                                                  |
| Each image                         | At most 10 MiB; width/height each ≤10,000 pixels and total ≤20 million pixels                                                                                                |
| Image processing                   | Handle orientation correctly, generate thumbnails/readable display versions, remove unnecessary metadata such as EXIF                                                        |
| Audio input                        | MP3, PCM WAV, AAC-LC in M4A; other codecs are not accepted merely because the extension matches                                                                              |
| Each audio                         | At most 50 MiB; duration >0 and ≤10 minutes, based on server decoding                                                                                                        |
| Audio processing                   | Generate a unified MP3 verified playable in target browsers; retain original submitted audio for teacher checks; no automatic denoising or changes to teaching pronunciation |
| Each teaching-content location     | Each prompt, shared material, answer-area instruction, option/card: at most 10 images and 5 audio files                                                                      |
| RESPONSE answer per question       | At most 5 images and 2 audio files; teachers can lower limits                                                                                                                |
| Teaching resources per assignment  | At most 100 distinct assetId values and 300 MiB of uploaded originals                                                                                                        |
| Resources per final student answer | At most 30 distinct assetId values and 100 MiB of uploaded originals, including objective evidence                                                                           |
| Student temporary workspace        | Per student/assignment: 60 files, 200 MiB for unsubmitted/replacement attachments; does not increase final quota                                                             |
| Teacher temporary workspace        | Per teacher/draft: 120 files, 400 MiB for unbound/replacement resources; does not increase saved teaching-resource quota                                                     |
| Storage accounting                 | Deduplicate distinct original assets for these limits; thumbnails/transcodes consume additional physical storage                                                             |

Individual and aggregate limits apply together. The editor shows totals live. Teachers can lower per-image/audio limits in RESPONSE; public configuration stores `maxImageBytes` and `maxAudioBytes`, enforced during upload initialization and actual-file validation.

Publication validation calculates the minimum attachment combinations needed to complete the assignment using required text, minimum attachment counts, and the “at least one valid input” rule. For alternatives such as image or audio, validate each path. Across minimal complete combinations, take the largest file count and byte total measured using per-file limits; these must not exceed 30 and 100 MiB respectively. Teachers must reduce required counts or per-file limits if exceeded. Optional extras use remaining quota; the UI reserves capacity for unmet requirements and asks users to remove optional attachments rather than required answers.

Temporary workspaces count READY originals, PROCESSING files, and reserved in-flight quota; failures/cancellations release quota. Final assignment/submission limits count only actually bound IDs, excluding temporary files no longer referenced. At workspace limits, allow cleanup of unbound files and retry. Final submission revalidates actual files, references, and totals; workspace limits cannot bypass final limits.

GIF, SVG, HEIC, video, archives, and documents are unsupported. If mobile selection returns HEIC, explain conversion/reselection; do not promise support for every gallery format. Acceptance uses browser file uploads. Camera entry depends on browser/system pickers and is outside this acceptance scope.

### 6.3 Image display and audio playback

Scale images proportionally without cropping answer-relevant content. Support click-to-enlarge, close, and mobile viewing. Teachers can provide captions/alt text. Student attachments may receive neutral labels such as “Student image 1,” with editable captions. Student-visible filenames, alt text, and player labels must not contain correct choices, answers, or dictation transcripts.

Audio does not autoplay. Provide play, pause, progress, duration, volume, and 0.75/1/1.25/1.5 speed. Replays are unlimited initially. Only one audio plays at a time; starting another pauses the previous one. Card selection and playback have separate controls. Support resume/seeking, retry on loading failure, and never treat playback completion as an answer when switching questions.

Teacher-entered transcripts remain teacher-only and are excluded from student APIs. Accessible labels must not disclose dictation/listening text. Teachers assign alternative learning tasks separately; these requirements do not claim full accessibility certification.

Audio content endpoints must support authenticated HTTP range requests for seeking/partial reads. See [MDN HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests) for semantics. Validate speed/mobile volume controls in target browsers; explain system volume control where the OS limits it.

### 6.4 Upload states and resource lifecycle

Upload UI shows filename, size, progress, cancellation, failure reason, retry, and removal. Processing and transfer phases are distinct. Only completely processed resources may be referenced in final answers.

States: `UPLOADING → PROCESSING → READY`; failures become `FAILED`, cancellation/cleanup becomes `DELETED`. A retry can create a new task/assetId; clean old references. Processing callbacks may update only valid states and must never revive deleted assets as READY.

Upload first, bind later. Teacher assets bind to their own server drafts. Student assets bind to themselves and a published, currently answerable assignment/leaf. Purpose is `TEACHING` or `ANSWER`; student answers cannot directly become teaching material, and another uploader's file ID cannot be claimed as one's own answer.

After transfer, the server performs type identification, decoding, pixel/duration validation, safety checks, and derivative processing before READY. Successful frontend preview, correct extension, or successful HTTP upload does not establish READY.

Resource reference and cleanup rules:

- Teacher uploads unreferenced by a server draft for 24 hours may be cleaned. Saved draft references do not expire merely because of resource age.
- Unsubmitted student answer assets are retained until 7 days after the deadline; retention does not permit late submission.
- Students may remove/replace attachments before final submission. Once bound by final submission, files cannot change or be deleted, including during teacher grading.
- Removing a draft attachment removes only its reference. Other valid references prevent deletion of the underlying object. Unreferenced assets enter a 7-day cleanup grace period.
- Draft deletion removes its references. Published teaching assets and submitted answer assets remain with historical assignments; the first version does not automatically delete business records.
- Before deletion, cleanup rechecks state/valid references and coordinates with publication/submission binding transactions. Failed database binding must not leave “submitted” file markers. Cleanup reclaims orphaned objects whose writes succeeded but database records failed.

When unsaved local teacher edits reference temporary assets, show the 24-hour validity. Undoing deletion can restore references only while files remain retained and authorized. Already-cleaned files require reupload.

### 6.5 Security and access

Use file-type allowlists and validate extension, declared MIME, signatures, and real decoding, rather than trusting browser Content-Type. Filenames are not physical paths; the server generates storage keys. Reject executable/invalid content, limit processing resource consumption, and complete safety checks before READY. See [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

Production files reside in private object storage or a nonpublic directory without public static URLs. This version reads through an authenticated content proxy; every GET, HEAD, and Range checks assignment/resource permissions. Retain sessions and Origin protection; multipart upload must not bypass authorization.

Unauthenticated users, other teachers, non-recipient students, and removed students cannot access protected assets. Students cannot read others' answers. Originals and display files have separate policies: students receive safe display versions of teaching media and displayable versions of their own answers; the responsible teacher may read submitted originals for checking. Return correct types and prevent MIME sniffing. Metadata excludes storage keys, real paths, and answer-revealing original filenames.

Do not issue long-lived signed URLs that bypass revocation. Authenticated resources cannot use shared public caches; the next resource request after revocation must fail. Bytes already downloaded cannot be recalled by server revocation; acceptance checks refusal of new requests.

Limit upload frequency/concurrency by account and assignment context: at most 3 simultaneous file transfers per account and 30 upload initializations/minute. Use shared counters or equivalently consistent limits; process-local limits cannot be claimed as global multi-instance limits. Quota reservation, failure release, and actual-size settlement must support concurrency, beyond client-side totals.

## 7 Scoring, grading, and results

### 7.1 Points and automatic grading

Retain integer scores to preserve existing grade semantics:

| Type                      | Smallest scoring unit                       | Scoring                                                   |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Single choice             | Whole question                              | Full points if correct, otherwise 0                       |
| Fill-in-the-blank         | Each blank                                  | Full blank points for an accepted match                   |
| Cloze choice              | Each blank                                  | Full blank points for correct option ID                   |
| Grouping                  | Each item                                   | Full item points for correct category ID                  |
| Matching                  | Each left item                              | Full left-item points for correct target ID               |
| Ordering                  | Whole question                              | Full points for a matching complete sequence, otherwise 0 |
| RESPONSE                  | Manual rubric dimension within the question | Teacher enters integer dimension scores and sums them     |
| Reading/general composite | No independent scoring unit                 | Sum children only                                         |

Each leaf has integer maximum 1–100. Multi-unit questions use positive integer unit points summing to the leaf maximum. Container scores are derived; assignment maximum is the sum of leaf maxima. Rubric dimensions divide the manual question's points without a second score allocation.

Default to 1 point per scoring unit, editable individually. If “distribute total points evenly” is offered, total must be at least the unit count. Use the integer quotient, adding 1 from the remainder to units in teacher-edit order, and persist actual allocations. Shuffled display must not change points. Teachers can inspect and adjust them anytime.

The server scores frozen configuration/answer keys, rejecting client score, maxScore, correct, and gradingStatus. Retain original text for teacher review; normalized values are only for blank matching.

### 7.2 Manual grading workflow

Submission and grading are separate workflows. Manual questions do not add a pending-review assignment state; pending review belongs to each student submission.

| Submission result state | Condition                                           | Student display                                                                   | Included in final average |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| PENDING_REVIEW          | At least one RESPONSE lacks published final grading | Submitted, awaiting teacher review; clearly labeled objective subtotal may appear | No                        |
| GRADED                  | Every leaf has a final score                        | Final total, maximum, grading time, teacher comments                              | Yes                       |

Objective-only assignments become GRADED immediately on submission. With manual questions, objective scores are automatic, RESPONSE scores are null rather than 0, and final total is null. Any student-visible objective subtotal says “Objective X/Y; final grade pending,” with Y covering objectives only. For manual-only assignments objectiveScore and objectiveMaxScore are both 0; show pending review without 0/0 or an objective percentage.

Teachers open a pending submission, view original answers/attachments, enter integer dimension scores from 0 to each maximum, and add question comments. Grading drafts can be saved without showing draft scores/comments to students. When every manual question is complete, “Publish final grade” atomically records final question scores, assignment total, grading time, and status.

Teachers can revise published manual scores with a required reason, gradingVersion conflict detection, audit history, and publication of another complete final grade. The previous version remains effective until replacement publication. Do not temporarily turn published grades to zero or expose partial updates in statistics. Manual overrides of objective scores are excluded; wrong answer keys require recording the issue and using a new assignment, without editing published questions.

Grading is allowed after deadlines and for removed students' historical submissions. Students cannot resubmit. Normally retained files must not expire while awaiting grading. Preserve teacher input after network failures. Retrying the same publication requestId/content must not create duplicate grade versions or audit events.

### 7.3 Statistical definitions

Teacher reports retain publication-recipient totals and submitted/not-submitted counts, adding pending/graded counts. Pending review counts as submitted; missing submissions are not zero-score submissions.

`averagePercent = arithmetic mean of (final score / submission maximum × 100) for graded submissions`, rounded to 1 decimal place. With no graded submissions, return null and display “No graded results yet.” Objective-only averages retain old semantics because submissions are immediately graded.

Student details, teacher details, and statistics read the same published grade version. Retain `enrolled` and `submitted`; add `pendingReviewCount` and `gradedCount`, whose sum equals `submitted`. Removal does not change the recipient denominator; historical graded results remain included.

Teacher question analysis uses whole-question accuracy for single choice/ordering, unit accuracy for blanks/cloze/grouping/matching, and graded count/average for manual questions rather than presenting automatic accuracy. The denominator includes submissions that actually answered the unit; since all leaves are required initially, this equals the assignment's submitted count. Accuracy is null with no submissions.

### 7.4 Teaching feedback visibility

Students never receive answer keys, accepted variants, relationship maps, correct sequences, explanations, rubric reference answers, or transcripts. Initial results show own answers, objective aggregate score, final total, and published teacher comments, without new per-unit correctness indicators. Teachers may inspect unit-level grading for diagnosis.

Teacher comments are visible to their intended student after publication. Answers included in comments are deliberate teacher feedback and must not leak through unpublished drafts. Future answer-key release needs a separate timing policy; do not include answerKey in student objects and hide it with CSS.

## 8 Data and contracts

### 8.1 Shared content model

Use a controlled JSON content tree, never arbitrary stored/rendered HTML. Initial blocks are paragraphs, headings with limited levels, lists, images, and audio; text supports bold/italic. Inline blank tokens are allowed only in fill-in-the-blank/cloze prompts. Migrate plain text to paragraph nodes. Stable contentNodeId values support upload-context validation, draft references, deletion, and error navigation without encoding answers.

Media nodes store assetId, public captions, and alt text, not binaries, storage paths, or permanent URLs. Teacher transcripts, explanations, and answer keys belong in teacher-only fields, outside public nodes. Renderers accept allowlisted nodes/properties only, rejecting scripts, event attributes, external-file links, and undefined tags.

### 8.2 Main entities

These are required domain concepts; technical design may choose exact SQL table splits and JSONB usage.

| Entity          | Required information                                                                                                                                                     | Constraints                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Assignment      | Existing fields, schemaVersion, draft version, published-content identity                                                                                                | Published content immutable; stored state remains DRAFT/PUBLISHED                                    |
| Question        | id, assignmentId, parentId, position, type, containerKind, prompt, answerAreaContent, public config, points                                                              | parentId points only to this assignment's container; container points derived from children          |
| AnswerKey       | questionId, type-specific answers, point allocation, matching policies, rubric references, explanations                                                                  | Teacher/server only; excluded from student serialization                                             |
| Asset           | id, ownerId, assignmentId, questionId or shared-material context, purpose, state, storage key, actual type, size, duration/dimensions, checksum, derivatives, timestamps | ID grants no access; ANSWER binds to a specific leaf/student                                         |
| AssetReference  | assetId, referencing entity, location, purpose, retention state                                                                                                          | Coordinate publication/submission binding with cleanup; teaching assets may have multiple references |
| Submission      | Existing identity fields, requestId, requestHash, published-content identity, answer snapshot, gradingStatus, objectiveScore, objectiveMaxScore, final score, maxScore   | Unique assignment+student; final score nullable, never 0 merely because manual grading is pending    |
| AnswerResult    | submissionId, questionId, original answerPayload, unit results, automatic/manual score                                                                                   | Unique per leaf; grading cannot overwrite answers                                                    |
| GradingRevision | submissionId, gradingVersion, grading draft/published snapshot, teacher, reason, requestId, time                                                                         | Preserve audit/published history; version conflict returns 409                                       |

Question public config contains only student-needed options, cards, categories, blank IDs, matching mode, upload requirements, and public manual-rubric dimensions. Stable rubricDimensionId values identify public names/descriptions/maxima and submitted dimension scores. Correct relationships, accepted answers, correct sequences, and explanations belong in AnswerKey. Public ordering-card order is separate from correct sequences; internal edit order must not disclose answers.

Scoring units use blankId or itemId, validated together with questionId. IDs use existing UUID formats/normalization. Clients generate IDs for new questions/items; servers validate uniqueness/context. Draft updates preserve IDs; creation, duplication, or actual content replacement uses new IDs.

### 8.3 Answer payloads

New answers use `{ questionId, type, payload, evidenceAssetIds }`; type must match the published type. `evidenceAssetIds` defaults to an empty array and is only for optional objective evidence. RESPONSE attachments go in payload.assetIds, without duplication in evidence.

| Type          | payload                                      | Server constraints                                                                             |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| SINGLE_CHOICE | `{ optionId }`                               | Exactly one existing option                                                                    |
| FILL_BLANK    | `{ blanks: [{ blankId, text }] }`            | Every blank once; preserve original text                                                       |
| CLOZE_CHOICE  | `{ blanks: [{ blankId, optionId }] }`        | Each blank selects its own valid option                                                        |
| GROUPING      | `{ placements: [{ itemId, groupId }] }`      | Every item once; category exists                                                               |
| MATCHING      | `{ pairs: [{ leftId, rightId }] }`           | Every left item once; target exists; mode respected                                            |
| ORDERING      | `{ orderedItemIds: [...], confirmed: true }` | Every card exactly once; confirmed is a compatibility field populated automatically by clients |
| RESPONSE      | `{ text, assetIds: [...] }`                  | Enabled methods, required inputs, count/size limits; at least one valid input                  |
| COMPOSITE     | No answer submitted                          | Reject container answers                                                                       |

The submission includes schemaVersion, publishedVersion, and requestId. Example with one single-choice answer and one manual audio response; UUIDs are illustrative, and actual calls must use current published IDs.

```json
{
  "schemaVersion": 2,
  "publishedVersion": 3,
  "requestId": "40000000-0000-4000-8000-000000000001",
  "answers": [
    {
      "questionId": "50000000-0000-4000-8000-000000000001",
      "type": "SINGLE_CHOICE",
      "payload": {
        "optionId": "60000000-0000-4000-8000-000000000001"
      },
      "evidenceAssetIds": []
    },
    {
      "questionId": "50000000-0000-4000-8000-000000000002",
      "type": "RESPONSE",
      "payload": {
        "text": "",
        "assetIds": ["70000000-0000-4000-8000-000000000001"]
      },
      "evidenceAssetIds": []
    }
  ]
}
```

This assumes the assignment has only these two leaves. The second requires 1 audio and no text, and the READY resource belongs to this student/question. publishedVersion is the frozen assignment version at publication, not a subsequent grading version.

### 8.4 Submission transactions and idempotency

Retain unique constraints on `(assignmentId, studentId)` and `(studentId, requestId)`. The server hashes a canonical request from published content, answers, and resource references:

- Normalize UUIDs, sort answers by questionId, blanks/cloze by blankId, grouping by itemId, and matching by leftId.
- Attachment/evidence arrays are sets initially: reject duplicates, then sort by assetId. Student-described attachment display order is not part of this version's semantics.
- Preserve orderedItemIds order; never sort it before hashing.
- Preserve raw text; grading normalization does not establish idempotent equivalence. Changing whitespace/case requires a new requestId and cannot overwrite the original request.
- Include assignmentId, schemaVersion, publishedVersion, types, and complete semantic answers; exclude short-lived URLs and client display numbers.

Same requestId/canonical payload returns the same submission; a different payload returns 409. Changed answers get a new requestId, but an existing final submission still prevents another attempt.

Before persistence, new submissions must pass all permission, structure, resource, and grading checks. One transaction saves answer snapshots, asset bindings, and objective results. Use database write time: accept only `clock_timestamp() < dueAt`; equality is rejected. Upload beginning before the deadline does not allow submission if processing or submission completes afterward.

Exact retries of successful submissions return the original submission after the deadline if access remains valid. Return the current published grade state/version without regrading or rebinding. Manual grading may change scores, but submission identity/original answers remain unchanged.

Submission races with member removal/resource deletion/cleanup need explicit locks or equivalent consistency. Failed asset binding rolls back the entire submission, rather than saving only objectives. Database constraints, beyond disabled buttons, prevent duplicates.

## 9 API requirements

This table is the target contract, not the existing endpoint inventory. Retain `/api`, current authentication, and the unified error shape. Errors may add stable codes/field paths for navigating to questions/blanks. Versioning uses explicit schemaVersion on the same paths; section 10 defines legacy compatibility.

| Method and path                                 | Input and result                                                                                                 | Key constraints                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST /assignments                               | schemaVersion 2 draft → draft details                                                                            | Incomplete/zero questions allowed; valid basic information/structure                                 |
| PATCH /assignments/:id                          | Complete draft, version → latest draft                                                                           | Atomic updates, stable IDs, 409 version conflicts                                                    |
| GET /assignments/:id                            | Teacher edit or student public projection                                                                        | Generated by server role; students read own grades only                                              |
| POST /assignments/:id/validate                  | Current server draft and expected version → validation list                                                      | Each error includes questionId, field location, reason; no publication                               |
| POST /assignments/:id/publish                   | Expected version → frozen details                                                                                | Repeat full validation, never trust prior validate alone                                             |
| POST /assets/uploads                            | assignmentId, leaf/teaching-content context, purpose, file declaration → uploadId/assetId and upload entry point | Authorize/reserve quota first; student type must allow upload                                        |
| POST /assets/uploads/:uploadId/content          | Bounded multipart stream → PROCESSING                                                                            | First-version API receives files; no binaries in question JSON                                       |
| GET /assets/:assetId                            | State, safe display metadata, derivatives                                                                        | Context authorization every time; understandable failure reasons                                     |
| GET or HEAD /assets/:assetId/content            | Display file; teachers explicitly request original for originals                                                 | All variants authorized; audio Range support; no public redirects                                    |
| DELETE /assets/:assetId                         | Cancel upload or remove deletable unbound asset → deleted/canceled state                                         | No deletion with valid published/submitted references; remove draft references through draft updates |
| POST /assignments/:id/submissions               | New answer union and requestId → submission/grading state                                                        | Atomic, deadline-aware, one submission, exact retries                                                |
| GET /assignments/:id/submissions/:submissionId  | Details and student/teacher-visible results                                                                      | Students: own submission with active access; teachers: answers/resources                             |
| PATCH /submissions/:submissionId/grading        | gradingVersion, manual scores/comments → grading draft                                                           | Teacher owner; full score/rubric validation                                                          |
| POST /submissions/:submissionId/grading/publish | gradingVersion, requestId, revision reason → published grade                                                     | Complete grading required; idempotent retries; reasons required for revisions                        |
| GET /assignments/:id/stats                      | Existing statistics plus pendingReviewCount, gradedCount                                                         | Final averages include graded only                                                                   |
| GET /assignments/:id/submissions                | Existing list plus grading state/filter                                                                          | Publication-snapshot denominator; retain removed marker                                              |
| GET /assignments/:id/question-stats             | Teacher question/unit analysis                                                                                   | No answer or other-student data exposed to students                                                  |

Upload initialization retries use a separate uploadRequestId. Same account/request ID/declaration returns the same task without duplicate quota reservations. Upload failures affect only that asset, preserving other questions/files. A changed file declaration after failure uses a new uploadRequestId. Declared size/type is not the final accounting value.

Grading drafts also use gradingVersion. Same publication requestId/content returns the existing published version; different content returns 409. Student submission, upload, and grading-publication request IDs have separate scopes and are not interchangeable.

Errors cover at least: 400 invalid input/reference, 401 expired authentication, 403 forbidden role/Origin, 404 missing/inaccessible object, 409 content-version/deadline/already-submitted/resource-state conflicts, 413 excessive bytes, 415 unsupported type, 422 corruption/decoded-specification mismatch, 429 rate limit, and 500/503 temporary service failure. Expected upload failures must not expose internal paths or processing stacks to students.

Question JSON and file streams have separate limits. Do not reuse the existing 512 KiB JSON limit without measurement. The proposed question/submission JSON limit is 2 MiB, checked as UTF-8 bytes before frontend saves and enforced by server/proxy. Media has separate streaming limits. Per-field text limits do not override whole-request limits; show remaining capacity.

## 10 Historical data and compatibility

Use append-only migrations, never rewriting applied files. Validate the following on an independent copy:

1. Give existing questions SINGLE_CHOICE types/content blocks while preserving historical questionId, option text, points, order, assignment, and correct answer.
2. Generate/persist stable optionId values once for old options; map `correctIndex` accordingly. Never regenerate IDs on reads.
3. Project old selectedIndex answers to optionId or create answer snapshots, retaining original payloads, request_hash, submission identity, and historical grades without regrading.
4. Mark old submissions GRADED, with objectiveScore equal to old score and objectiveMaxScore equal to old maxScore; preserve score/maxScore.
5. Add content-version identities to old assignments, retaining recipients/revocation. Published old assignments remain read-only; upgrades must not enable question changes.
6. Relax existing score NOT NULL/related constraints for pending nulls, while requiring GRADED scores to be nonnull, nonnegative, and at most maximum. Update null handling on every grade-consuming page.
7. Relax old mandatory single-choice options/correct_index constraints and add type-specific constraints. Adding type while still requiring single-choice answer columns for all questions is insufficient.
8. Missing schemaVersion means legacy API input. Old creation/editing accepts only single-choice structure and maps it to the new model. Legacy PATCH lacks question identities, so retains full replacement/new-ID behavior; stable-ID updates apply to schemaVersion 2. Legacy selectedIndex submissions work only for single-choice assignments, mapped using frozen option order. Reject mixed-type requests with a client-upgrade message.
9. Preserve legacy hashing and original request_hash so exact retries return original submissions. Requests across versions share one final-submission constraint, without extra attempts.
10. After the new frontend ships, clear or convert old sessionStorage drafts. Convert selected single-choice indexes using persisted mappings; do not force old local teacher IDs onto server IDs. If reliable conversion is impossible, preserve original text for recovery and ask users to reselect answers, without silently clearing work.

Legacy read projections apply only to fully representable plain-text single-choice assignments. The new frontend reads with `?schemaVersion=2` and writes with the version field. Mixed/media questions not representable as old string options return clear upgrade guidance, rather than fake single-choice objects or responses missing leaves. Old publication requests without expected version return 409 and upgrade guidance; upgraded teacher pages preview again and publish with a version, preserving conflict checks. This version guarantees historical reads/submission retries, not every new editing/publication workflow in old frontends.

Migration acceptance checks old assignment counts, questionId, option mappings, grades, submitted counts, averages, removed markers, and idempotent retries. Old services cannot understand new types; once new-type data exists, do not roll back directly to old binaries. Choose a forward fix or restore complete database/file backups and define how to handle data after the recovery point.

## 11 Experience, accessibility, and quality requirements

### 11.1 Mobile and alternative operations

Support authoring, answering, uploading, submitting, and grading at 375 px and 1280 px desktop widths. Body text, inputs, media controls, and primary buttons must not overflow horizontally in ways that make content unusable. Reading/matching may use suitable layouts different from desktop.

Grouping, matching, and ordering must offer both click/touch alternatives and keyboard operation. Drag-only or keyboard-only alternatives to touch dragging are insufficient. See [W3C Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) for single-pointer alternatives. This is a design constraint, not a claim of whole-product WCAG compliance.

Focus is visible; controls include question numbers/item names. Selection/grouping/matching states do not rely only on color. Errors locate leaves and internal scoring units. Playback/removal/answer controls are distinct. Upload states and connection changes provide assistive-technology-readable feedback.

### 11.2 Capacity and text limits

| Area                                     | Proposed first-version limit                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Top-level questions                      | 1–20; saved drafts may have 0                                                      |
| Children per container                   | 1–10; incomplete drafts may have 0                                                 |
| Leaves per assignment                    | 1–100; saved drafts may have 0                                                     |
| Scoring units per assignment             | At most 200; manual questions count once, without counting rubric dimensions again |
| Points per leaf                          | Integer 1–100; at most 100 leaves means assignment maximum ≤10,000                 |
| Leaf prompt plain text                   | At most 5,000 characters                                                           |
| Container shared-material plain text     | At most 30,000 characters                                                          |
| Answer-area instruction plain text       | At most 2,000 characters                                                           |
| Option/card plain text                   | At most 500 characters each                                                        |
| Category names/media short labels        | At most 100 characters                                                             |
| Image alt text/media captions            | At most 500 characters                                                             |
| Teacher explanation/audio transcript     | At most 10,000 characters per question/audio; teacher-only                         |
| Question grading comment/revision reason | At most 2,000/500 characters respectively                                          |
| Rubric dimension name/description        | At most 100/1,000 characters respectively                                          |
| Single JSON request                      | At most 2 MiB UTF-8, with all field limits also satisfied                          |

Count characters as Unicode code points consistently; frontend JS UTF-16 length cannot be judged against a different backend definition. Sum all text nodes for the location's plain-text limit; count assets separately. UUID contracts limit resource/answer ID lengths.

### 11.3 Performance and failures

Validate functionality/performance baselines in an isolated local environment for this delivery. Recheck the target environment at release; development-machine results are not production promises. The acceptance dataset is a valid mixed assignment with 20 top-level questions, 100 leaves, and 200 scoring units.

- Metadata/initial rendering must not wait for all media. Load audio on user action; use display images and on-demand loading.
- Uploads must not block editing/answering other questions. Until READY, block only publication/final submission referencing that asset.
- Objective grading must not download media or synchronously transcode; use validated READY metadata and frozen keys.
- In an isolated acceptance environment with 50 concurrent clients, proposed P95 targets are ≤1 second separately for metadata reads and objective-only final submissions excluding file transfers. Record hardware, network, sample count, and database conditions.
- Network errors, session expiry, asset 404s, processing failures, insufficient capacity, version conflicts, and deadlines have clear errors/recovery paths. Retries cannot bypass deadlines or revocation.
- Processing failures support retries/backlog monitoring; restarts retain task states. A database job table or existing infrastructure is acceptable; microservices are not mandated.

### 11.4 Backup and operations

Production backups must include the database, file metadata, originals, and derivatives, with a consistency manifest. After restoration, verify file presence/checksums. A restored database with all audio missing is not complete recovery.

Monitor upload success, processing failures/backlog, asset 404s, storage use, and pending reviews. Logs exclude passwords, tokens, complete student answers, transcripts, and private-content access credentials; correlate using requestId, uploadId, and submissionId. Store grading-change audits separately from ordinary request logs.

## 12 Delivery phases and dependencies

Every phase below belongs to this delivery. Phases organize dependencies rather than permit partial question-type delivery.

| Phase                     | Deliverables                                                                                             | Exit criteria                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1 Contracts/compatibility | Content blocks, stable IDs, leaf/container model, answer unions, append-only migrations, integer scoring | Legacy data/retry regressions pass; new types persist completely with authorization   |
| 2 Media foundation        | Upload, processing, access proxy, aggregate limits, retention/cleanup, backup                            | Full teacher/student media flow, revocation, and concurrent-cleanup tests pass        |
| 3 Objective types         | Upgrade single choice; add blanks, cloze, grouping, matching, ordering, teacher/student interfaces       | Editing, preview, publication, answering, grading, and failure recovery pass per type |
| 4 Composites/grading      | Reading, general composites, RESPONSE, rubrics, grading drafts/publication                               | Mixed scoring and pending-to-final result workflow pass                               |
| 5 Overall acceptance      | Browser/mobile viewports, capacity, concurrency, migration, recovery, permissions, teaching examples     | Section 13 complete; API/operations docs and release checklist synchronized           |

All required capabilities are P0. Drag animations, bulk actions, and further teaching analysis may improve later, but alternative operations, upload reliability, manual grading, and compatibility cannot be omitted.

## 13 Acceptance cases

Use isolated synthetic data. Expectations require more than disabled UI buttons: include invalid server requests, data assertions, and suitable real PostgreSQL concurrency tests. Under the latest scope, desktop/mobile-viewport uploads, image display, audio playback, and core operations must pass, recording browser/viewport dimensions. Physical devices are not required; viewport emulation is not verification of every mobile engine.

| ID   | Scenario                                                                              | Expected result                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AC01 | Replace a single-choice option with image/audio; reorder before submitting            | Media displays; stable IDs determine grades; playback does not accidentally select                                                              |
| AC02 | Key London; submit `london` with surrounding spaces                                   | Scores by default; fails case-sensitive match; server determines both                                                                           |
| AC03 | Test `its`/`it's`, straight/curly apostrophes, accents, repeated whitespace           | Section 4.2 rules; no implicit spelling/punctuation variants                                                                                    |
| AC04 | Two blanks worth 2/3; only second correct                                             | 3/5; any missing blank rejects submission without a record                                                                                      |
| AC05 | Three cloze blanks worth 2 each, two correct; submit another blank's optionId         | Valid answer scores 4/6; cross-blank option rejected                                                                                            |
| AC06 | Delete/duplicate a blank, save, publish                                               | No stale key; copies have new IDs; all tokens match configuration                                                                               |
| AC07 | Reading group with three 2-point children                                             | Maximum 6, progress denominator 3; no parent answer/score                                                                                       |
| AC08 | Nested container, cross-assignment child, orphan parentId                             | Server rejects without invalid hierarchy                                                                                                        |
| AC09 | Four grouping items worth 1 each, three correct; reorder within group                 | 3/4; order irrelevant; duplicate placement rejected                                                                                             |
| AC10 | Occupied one-to-one target; repeated many-to-one target                               | No silent deletion in one-to-one; sharing allowed in many-to-one; score by left item                                                            |
| AC11 | Right-side distractors; every left item connected                                     | Submission allowed without using distractors                                                                                                    |
| AC12 | Keep initial ordering; then swap two items                                            | Current complete arrangement submits directly without confirmation; wrong complete sequence scores 0                                            |
| AC13 | Second accepted ordering; duplicate/missing card                                      | Accepted sequence earns full points; server rejects invalid sequence                                                                            |
| AC14 | Visibly identical ordering cards require hidden identity distinction                  | Publication rejected without equivalent answers; request rewrite                                                                                |
| AC15 | Save incomplete prompt/answer draft, then publish                                     | Draft retained; publication returns exact-location errors; students cannot see draft                                                            |
| AC16 | Same teacher saves/publishes different versions in two tabs                           | Later save/publication returns 409; retain local work; do not publish unpreviewed changes                                                       |
| AC17 | Change published prompt, audio, key, or points                                        | All rejected; historical content/maximum unchanged                                                                                              |
| AC18 | Upload boundary files and files 1 byte too large                                      | Boundary accepted if other specifications pass; excess returns 413 without quota leaks                                                          |
| AC19 | Forged MIME/extensions, corrupt/oversized-pixel image, unsupported M4A codec          | Never READY; type/decoding errors enforced beyond browser validation                                                                            |
| AC20 | Audio exactly/over 10 minutes; pause, seek, speed                                     | Boundary accepted, overlong rejected; playback on target device with clear limits                                                               |
| AC21 | Upload retry, processing failure, refresh, late result after cancel                   | Other work retained; correct recovered states; canceled asset not revived                                                                       |
| AC22 | Other owner's assetId, another question's answer, unauthorized original/display/Range | All rejected; students cannot read others' answers or teaching originals                                                                        |
| AC23 | Removed student reads old media URL or submits                                        | New requests fail; teacher can still read/grade history                                                                                         |
| AC24 | Concurrent uploads exceed temporary quota; separately exceed final-reference total    | Reservations respect workspace limit; failures release quota; excessive final references rejected; workspace quota does not enlarge final limit |
| AC25 | Undo reference deletion; another reference remains                                    | Restore during grace period; referenced underlying files retained                                                                               |
| AC26 | Cleanup races with final submission/publication binding                               | Successful resources remain intact or whole operation fails explicitly; no dangling references                                                  |
| AC27 | RESPONSE requires 1 audio; text only or PROCESSING file only                          | Reject; only READY own audio satisfying requirements allows submission                                                                          |
| AC28 | Objective optional photo: wrong option plus correct handwritten photo                 | Option scores 0; evidence retained; no implicit conversion to manual                                                                            |
| AC29 | Correct 6-point objective and pending 4-point manual; also manual-only                | Mixed: objectiveScore=6, objectiveMaxScore=6, score=null, maxScore=10, PENDING_REVIEW, excluded from final average; manual-only shows no 0/0    |
| AC30 | Publish manual score 3 in preceding example, then revise to 4                         | First total 9/10, then 10/10; history/reasons retained; consistent updated student result                                                       |
| AC31 | Missing rubric dimension, negative/over-maximum score, save grading draft             | Invalid values rejected; drafts do not change student final grades/published comments                                                           |
| AC32 | Concurrent grade publication or timeout retry                                         | Recoverable version conflict; exact retry duplicates neither grade nor audit                                                                    |
| AC33 | One graded 9/10, one pending, one not submitted                                       | submitted=2, pendingReview=1, graded=1, recipients=3, average=90.0; missing submission is not 0                                                 |
| AC34 | All pending or no submissions                                                         | averagePercent=null, not 0; submitted counts distinguish states                                                                                 |
| AC35 | Missing/extra answers, parent answers, cross-question IDs, client scores              | Server rejects; no partial submission/asset bindings                                                                                            |
| AC36 | Retry same requestId after reordering answers/maps/attachment sets                    | Same submission; changed ordering sequence/text with old requestId returns 409                                                                  |
| AC37 | Concurrent different requestId values or identical requests                           | At most one final submission in real PostgreSQL; readable result; no duplicate bindings                                                         |
| AC38 | Upload before/submit after deadline; exact successful retry after deadline            | New submission rejected; exact retry returns original if access remains                                                                         |
| AC39 | Inspect complete student responses, metadata, frontend caches                         | No keys, correct sequences, explanations, teacher transcripts, others' answers, or unpublished grading                                          |
| AC40 | Upgrade legacy single-choice data; retry old requests                                 | Questions/grades unchanged, stable optionId mapping, retries valid, removed markers/recipients correct                                          |
| AC41 | Exceed top-level/leaf/unit/text/resource/JSON limits                                  | Frontend shows exact location/remaining capacity; server rejects independently                                                                  |
| AC42 | Complete grouping/matching/ordering using only keyboard or only clicks/touch          | All answers editable/completable with identifiable focus/states; no mandatory dragging                                                          |
| AC43 | Desktop/mobile-viewport image selection, audio upload, proxy playback                 | Browser flows work; no core page overflow at 320–768px; clear unsupported-file errors; no false physical-device claims                          |
| AC44 | Maximum valid mixed-assignment loading/grading/media latency                          | Meets agreed environment targets; media latency does not block first render or unrelated questions                                              |
| AC45 | Restore database/files; sample images/audio/historical submissions                    | Matching metadata/files/checksums; original answers/grades accessible; recovery point recorded                                                  |

## 14 Definition of development completion

Completion requires teacher editing and student-answer UI, shared frontend/backend contracts, server validation/grading, media processing/authorization, manual grading/statistics, append-only migrations/legacy requests, failure recovery, and section 13 test evidence together.

Update API, architecture, deployment, and backup documentation with delivery. Review whether proposed capacity/file specifications meet actual courses, target devices, and deployment conditions. Agree on changes before the corresponding implementation. Estimate time/storage costs after resource services, existing data volumes, and deployment environments are known; do not invent operating scale or delivery dates.

## 15 Basis and design references

The following existing files establish the upgrade starting point; this document does not claim new features are complete.

- [Existing shared contracts](../packages/contracts/src/index.ts)
- [Assignment service and existing grading](../apps/api/src/assignments/assignments.service.ts)
- [Teacher authoring interface](../apps/web/src/AssignmentForm.tsx)
- [Student answers and results](../apps/web/src/App.tsx)
- [Same-tab work protection](../apps/web/src/WorkProtection.tsx)
- [Initial database constraints](../apps/api/migrations/001_initial.sql)
- [Existing API and compatibility semantics](API.md)
- [Existing business rules and architecture](ARCHITECTURE.md)

Upload controls, drag alternatives, and partial media reads refer to the official materials linked in sections 6 and 11. Question types, grading policies, rubrics, capacity, and UI workflows are this project's product requirements.
