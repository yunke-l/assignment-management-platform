import { Button, SelectField, FormFieldset, InputField, TextAreaField } from './Controls';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  canonicalSubmission,
  mediaLimits,
  type AnswerV2,
  type AssetView,
  type AssignmentDetailV2,
  type AssignmentStats,
  type GradingDraft,
  type PageResult,
  type PublicQuestionV2,
  type QuestionV2,
  type SubmissionV2,
  type ValidationProblem,
} from '@amp/contracts';
import { request, useResource, ApiError } from './api';
import { ContentView, UploadWorkspace } from './Media';
import {
  actualAnswer,
  draftAnswerSchema,
  emptyAnswer,
  QuestionAnswer,
  restoreAnswer,
  type DraftAnswer,
} from './QuestionAnswer';
import { useConfirm } from './ConfirmDialog';
import { compatibleDraft } from './answer-draft';
import { recoverStudentDraft, type AnswerWork } from './work-migration';
import { LegacyWorkNotice } from './LegacyWorkNotice';
import { questionNumbers, questionsInDisplayOrder } from './question-editor';
import { attachmentCapacity, checkAttachmentAddition } from './answer-capacity';
import { useWork, useWorkDraft, useWorkGuard } from './WorkProtection';
import { QuestionAnalysis, type QuestionAnalysisItem } from './QuestionAnalysis';
export type StatsV2 = AssignmentStats & { pendingReviewCount: number; gradedCount: number };
type AnswerResult = {
  questionId: string;
  type: string;
  payload: unknown;
  feedback: string;
  score?: number | null;
  maxScore?: number;
  units?: { unitId: string; score: number; points: number; correct: boolean }[];
};
type SubmissionDetail = SubmissionV2 & {
  answers: AnswerV2[];
  results: AnswerResult[];
  gradingDraft?: GradingDraft['answers'];
  gradingRevisions?: {
    version: number;
    score: number;
    maxScore: number;
    reason: string;
    createdAt: string;
    data: GradingDraft['answers'];
  }[];
};
const dateLabel = (value: string) => new Date(value).toLocaleString();
type AnyQuestion = QuestionV2 | PublicQuestionV2;
type ReviewDirectory = {
  anchorPrefix: string;
  items: Record<string, { score: number | null; status: 'pending' | 'draft' | 'graded' }>;
};
type ReviewDirectoryChange = (directory: ReviewDirectory | null) => void;
function QuestionTree({
  questions,
  token,
  answers,
  edit,
  disabled,
  teacher,
  showAnswerKey = teacher,
  results,
  anchorPrefix = 'question',
  renderGrading,
  assignmentId,
  onStatus,
  onUploadBusy,
  canUpload,
}: {
  questions: AnyQuestion[];
  token: string;
  answers: Record<string, DraftAnswer>;
  edit: (id: string, change: (old: DraftAnswer) => DraftAnswer) => void;
  disabled: boolean;
  teacher: boolean;
  showAnswerKey?: boolean;
  results?: AnswerResult[];
  anchorPrefix?: string;
  renderGrading?: (question: Exclude<AnyQuestion, { type: 'COMPOSITE' }>) => ReactNode;
  assignmentId?: string;
  onStatus?: (id: string, asset: AssetView | null) => void;
  onUploadBusy?: (key: string, busy: boolean) => void;
  canUpload?: (id: string, kind: 'image' | 'audio', bytes: number) => string | null;
}) {
  const leaf = (q: AnyQuestion, number: string) => {
    if (q.type === 'COMPOSITE') return null;
    const result = results?.find((result) => result.questionId === q.id);
    return (
      <div key={q.id}>
        <QuestionAnswer
          q={q}
          anchorId={`${anchorPrefix}-${q.id}`}
          token={token}
          number={number}
          assignmentId={assignmentId}
          answer={answers[q.id] ?? emptyAnswer()}
          onChange={(action) => edit(q.id, action)}
          disabled={disabled}
          teacher={teacher}
          showAnswerKey={showAnswerKey}
          result={
            result && {
              score: result.score ?? null,
              maxScore: result.maxScore ?? q.points,
              units: result.units ?? [],
            }
          }
          onStatus={onStatus}
          onUploadBusy={onUploadBusy}
          canUpload={canUpload}
        >
          {renderGrading?.(q)}
        </QuestionAnswer>
      </div>
    );
  };
  return (
    <div>
      {questions
        .filter((q) => q.parentId === null)
        .sort((a, b) => a.position - b.position)
        .map((root, i) =>
          root.type === 'COMPOSITE' ? (
            <section className="question-group" key={root.id}>
              <h3>
                Question {i + 1} · {root.config.kind === 'READING' ? 'Reading' : 'Shared question'}
              </h3>
              <div className="reading-layout">
                <details className="shared-material" open>
                  <summary>Shared materials · expand / collapse</summary>
                  <ContentView token={token} content={root.prompt} />
                  <ContentView token={token} content={root.answerAreaContent} />
                </details>
                <div>
                  {questions
                    .filter((q) => q.parentId === root.id)
                    .sort((a, b) => a.position - b.position)
                    .map((q, j) => leaf(q, `${i + 1}.${j + 1}`))}
                </div>
              </div>
            </section>
          ) : (
            leaf(root, String(i + 1))
          ),
        )}
    </div>
  );
}
export function AssignmentView({
  assignment,
  stats,
  statsError,
  token,
  teacher,
  onChange,
  onEdit,
  onDeleted,
  resumeReview,
}: {
  assignment: AssignmentDetailV2;
  stats: StatsV2 | null;
  statsError: string;
  token: string;
  teacher: boolean;
  onChange: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  resumeReview?: { submissionId: string; request: number } | null;
}) {
  const work = useWork(),
    confirm = useConfirm();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [issues, setIssues] = useState<ValidationProblem[]>([]),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [reviewDirectory, setReviewDirectory] = useState<ReviewDirectory | null>(null);
  const [metadata, setMetadata] = useState<Record<string, AssetView | null>>({}),
    [uploading, setUploading] = useState<Record<string, boolean>>({});
  const onStatus = useCallback(
    (id: string, data: AssetView | null) =>
      setMetadata((old) =>
        JSON.stringify(old[id]) === JSON.stringify(data) ? old : { ...old, [id]: data },
      ),
    [],
  );
  const onUploadBusy = useCallback(
    (key: string, value: boolean) =>
      setUploading((old) => (old[key] === value ? old : { ...old, [key]: value })),
    [],
  );
  const initial: AnswerWork = {
    schemaVersion: 2,
    assignmentId: assignment.id,
    publishedVersion: assignment.publishedVersion,
    answers: {} as Record<string, DraftAnswer>,
    retry: null as { fingerprint: string; id: string } | null,
  };
  const [draft, setDraft, clear, dirty] = useWorkDraft(
    `answers:${assignment.id}`,
    initial,
    assignment.title,
    {
      recover: (value) => recoverStudentDraft(value, assignment),
      validate: (value): value is typeof initial => {
        if (!value || typeof value !== 'object') return false;
        const v = value as typeof initial;
        return (
          v.schemaVersion === 2 &&
          v.assignmentId === assignment.id &&
          v.publishedVersion === assignment.publishedVersion &&
          !!v.answers &&
          typeof v.answers === 'object' &&
          Object.entries(v.answers).every(
            ([id, answer]) =>
              assignment.questions.some((q) => q.id === id && q.type !== 'COMPOSITE') &&
              draftAnswerSchema.safeParse(answer).success,
          ) &&
          (v.retry === null ||
            (!!v.retry &&
              typeof v.retry.id === 'string' &&
              typeof v.retry.fingerprint === 'string'))
        );
      },
    },
  );
  useWorkGuard(`assignment-action:${assignment.id}`, false, busy);
  const submitted = useResource<SubmissionDetail>(
    assignment.submission
      ? `/assignments/${assignment.id}/submissions/${assignment.submission.id}`
      : null,
    token,
  );
  useEffect(() => {
    if (assignment.submission && dirty) clear();
  }, [assignment.submission, dirty, clear]);
  const numbers = questionNumbers(assignment.questions);
  const leaves = questionsInDisplayOrder(assignment.questions).filter(
    (q) => q.type !== 'COMPOSITE',
  );
  const answers = leaves.flatMap((q) => {
    const answer = actualAnswer(q, draft.answers[q.id] ?? emptyAnswer());
    return answer ? [answer] : [];
  });
  const ids = [
    ...new Set(
      answers.flatMap((a) => [
        ...a.evidenceAssetIds,
        ...(a.type === 'RESPONSE' ? a.payload.assetIds : []),
      ]),
    ),
  ];
  // Count attached files even while an objective answer is incomplete.
  const allIds = [
    ...new Set(Object.values(draft.answers).flatMap((a) => [...a.assetIds, ...a.evidenceAssetIds])),
  ];
  const filesReady = allIds.every((id) => metadata[id]?.status === 'READY');
  const bytes = allIds.reduce((sum, id) => sum + (metadata[id]?.bytes ?? 0), 0);
  const uploadsBusy = Object.values(uploading).some(Boolean);
  const attachmentCountsValid = leaves.every((q) => {
    const value = draft.answers[q.id] ?? emptyAnswer(),
      own = [...value.assetIds, ...value.evidenceAssetIds].map((id) => metadata[id]);
    const images = own.filter((a) => a?.kind === 'image').length,
      audios = own.filter((a) => a?.kind === 'audio').length;
    return q.type === 'RESPONSE'
      ? images >= q.config.minImages &&
          images <= q.config.maxImages &&
          audios >= q.config.minAudios &&
          audios <= q.config.maxAudios
      : images <= 3 && audios <= 1;
  });
  const complete =
    answers.length === leaves.length &&
    leaves.length > 0 &&
    filesReady &&
    attachmentCountsValid &&
    allIds.length <= mediaLimits.answerFiles &&
    bytes <= mediaLimits.answerBytes &&
    !uploadsBusy;
  const capacity = attachmentCapacity(assignment.questions, draft.answers, metadata);
  const closed = new Date(assignment.dueAt).getTime() <= Date.now();
  const savedAnswers = Object.fromEntries(
    (submitted.data?.answers ?? []).map((answer) => [answer.questionId, restoreAnswer(answer)]),
  );
  async function act(action: 'publish' | 'submit') {
    if (busy) return;
    if (
      action === 'submit' &&
      !(await confirm({
        title: 'Submit these answers?',
        description: `${answers.length}/${leaves.length} answerable questions complete, ${ids.length} ready files. You have one final attempt and cannot edit it afterwards.`,
        confirmLabel: 'Submit answers',
        cancelLabel: 'Keep reviewing',
      }))
    )
      return;
    setBusy(true);
    setError('');
    setIssues([]);
    try {
      if (action === 'publish') {
        const [latest, recipients] = await Promise.all([
          request<AssignmentDetailV2>(`/assignments/${assignment.id}?schemaVersion=2`, token),
          request<StatsV2>(`/assignments/${assignment.id}/stats?schemaVersion=2`, token),
        ]);
        if (latest.version !== assignment.version || latest.status !== 'DRAFT')
          throw new Error(
            'The draft changed. Reload and review the latest version before publishing.',
          );
        if (
          !(await confirm({
            title: 'Publish this assignment?',
            description: `${latest.title}\nClass: ${latest.className}\nRecipients: ${recipients.enrolled} current students\nDeadline: ${dateLabel(latest.dueAt)}\n${leaves.length} answerable questions · ${leaves.reduce((sum, q) => sum + q.points, 0)} points\n\nAfter publishing, questions cannot be edited. The student roster is fixed at publication; students joining later will not receive this assignment.`,
            confirmLabel: 'Confirm publish',
            cancelLabel: 'Keep reviewing',
          }))
        )
          return;
        await request(`/assignments/${assignment.id}/publish`, token, {
          method: 'POST',
          body: JSON.stringify({ schemaVersion: 2, version: assignment.version }),
        });
      } else {
        for (const answer of Object.values(draft.answers)) {
          for (const [id, caption] of Object.entries(answer.captions ?? {})) {
            if (!allIds.includes(id)) continue;
            const current = await request<AssetView>(`/assets/${id}`, token);
            if (current.caption !== caption)
              await request(`/assets/${id}`, token, {
                method: 'PATCH',
                body: JSON.stringify({ caption }),
              });
          }
        }
        if (!assignment.publishedVersion || !complete)
          throw new Error('Complete all questions and wait for every attachment to be ready.');
        const input = {
          schemaVersion: 2 as const,
          publishedVersion: assignment.publishedVersion,
          requestId: '',
          answers,
        };
        const legacy = draft.legacyRetry;
        const unchangedLegacy =
          legacy &&
          legacy.answers.length === answers.length &&
          legacy.answers.every((a) => {
            const q = assignment.questions.find((q) => q.id === a.questionId),
              selected = answers.find((answer) => answer.questionId === a.questionId);
            return (
              q?.type === 'SINGLE_CHOICE' &&
              selected?.type === 'SINGLE_CHOICE' &&
              q.config.options[a.selectedIndex]?.id === selected.payload.optionId
            );
          });
        const fingerprint = canonicalSubmission(assignment.id, input),
          retry =
            draft.retry?.fingerprint === fingerprint
              ? draft.retry
              : { fingerprint, id: crypto.randomUUID() };
        setDraft((old) => ({ ...old, retry }));
        const body = JSON.stringify(
          unchangedLegacy
            ? { requestId: legacy.id, answers: legacy.answers }
            : { ...input, requestId: retry.id },
        );
        if (new TextEncoder().encode(body).length > mediaLimits.jsonBytes)
          throw new Error('The answer payload exceeds 2 MiB. Reduce your text.');
        const result = await request<SubmissionV2>(
          `/assignments/${assignment.id}/submissions`,
          token,
          { method: 'POST', body },
        );
        if (!result.id)
          throw new Error('No saved submission was confirmed. Retry unchanged answers.');
        clear();
      }
      onChange();
    } catch (reason) {
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.errors) setIssues(reason.errors);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await request(`/assignments/${assignment.id}`, token, { method: 'DELETE' });
      work.set(`assignment:${assignment.id}`, null);
      onDeleted();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mixed-assignment-view">
      <span className="eyebrow">{assignment.className}</span>
      <h2 className="detail-title">{assignment.title}</h2>
      {!teacher && <LegacyWorkNotice raw={draft.legacyBackup} />}
      <p>{assignment.description || 'Read each task and complete every answerable question.'}</p>
      <p className="due-line">
        Due {dateLabel(assignment.dueAt)} · {leaves.length} answerable questions ·{' '}
        {leaves.reduce((sum, q) => sum + q.points, 0)} points
      </p>
      {teacher && stats && (
        <div className="stats">
          <div>
            <b>
              {stats.submitted}/{stats.enrolled}
            </b>
            <span>Submitted</span>
          </div>
          <div>
            <b>{stats.pendingReviewCount}</b>
            <span>Pending review</span>
          </div>
          <div>
            <b>{stats.gradedCount}</b>
            <span>Graded</span>
          </div>
          <div>
            <b>{stats.averagePercent === null ? '—' : `${stats.averagePercent}%`}</b>
            <span>Final average</span>
          </div>
        </div>
      )}
      {statsError && <p role="alert">{statsError}</p>}
      {assignment.submission && (
        <div className="result" role="status">
          <b>
            {assignment.submission.gradingStatus === 'GRADED'
              ? `Submitted · ${assignment.submission.score} / ${assignment.submission.maxScore} points`
              : 'Submitted · Pending teacher review'}
          </b>
          {assignment.submission.gradingStatus === 'PENDING_REVIEW' &&
            assignment.submission.objectiveMaxScore > 0 && (
              <p>
                Automatically graded: {assignment.submission.objectiveScore} /{' '}
                {assignment.submission.objectiveMaxScore} points. Final grade pending.
              </p>
            )}
          <p>{dateLabel(assignment.submission.submittedAt)}</p>
        </div>
      )}
      {!teacher && !assignment.submission && (
        <div className="answer-progress" role="status">
          {answers.length}/{leaves.length} answerable questions complete · {allIds.length}/30 files
          · {(bytes / 1048576).toFixed(2)}/100 MiB · Reserved: {capacity.reservedFiles} files /{' '}
          {(capacity.reservedBytes / 1048576).toFixed(2)} MiB · Optional capacity:{' '}
          {Math.max(0, capacity.freeFiles)} files /{' '}
          {Math.max(0, capacity.freeBytes / 1048576).toFixed(2)} MiB
          {!filesReady && ' · Some files are not ready.'}
        </div>
      )}
      {!teacher && !assignment.submission && (
        <UploadWorkspace assignmentId={assignment.id} token={token} />
      )}
      <div className="assignment-reading-layout">
        <nav className="question-directory" aria-label="Question directory">
          {leaves.map((q) => {
            const grade = reviewDirectory?.items[q.id];
            const label = grade
              ? grade.status === 'pending'
                ? 'Not graded'
                : `${grade.score} / ${q.points} points${grade.status === 'draft' ? ' · Draft' : ''}`
              : '';
            return (
              <a
                key={q.id}
                href={`#${reviewDirectory?.anchorPrefix ?? 'question'}-${q.id}`}
                title={`Question ${numbers.get(q.id)}${label ? ` · ${label}` : ''}`}
                aria-label={grade ? `Question ${numbers.get(q.id)} · ${label}` : undefined}
                data-grading-status={grade?.status}
              >
                <span>
                  {numbers.get(q.id)}
                  {!teacher &&
                  !assignment.submission &&
                  actualAnswer(q, draft.answers[q.id] ?? emptyAnswer())
                    ? ' ✓'
                    : ''}
                </span>
                {grade && (
                  <span
                    className="directory-score"
                    data-below-full={
                      grade.status !== 'pending' && grade.score !== null && grade.score < q.points
                    }
                  >
                    {grade.status === 'pending' ? 'Not graded' : `${grade.score} / ${q.points}`}
                  </span>
                )}
                {grade?.status === 'draft' && <span className="directory-score">Draft</span>}
              </a>
            );
          })}
        </nav>
        <div className="assignment-reading-content">
          <QuestionTree
            questions={assignment.questions}
            token={token}
            answers={assignment.submission ? savedAnswers : draft.answers}
            edit={(id, change) =>
              setDraft((old) => ({
                ...old,
                answers: {
                  ...old.answers,
                  [id]: change(
                    compatibleDraft(
                      assignment.questions.find((q) => q.id === id)!,
                      old.answers[id] ?? emptyAnswer(),
                    ),
                  ),
                },
              }))
            }
            disabled={teacher || !!assignment.submission || closed || busy}
            teacher={teacher}
            assignmentId={assignment.id}
            onStatus={onStatus}
            onUploadBusy={onUploadBusy}
            canUpload={(id, kind, size) =>
              checkAttachmentAddition(assignment.questions, draft.answers, metadata, id, kind, size)
            }
          />
          {submitted.loading && <p role="status">Loading saved answers…</p>}
          {submitted.error && <p role="alert">{submitted.error}</p>}
          {!teacher &&
            submitted.data?.results.map((r) =>
              r.feedback ? (
                <p className="published-feedback" key={r.questionId}>
                  Teacher feedback: {r.feedback}
                </p>
              ) : null,
            )}
          {issues.map((issue, i) => (
            <p className="error" role="alert" key={i}>
              {issue.message}
              {issue.questionId && <a href={`#question-${issue.questionId}`}> Go to question</a>}
            </p>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {teacher && assignment.status === 'PUBLISHED' && (
            <SubmissionReport
              assignment={assignment}
              token={token}
              onChange={onChange}
              resumeReview={resumeReview}
              onReviewDirectoryChange={setReviewDirectory}
            />
          )}
          {teacher && assignment.status === 'DRAFT' && (
            <>
              <div className="draft-actions">
                <Button className="secondary" disabled={busy} onClick={onEdit}>
                  Edit draft
                </Button>
                <Button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete draft
                </Button>
                {confirmDelete && (
                  <div role="alert">
                    <p>Delete this draft and its questions?</p>
                    <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
                      Keep draft
                    </Button>
                    <Button disabled={busy} onClick={() => void remove()}>
                      Confirm delete
                    </Button>
                  </div>
                )}
              </div>
              <Button
                className="primary wide"
                disabled={busy || closed || !!work.entries[`assignment:${assignment.id}`]}
                onClick={() => void act('publish')}
              >
                {busy ? 'Publishing…' : 'Publish to class →'}
              </Button>
            </>
          )}
          {!teacher && !assignment.submission && (
            <>
              <p className="footnote">
                {dirty ? 'Your answers are kept in this tab, but have not been submitted. ' : ''}One
                attempt. Review your answers before submitting.
                {!work.storageAvailable && ' Browser storage is unavailable. Keep this page open.'}
              </p>
              <Button
                className="primary wide"
                disabled={busy || closed || !complete}
                onClick={() => void act('submit')}
              >
                {closed ? 'Deadline passed' : busy ? 'Submitting…' : 'Submit answers →'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
type RosterRow = {
  studentId: string;
  name: string;
  email: string;
  removed: boolean;
  submission: SubmissionV2 | null;
};
function SubmissionReport({
  assignment,
  token,
  onChange,
  resumeReview,
  onReviewDirectoryChange,
}: {
  assignment: AssignmentDetailV2;
  token: string;
  onChange: () => void;
  resumeReview?: { submissionId: string; request: number } | null;
  onReviewDirectoryChange: ReviewDirectoryChange;
}) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<string | null>(resumeReview?.submissionId ?? null);
  useEffect(() => {
    if (resumeReview) setSelected(resumeReview.submissionId);
  }, [resumeReview]);
  const report = useResource<PageResult<RosterRow>>(
    `/assignments/${assignment.id}/submissions?schemaVersion=2&page=${page}&pageSize=10${status ? `&gradingStatus=${status}` : ''}`,
    token,
    revision,
  );
  const analysis = useResource<{ items: QuestionAnalysisItem[] }>(
    `/assignments/${assignment.id}/question-stats`,
    token,
    revision,
  );
  return (
    <section className="submission-report">
      <h3>Student progress</h3>
      <label>
        Filter grading status
        <SelectField
          value={status}
          onChange={(selectedValue) => {
            setStatus(selectedValue);
            setPage(1);
          }}
        >
          <option value="">All students</option>
          <option value="PENDING_REVIEW">Pending review</option>
          <option value="GRADED">Graded</option>
        </SelectField>
      </label>
      {report.loading && <p role="status">Loading progress…</p>}
      {report.error && (
        <p className="error" role="alert">
          {report.error}
          <Button onClick={() => setRevision(revision + 1)}>Retry progress</Button>
        </p>
      )}
      {report.data && (
        <>
          <p className="footnote">
            The published roster stays fixed. Removed students remain in the report.
          </p>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Student submission results</caption>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Result</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((item) => (
                  <tr key={item.studentId}>
                    <td>
                      {item.name}
                      <small>
                        {item.email}
                        {item.removed && ' · Removed'}
                      </small>
                    </td>
                    <td>
                      {!item.submission
                        ? 'Not submitted'
                        : item.submission.gradingStatus === 'PENDING_REVIEW'
                          ? 'Pending review'
                          : `${item.submission.score} / ${item.submission.maxScore}`}
                      {item.submission?.gradingStatus === 'PENDING_REVIEW' &&
                        item.submission.objectiveMaxScore > 0 && (
                          <small>
                            Automatically graded: {item.submission.objectiveScore} /{' '}
                            {item.submission.objectiveMaxScore} points
                          </small>
                        )}
                    </td>
                    <td>
                      {item.submission && (
                        <Button onClick={() => setSelected(item.submission!.id)}>
                          Review {item.name}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              ← Previous
            </Button>
            <span>Page {page}</span>
            <Button disabled={page * 10 >= report.data.total} onClick={() => setPage(page + 1)}>
              Next →
            </Button>
          </div>
        </>
      )}
      {selected && (
        <GradingReview
          key={selected}
          assignment={assignment}
          submissionId={selected}
          token={token}
          onReviewDirectoryChange={onReviewDirectoryChange}
          onClose={() => setSelected(null)}
          onChange={() => {
            setRevision(revision + 1);
            onChange();
          }}
        />
      )}
      <QuestionAnalysis
        questions={assignment.questions}
        items={analysis.data?.items}
        loading={analysis.loading}
        error={analysis.error}
      />
    </section>
  );
}
function GradingReview({
  assignment,
  submissionId,
  token,
  onClose,
  onChange,
  onReviewDirectoryChange,
}: {
  assignment: AssignmentDetailV2;
  submissionId: string;
  token: string;
  onClose: () => void;
  onChange: () => void;
  onReviewDirectoryChange: ReviewDirectoryChange;
}) {
  const [revision, setRevision] = useState(0);
  const result = useResource<SubmissionDetail>(
    `/assignments/${assignment.id}/submissions/${submissionId}`,
    token,
    revision,
  );
  if (result.error)
    return (
      <section>
        <p role="alert">{result.error}</p>
        <Button onClick={() => setRevision(revision + 1)}>Retry review</Button>
      </section>
    );
  if (!result.data) return <p role="status">Loading submission…</p>;
  return (
    <GradeForm
      key={`${submissionId}:${revision}`}
      assignment={assignment}
      submission={result.data}
      token={token}
      onClose={onClose}
      onReviewDirectoryChange={onReviewDirectoryChange}
      onChange={() => {
        setRevision(revision + 1);
        onChange();
      }}
    />
  );
}
function gradingFingerprint(answers: GradingDraft['answers']) {
  return JSON.stringify(
    [...answers]
      .sort((a, b) => a.questionId.localeCompare(b.questionId))
      .map((a) => ({
        questionId: a.questionId,
        dimensions: [...a.dimensions]
          .sort((x, y) => x.dimensionId.localeCompare(y.dimensionId))
          .map((d) => ({ dimensionId: d.dimensionId, score: d.score })),
        feedback: a.feedback,
      })),
  );
}
function GradeForm({
  assignment,
  submission,
  token,
  onClose,
  onChange,
  onReviewDirectoryChange,
}: {
  assignment: AssignmentDetailV2;
  submission: SubmissionDetail;
  token: string;
  onClose: () => void;
  onChange: () => void;
  onReviewDirectoryChange: ReviewDirectoryChange;
}) {
  const initial = {
    schemaVersion: 2 as const,
    assignmentId: assignment.id,
    submissionId: submission.id,
    gradingVersion: submission.gradingVersion,
    answers: submission.gradingDraft ?? [],
    reason: '',
    retry: null as { fingerprint: string; id: string } | null,
  };
  const [data, setData, clear] = useWorkDraft(
    `grading:${assignment.id}:${submission.id}`,
    initial,
    `Grading ${assignment.title}`,
    {
      validate: (value): value is typeof initial => {
        if (!value || typeof value !== 'object') return false;
        const v = value as typeof initial;
        return (
          v.schemaVersion === 2 &&
          v.assignmentId === assignment.id &&
          v.submissionId === submission.id &&
          Number.isInteger(v.gradingVersion) &&
          v.gradingVersion >= 0 &&
          typeof v.reason === 'string' &&
          Array.isArray(v.answers) &&
          v.answers.every(
            (answer) =>
              answer &&
              typeof answer.questionId === 'string' &&
              typeof answer.feedback === 'string' &&
              Array.isArray(answer.dimensions) &&
              answer.dimensions.every(
                (d) =>
                  d &&
                  typeof d.dimensionId === 'string' &&
                  typeof d.score === 'number' &&
                  Number.isFinite(d.score),
              ),
          )
        );
      },
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(gradingFingerprint(initial.answers));
  const confirm = useConfirm(),
    form = useRef<HTMLFormElement>(null);
  useWorkGuard(`grading-action:${submission.id}`, false, busy);
  const manual = assignment.questions.filter((q) => q.type === 'RESPONSE'),
    own = Object.fromEntries(submission.answers.map((a) => [a.questionId, restoreAnswer(a)]));
  const anchorPrefix = `review-${submission.id}-question`;
  useEffect(() => {
    const items: ReviewDirectory['items'] = {};
    for (const question of assignment.questions) {
      if (question.type === 'COMPOSITE') continue;
      const result = submission.results.find((result) => result.questionId === question.id);
      if (question.type !== 'RESPONSE') {
        items[question.id] = {
          score: result?.score ?? null,
          status: typeof result?.score === 'number' ? 'graded' : 'pending',
        };
        continue;
      }
      const draft = data.answers.find((answer) => answer.questionId === question.id);
      const published = submission.gradingRevisions?.[0]?.data.find(
        (answer) => answer.questionId === question.id,
      );
      const complete =
        draft &&
        question.config.rubric.every((dimension) => {
          const score = draft.dimensions.find((item) => item.dimensionId === dimension.id)?.score;
          return (
            typeof score === 'number' &&
            Number.isInteger(score) &&
            score >= 0 &&
            score <= dimension.points
          );
        });
      items[question.id] = draft
        ? {
            score: complete
              ? draft.dimensions.reduce((sum, dimension) => sum + dimension.score, 0)
              : null,
            status: !complete
              ? 'pending'
              : published && gradingFingerprint([draft]) === gradingFingerprint([published])
                ? 'graded'
                : 'draft',
          }
        : {
            score: result?.score ?? null,
            status: typeof result?.score === 'number' ? 'graded' : 'pending',
          };
    }
    onReviewDirectoryChange({ anchorPrefix, items });
  }, [
    assignment.questions,
    submission.results,
    submission.gradingRevisions,
    data.answers,
    anchorPrefix,
    onReviewDirectoryChange,
  ]);
  useEffect(() => () => onReviewDirectoryChange(null), [onReviewDirectoryChange]);
  function edit(
    id: string,
    change: (old: GradingDraft['answers'][number]) => GradingDraft['answers'][number],
  ) {
    setData((old) => {
      const existing = old.answers.find((a) => a.questionId === id) ?? {
        questionId: id,
        dimensions: [],
        feedback: '',
      };
      return {
        ...old,
        answers: [...old.answers.filter((a) => a.questionId !== id), change(existing)],
        retry: null,
      };
    });
  }
  async function save() {
    if (!form.current?.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<SubmissionDetail>(
        `/submissions/${submission.id}/grading`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ gradingVersion: data.gradingVersion, answers: data.answers }),
        },
      );
      setData((old) => ({ ...old, gradingVersion: result.gradingVersion, retry: null }));
      setSaved(gradingFingerprint(data.answers));
    } catch (reason) {
      // Recover a committed save whose response was lost, without overwriting a
      // different teacher draft or reapplying a stale version.
      const current = await request<SubmissionDetail>(
        `/assignments/${assignment.id}/submissions/${submission.id}`,
        token,
      ).catch(() => null);
      if (
        current &&
        current.gradingVersion > data.gradingVersion &&
        gradingFingerprint(current.gradingDraft ?? []) === gradingFingerprint(data.answers)
      ) {
        setData((old) => ({ ...old, gradingVersion: current.gradingVersion, retry: null }));
        setSaved(gradingFingerprint(data.answers));
      } else {
        setError(
          (reason as Error).message +
            ' Your grading inputs are retained. Reload saved grading to discard these inputs and resolve a version conflict.',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (submission.gradingStatus === 'GRADED' && !data.reason.trim()) {
      setError('Enter a reason before publishing an adjusted grade.');
      return;
    }
    if (gradingFingerprint(data.answers) !== saved) {
      setError('Save the complete grading draft before publishing.');
      return;
    }
    if (
      !(await confirm({
        title: 'Publish the final grade?',
        description:
          'This publishes the saved scores and feedback to the student. Previous published grades remain in the revision history.',
        confirmLabel: 'Publish final grade',
        cancelLabel: 'Keep reviewing',
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const params = { gradingVersion: data.gradingVersion, reason: data.reason },
        fingerprint = JSON.stringify(params),
        retry =
          data.retry?.fingerprint === fingerprint
            ? data.retry
            : { fingerprint, id: crypto.randomUUID() };
      setData((old) => ({ ...old, retry }));
      await request(`/submissions/${submission.id}/grading/publish`, token, {
        method: 'POST',
        body: JSON.stringify({ ...params, requestId: retry.id }),
      });
      clear();
      onChange();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grading-review">
      <h3>
        Submission review ·{' '}
        {submission.gradingStatus === 'GRADED'
          ? `${submission.score}/${submission.maxScore}`
          : 'Pending teacher review'}
      </h3>
      {submission.objectiveMaxScore > 0 && (
        <p className="result">
          <b>
            Automatically graded: {submission.objectiveScore} / {submission.objectiveMaxScore}{' '}
            points
          </b>
          {submission.gradingStatus === 'PENDING_REVIEW' && (
            <span> · Only response questions need teacher grading.</span>
          )}
        </p>
      )}
      <div className="inline-actions">
        <Button type="button" disabled={busy} onClick={onClose}>
          Close review
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              !(await confirm({
                title: 'Reload saved grading?',
                description:
                  'Discard the grading inputs in this tab and load the latest server draft. Saved grades remain available in revision history.',
                confirmLabel: 'Discard and reload',
                cancelLabel: 'Keep reviewing',
                danger: true,
              }))
            )
              return;
            clear();
            onClose();
            onChange();
          }}
        >
          Reload saved grading
        </Button>
      </div>
      {data.gradingVersion !== submission.gradingVersion &&
        data.gradingVersion < submission.gradingVersion && (
          <p role="alert">
            The saved grading draft changed while these inputs were retained. Reload saved grading
            before resolving the conflict.
          </p>
        )}
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <QuestionTree
          questions={assignment.questions}
          token={token}
          answers={own}
          edit={() => {}}
          disabled
          teacher
          showAnswerKey={false}
          results={submission.results}
          anchorPrefix={anchorPrefix}
          renderGrading={(q) => {
            if (q.type !== 'RESPONSE') return null;
            const i = manual.findIndex((question) => question.id === q.id);
            return (
              <FormFieldset disabled={busy}>
                <div className="manual-grade" key={q.id}>
                  <h4>
                    Response {i + 1} · {q.points} pts
                  </h4>
                  {q.config.rubric.map((d) => (
                    <label key={d.id}>
                      {d.name} (0–{d.points})
                      <InputField
                        aria-label={d.name}
                        type="number"
                        min={0}
                        max={d.points}
                        step={1}
                        value={
                          data.answers
                            .find((a) => a.questionId === q.id)
                            ?.dimensions.find((s) => s.dimensionId === d.id)?.score ?? ''
                        }
                        onChange={(e) =>
                          edit(q.id, (old) => ({
                            ...old,
                            dimensions: [
                              ...old.dimensions.filter((s) => s.dimensionId !== d.id),
                              ...(e.target.value === ''
                                ? []
                                : [{ dimensionId: d.id, score: Number(e.target.value) }]),
                            ],
                          }))
                        }
                      />
                      <small>{d.description}</small>
                    </label>
                  ))}
                  <label>
                    Feedback for response {i + 1}
                    <TextAreaField
                      aria-label={`Feedback for response ${i + 1}`}
                      value={data.answers.find((a) => a.questionId === q.id)?.feedback ?? ''}
                      onChange={(e) => edit(q.id, (old) => ({ ...old, feedback: e.target.value }))}
                    />
                  </label>
                </div>
              </FormFieldset>
            );
          }}
        />
        {manual.length > 0 && (
          <>
            {submission.gradingStatus === 'GRADED' && (
              <FormFieldset disabled={busy}>
                <label>
                  Reason for adjusting the grade
                  <InputField
                    value={data.reason}
                    onChange={(e) =>
                      setData((old) => ({ ...old, reason: e.target.value, retry: null }))
                    }
                  />
                </label>
              </FormFieldset>
            )}
            <div className="inline-actions">
              <p role="status">
                {gradingFingerprint(data.answers) === saved
                  ? 'Grading draft saved.'
                  : 'Grading draft has unsaved changes.'}
              </p>
              <Button disabled={busy}>Save grading draft</Button>
              <Button type="button" disabled={busy} onClick={() => void publish()}>
                Publish final grade
              </Button>
            </div>
          </>
        )}
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>Published grade history</summary>
        {submission.gradingRevisions?.map((revision) => (
          <div key={revision.version}>
            <b>
              Version {revision.version} · {revision.score}/{revision.maxScore}
            </b>
            <p>
              {dateLabel(revision.createdAt)} · {revision.reason || 'Initial grade'}
            </p>
            {revision.data.map((a) => (
              <p key={a.questionId}>{a.feedback}</p>
            ))}
          </div>
        ))}
      </details>
    </section>
  );
}
