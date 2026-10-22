import { Button, SelectField, FormFieldset, InputField, TextAreaField } from './Controls';
import { useEffect, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import {
  createAssignmentV2Schema,
  questionV2Schema,
  allQuestionContents,
  contentAssets,
  mediaLimits,
  publicQuestion,
  scoreUnitCount,
  type AssignmentDetailV2,
  type Classroom,
  type QuestionV2,
  type ValidationProblem,
} from '@amp/contracts';
import { request, ApiError } from './api';
import { useConfirm } from './ConfirmDialog';
import { useWork, useWorkDraft, useWorkGuard } from './WorkProtection';
import { TeacherKey } from './AssignmentView';
import { QuestionEditor } from './QuestionEditor';
import {
  cloneQuestions,
  newQuestion,
  questionLabels,
  questionNumbers,
  reindexQuestions,
  reconcileSavedQuestions,
  unitPoints,
  withDerivedPoints,
} from './question-editor';
import { hasRemoval, restoreRemoval, type Removal } from './removal-history';
import {
  QuestionProblems,
  currentQuestionProblems,
  uniqueProblems,
  focusProblem,
} from './QuestionValidation';
import { AuthoringReview, type CheckPhase } from './AuthoringReview';
import { ContentView, TeachingCapacity, UploadWorkspace } from './Media';
import { QuestionAnswer, emptyAnswer, type DraftAnswer } from './QuestionAnswer';

import { recoverTeacherDraft, type EditorDraft } from './work-migration';
import { LegacyWorkNotice } from './LegacyWorkNotice';
function initialDraft(initial: AssignmentDetailV2 | undefined, classes: Classroom[]): EditorDraft {
  const date = initial ? new Date(initial.dueAt) : null;
  const local = date
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  return {
    schemaVersion: 2,
    id: initial?.id,
    version: initial?.version,
    classId: initial?.classId ?? classes[0]?.id ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    dueDate: local.slice(0, 10),
    dueTime: local.slice(11),
    questions: initial
      ? initial.questions.map((q) => withDerivedPoints(questionV2Schema.parse(q)))
      : [newQuestion('SINGLE_CHOICE')],
  };
}
// Retain over-limit local edits for correction; recovery checks shape while the
// unmodified shared contract enforces all limits when saving or publishing.
function recoveryShape(value: unknown, field = ''): unknown {
  if (typeof value === 'string') return [...value].slice(0, 100).join('');
  if (typeof value === 'number' && field === 'points') return Math.max(0, Math.min(100, value));
  if (typeof value === 'number' && field === 'maxImageBytes')
    return Math.max(1, Math.min(mediaLimits.imageBytes, value));
  if (typeof value === 'number' && field === 'maxAudioBytes')
    return Math.max(1, Math.min(mediaLimits.audioBytes, value));
  if (Array.isArray(value)) {
    const projected = value.map((v) => recoveryShape(v, field));
    return field === 'values' && value.every((v) => typeof v === 'string')
      ? projected.slice(0, 10)
      : projected;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, recoveryShape(v, key)]),
    );
  return value;
}
function isDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as EditorDraft;
  return (
    v.schemaVersion === 2 &&
    ['classId', 'title', 'description', 'dueDate', 'dueTime'].every(
      (key) => typeof v[key as keyof EditorDraft] === 'string',
    ) &&
    Array.isArray(v.questions) &&
    v.questions.length <= 500 &&
    v.questions.every((q) => questionV2Schema.safeParse(recoveryShape(q)).success)
  );
}
export function AssignmentForm({
  classes,
  token,
  onCreated,
  onCancel,
  onCreateClass,
  initial,
}: {
  initial?: AssignmentDetailV2;
  classes: Classroom[];
  token: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
  onCreateClass: () => void;
}) {
  const work = useWork();
  const key = `assignment:${initial?.id ?? 'new'}`;
  const [data, setData, clear, dirty] = useWorkDraft(
    key,
    initialDraft(initial, classes),
    initial?.title ?? 'New assignment',
    { validate: isDraft, recover: (value) => recoverTeacherDraft(value, initial) },
  );
  const confirm = useConfirm(),
    form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [undo, setUndo] = useState<Removal[]>([]);
  const [showErrors, setShowErrors] = useState(false),
    [preview, setPreview] = useState<'student' | 'teacher' | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, DraftAnswer>>({});
  const [newType, setNewType] = useState('SINGLE_CHOICE'),
    [serverProblems, setServerProblems] = useState<ValidationProblem[]>([]);
  const [checking, setChecking] = useState(false),
    [filesChecked, setFilesChecked] = useState(false);
  const [checkPhase, setCheckPhase] = useState<CheckPhase>('idle');
  const [checkFailure, setCheckFailure] = useState('');
  const [validationAttempt, setValidationAttempt] = useState(0);
  const validationSummary = useRef<HTMLDivElement>(null),
    checkSequence = useRef(0);
  useEffect(() => {
    if (!validationAttempt || !validationSummary.current) return;
    const summary = validationSummary.current;
    const { top } = summary.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight) summary.scrollIntoView({ block: 'start' });
    summary.focus({ preventScroll: true });
  }, [validationAttempt]);
  useWorkGuard(`saving:${key}`, false, busy);
  const questions = data.questions.map(withDerivedPoints),
    roots = questions.filter((q) => q.parentId === null).sort((a, b) => a.position - b.position);
  const numbers = questionNumbers(questions);
  const total = questions
    .filter((q) => q.type !== 'COMPOSITE')
    .reduce((sum, q) => sum + (unitPoints(q) ?? q.points), 0);
  const deadline = new Date(`${data.dueDate}T${data.dueTime}`);
  const metadataProblems: ValidationProblem[] = [
    ...(!data.title.trim()
      ? [{ path: 'title', code: 'REQUIRED', message: 'Enter an assignment title.' }]
      : []),
    ...(!data.classId ? [{ path: 'classId', code: 'REQUIRED', message: 'Choose a class.' }] : []),
    ...(!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()
      ? [{ path: 'dueAt', code: 'INVALID_DEADLINE', message: 'Choose a deadline in the future.' }]
      : []),
  ];
  const problems = showErrors
    ? uniqueProblems([
        ...metadataProblems,
        ...currentQuestionProblems(questions),
        ...serverProblems,
      ])
    : [];
  const teachingIds = new Set(
    questions.flatMap((q) =>
      allQuestionContents(q)
        .flatMap(contentAssets)
        .map((b) => b.assetId),
    ),
  );
  const requestBytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 2,
      classId: data.classId,
      title: data.title,
      description: data.description,
      dueAt: '2035-10-01T00:00:00.000Z',
      questions,
      ...(data.id ? { version: data.version } : {}),
    }),
  ).length;
  function patch(change: Partial<EditorDraft>) {
    setData((old) => ({ ...old, ...change }));
    invalidateCheck();
  }
  function invalidateCheck() {
    checkSequence.current++;
    setChecking(false);
    setFilesChecked(false);
    setServerProblems([]);
    setCheckFailure('');
    setCheckPhase((phase) => (phase === 'idle' ? 'idle' : 'stale'));
  }
  function editQuestions(action: SetStateAction<QuestionV2[]>) {
    setData((old) => {
      const next = reindexQuestions(
        (typeof action === 'function' ? action(old.questions) : action).map(withDerivedPoints),
      );
      if (hasRemoval(old.questions, next))
        setUndo((history) => [...history, { before: old.questions, after: next }].slice(-20));
      return {
        ...old,
        questions: next,
      };
    });
    invalidateCheck();
  }
  function editQuestion(id: string, action: SetStateAction<QuestionV2>) {
    editQuestions((old) =>
      old.map((q) => (q.id === id ? (typeof action === 'function' ? action(q) : action) : q)),
    );
  }
  function add(parent: string | null = null, type = newType) {
    editQuestions((old) => [
      ...old,
      newQuestion(
        type === 'READING' ? 'COMPOSITE' : (type as QuestionV2['type']),
        parent,
        old.filter((q) => q.parentId === parent).length,
        type === 'READING',
      ),
    ]);
  }
  function move(q: QuestionV2, offset: number) {
    editQuestions((old) => {
      const siblings = old
          .filter((s) => s.parentId === q.parentId)
          .sort((a, b) => a.position - b.position),
        from = siblings.findIndex((s) => s.id === q.id),
        to = from + offset;
      if (to < 0 || to >= siblings.length) return old;
      [siblings[from], siblings[to]] = [siblings[to]!, siblings[from]!];
      const order = new Map(siblings.map((s, i) => [s.id, i]));
      return old
        .map((s) => (order.has(s.id) ? { ...s, position: order.get(s.id)! } : s))
        .sort(
          (a, b) => (a.parentId ?? '').localeCompare(b.parentId ?? '') || a.position - b.position,
        );
    });
  }
  async function remove(q: QuestionV2) {
    const children = questions.filter((c) => c.parentId === q.id);
    if (
      q.type === 'COMPOSITE' &&
      !(await confirm({
        title: 'Delete this question group?',
        description: `This removes the shared material and ${children.length} child questions. You can undo the removal while editing.`,
        confirmLabel: 'Delete group',
        cancelLabel: 'Keep group',
        danger: true,
      }))
    )
      return;
    editQuestions((old) => old.filter((s) => s.id !== q.id && s.parentId !== q.id));
  }
  async function cancel() {
    if (
      !dirty ||
      (await confirm({
        title: 'Discard these edits?',
        description: data.id
          ? 'The saved server draft stays. Unsaved edits are removed from this tab.'
          : 'This unfinished assignment is removed from this tab.',
        danger: true,
      }))
    ) {
      clear();
      onCancel();
    }
  }
  async function save(stay = false) {
    if (busy || !form.current?.reportValidity()) return;
    if (!stay && work.uploading) {
      setError('Wait for uploads to finish, or choose Save and keep editing.');
      return;
    }
    setError('');
    invalidateCheck();
    setBusy(true);
    try {
      const parsed = createAssignmentV2Schema.safeParse({
        schemaVersion: 2,
        classId: data.classId,
        title: data.title,
        description: data.description,
        dueAt: new Date(`${data.dueDate}T${data.dueTime}`).toISOString(),
        questions,
      });
      if (!parsed.success) {
        setServerProblems(
          parsed.error.issues.map((issue) => ({
            questionId:
              issue.path[0] === 'questions'
                ? typeof issue.path[1] === 'number'
                  ? questions[issue.path[1]]?.id
                  : typeof issue.path[1] === 'string' && issue.path[1]
                    ? issue.path[1]
                    : undefined
                : undefined,
            path:
              issue.path[0] === 'questions'
                ? issue.path.slice(2).join('.') || 'questions'
                : issue.path.join('.'),
            code: 'INVALID_DRAFT',
            message: issue.message,
          })),
        );
        setShowErrors(true);
        setCheckPhase('checked');
        setValidationAttempt((n) => n + 1);
        return;
      }
      const body = JSON.stringify({
        ...parsed.data,
        ...(data.id ? { version: data.version } : {}),
      });
      if (new TextEncoder().encode(body).length > mediaLimits.jsonBytes)
        throw new Error(
          'The assignment exceeds the 2 MiB JSON limit. Reduce text or remove items.',
        );
      const result = await request<AssignmentDetailV2>(
        data.id ? `/assignments/${data.id}` : '/assignments',
        token,
        { method: data.id ? 'PATCH' : 'POST', body },
      );
      if (stay) {
        setData((latest) => ({
          ...latest,
          id: result.id,
          version: result.version,
          questions: reconcileSavedQuestions(
            data.questions,
            latest.questions,
            result.questions.map((q) => questionV2Schema.parse(q)),
          ),
        }));
      } else {
        clear();
        onCreated(result.id);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Saving failed. Your edits are still in this tab.',
      );
      if (reason instanceof ApiError && reason.errors) {
        setServerProblems(reason.errors);
        setShowErrors(true);
        setCheckPhase('checked');
        setValidationAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    const sequence = ++checkSequence.current;
    setShowErrors(true);
    setServerProblems([]);
    setFilesChecked(false);
    setError('');
    setCheckFailure('');
    setCheckPhase('checked');
    setValidationAttempt((n) => n + 1);
    if (data.id && data.version && questionV2Schema.array().max(120).safeParse(questions).success) {
      setChecking(true);
      setCheckPhase('checking');
      try {
        const result = await request<{ errors: ValidationProblem[] }>(
          `/assignments/${data.id}/validate`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({ schemaVersion: 2, version: data.version, questions }),
          },
        );
        if (sequence !== checkSequence.current) return;
        setServerProblems(result.errors);
        setFilesChecked(true);
        setCheckPhase('checked');
        setValidationAttempt((n) => n + 1);
      } catch (reason) {
        if (sequence === checkSequence.current) {
          setCheckFailure((reason as Error).message);
          setCheckPhase('failed');
        }
      } finally {
        if (sequence === checkSequence.current) setChecking(false);
      }
    }
  }
  function render(q: QuestionV2, display: string) {
    const questionProblems = problems.filter((p) => p.questionId === q.id);
    const children = questions
        .filter((s) => s.parentId === q.id)
        .sort((a, b) => a.position - b.position),
      siblings = questions.filter((s) => s.parentId === q.parentId);
    return (
      <QuestionProblems.Provider key={q.id} value={questionProblems}>
        <article className="editor-question" id={`edit-${q.id}`}>
          <div className="editor-question-header">
            <h3>
              Question {display} ·{' '}
              {q.type === 'COMPOSITE' && q.config.kind === 'READING'
                ? 'Reading'
                : questionLabels[q.type]}
            </h3>
            <div className="inline-actions">
              <Button
                type="button"
                disabled={busy || q.position === 0}
                aria-label={`Move question ${display} up`}
                onClick={() => move(q, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                disabled={busy || q.position === siblings.length - 1}
                aria-label={`Move question ${display} down`}
                onClick={() => move(q, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  editQuestions((old) => [...old, ...cloneQuestions([q, ...children])])
                }
              >
                Copy question {display}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void remove(q)}>
                Remove question {display}
              </Button>
            </div>
          </div>
          {questionProblems.length > 0 && (
            <Button
              type="button"
              className="question-issue-link"
              onClick={() => focusProblem(questionProblems[0]!)}
            >
              {questionProblems.length} {questionProblems.length === 1 ? 'issue' : 'issues'} in this
              question · Go to first issue ↗
            </Button>
          )}
          {q.type !== 'COMPOSITE' && roots.some((r) => r.type === 'COMPOSITE') && (
            <label>
              Place question in
              <SelectField
                value={q.parentId ?? ''}
                onChange={(selectedValue) =>
                  editQuestion(q.id, (old) =>
                    old.type === 'COMPOSITE' ? old : { ...old, parentId: selectedValue || null },
                  )
                }
              >
                <option value="">Top level</option>
                {roots
                  .filter((r) => r.type === 'COMPOSITE')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      Group {numbers.get(r.id)}
                    </option>
                  ))}
              </SelectField>
            </label>
          )}
          <FormFieldset disabled={busy}>
            <QuestionEditor
              q={q}
              number={display}
              token={token}
              assignmentId={data.id}
              edit={(action) => editQuestion(q.id, action)}
            />
          </FormFieldset>
          {q.type === 'COMPOSITE' && (
            <details open>
              <summary>
                {children.length} child questions · {children.reduce((sum, c) => sum + c.points, 0)}{' '}
                points
              </summary>
              {children.map((child, i) => render(child, `${display}.${i + 1}`))}
              <AddChild disabled={busy || children.length >= 10} add={(type) => add(q.id, type)} />
            </details>
          )}
        </article>
      </QuestionProblems.Provider>
    );
  }
  return (
    <form
      ref={form}
      className="assignment-form mixed-editor"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="form-heading">
        <span className="eyebrow">TEACHER WORKSPACE</span>
        <h2>{initial ? 'Edit assignment' : 'Create an assignment'}</h2>
        <p>Save incomplete work, then preview and check it before publishing.</p>
      </div>
      <div className="authoring-layout">
        <AuthoringReview
          questions={questions}
          problems={problems}
          total={total}
          phase={checkPhase}
          filesChecked={filesChecked}
          saved={!!data.id}
          failure={checkFailure}
          disabled={busy || checking}
          check={() => void check()}
          summaryRef={validationSummary}
        />
        <div className="authoring-canvas">
          <LegacyWorkNotice
            raw={
              data.legacyBackup ??
              (work.entries[key] && !isDraft(work.entries[key].value)
                ? work.entries[key].value
                : undefined)
            }
            teacher
            recovered={data.legacyBackup !== undefined}
          />
          <FormFieldset disabled={busy} className="editor-basics">
            <h3>Assignment details</h3>
            <label>
              Title
              <InputField
                data-assignment-field="title"
                aria-invalid={
                  (showErrors && metadataProblems.some((p) => p.path === 'title')) || undefined
                }
                aria-describedby={
                  showErrors && metadataProblems.some((p) => p.path === 'title')
                    ? 'assignment-title-error'
                    : undefined
                }
                required
                value={data.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            {showErrors &&
              metadataProblems
                .filter((p) => p.path === 'title')
                .map((p) => (
                  <p key={p.path} id="assignment-title-error" className="field-error">
                    {p.message}
                  </p>
                ))}
            <label>
              Class
              <SelectField
                data-assignment-field="classId"
                required
                disabled={!!data.id}
                value={data.classId}
                onChange={(selectedValue) => patch({ classId: selectedValue })}
              >
                <option value="">Choose a class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
            </label>
            {!classes.length && (
              <Button type="button" onClick={onCreateClass}>
                Create a class
              </Button>
            )}
            <label>
              Description
              <TextAreaField
                rows={2}
                value={data.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Deadline date
                <InputField
                  type="date"
                  data-assignment-field="dueAt"
                  aria-invalid={
                    (showErrors && metadataProblems.some((p) => p.path === 'dueAt')) || undefined
                  }
                  aria-describedby={
                    showErrors && metadataProblems.some((p) => p.path === 'dueAt')
                      ? 'assignment-deadline-error'
                      : undefined
                  }
                  required
                  value={data.dueDate}
                  onChange={(e) => patch({ dueDate: e.target.value })}
                />
              </label>
              <label>
                Deadline time
                <InputField
                  type="time"
                  required
                  value={data.dueTime}
                  onChange={(e) => patch({ dueTime: e.target.value })}
                />
              </label>
            </div>
            {showErrors &&
              metadataProblems
                .filter((p) => p.path === 'dueAt')
                .map((p) => (
                  <p key={p.path} id="assignment-deadline-error" className="field-error">
                    {p.message}
                  </p>
                ))}
          </FormFieldset>
          <p className="editor-summary" role="status">
            {roots.length}/20 top-level · {questions.filter((q) => q.type !== 'COMPOSITE').length}
            /100 answerable · {questions.reduce((sum, q) => sum + scoreUnitCount(q), 0)}/200 scoring
            units · {total} points · {teachingIds.size}/100 teaching files
          </p>

          <p role="status" className={requestBytes > mediaLimits.jsonBytes ? 'error' : 'footnote'}>
            Question JSON: {(requestBytes / 1048576).toFixed(3)} / 2 MiB ·{' '}
            {Math.max(0, mediaLimits.jsonBytes - requestBytes).toLocaleString()} bytes remaining.
            Saving checks the final UTF-8 payload.
          </p>
          {data.id && (
            <TeachingCapacity assignmentId={data.id} token={token} assetIds={[...teachingIds]} />
          )}
          {data.id && (
            <p className="footnote">
              Uploads are linked to this saved draft. Unbound teaching uploads expire after 24
              hours. Save again after adding files.
            </p>
          )}
          {data.id && <UploadWorkspace assignmentId={data.id} token={token} />}
          {!questions.length && <p>No questions yet. Empty drafts can be saved.</p>}
          {roots.map((q, i) => render(q, String(i + 1)))}
          <div className="inline-actions">
            <label>
              Add question type
              <SelectField
                disabled={busy}
                value={newType}
                onChange={(selectedValue) => setNewType(selectedValue)}
              >
                {Object.entries(questionLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
                <option value="READING">Reading group</option>
              </SelectField>
            </label>
            <Button type="button" disabled={busy || roots.length >= 20} onClick={() => add()}>
              Add question
            </Button>
          </div>
          {undo.length > 0 && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                patch({ questions: restoreRemoval(undo.at(-1)!, data.questions) });
                setUndo((history) => history.slice(0, -1));
              }}
            >
              Undo removal
            </Button>
          )}
          <div className="inline-actions">
            <Button type="button" onClick={() => validationSummary.current?.focus()}>
              Review points &amp; checks ↑
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview('student');
                setPreviewAnswers({});
              }}
            >
              Student preview
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview('teacher');
                setPreviewAnswers({});
              }}
            >
              Teacher preview
            </Button>
          </div>
          {preview && (
            <section className="assignment-preview">
              <h3>{preview === 'student' ? 'Student' : 'Teacher'} preview</h3>
              <p>
                This preview does not submit. Save to generate the starting order for sorting tasks.
              </p>
              <Button type="button" onClick={() => setPreview(null)}>
                Close preview
              </Button>
              {roots.map((root, i) => {
                const leaf = (q: QuestionV2, display: string) =>
                  q.type === 'COMPOSITE' ? null : (
                    <div key={q.id}>
                      <QuestionAnswer
                        q={
                          preview === 'student'
                            ? (publicQuestion(q) as Exclude<
                                ReturnType<typeof publicQuestion>,
                                { type: 'COMPOSITE' }
                              >)
                            : q
                        }
                        number={display}
                        token={token}
                        answer={previewAnswers[q.id] ?? emptyAnswer()}
                        disabled={preview === 'teacher'}
                        teacher={preview === 'teacher'}
                        onChange={(action) =>
                          setPreviewAnswers((old) => ({
                            ...old,
                            [q.id]: action(old[q.id] ?? emptyAnswer()),
                          }))
                        }
                      />
                      {preview === 'teacher' && <TeacherKey q={q} token={token} />}
                    </div>
                  );
                return root.type === 'COMPOSITE' ? (
                  <section key={root.id}>
                    <h4>Question {i + 1} · Shared materials</h4>
                    <ContentView content={root.prompt} token={token} />
                    {questions
                      .filter((q) => q.parentId === root.id)
                      .sort((a, b) => a.position - b.position)
                      .map((child, j) => leaf(child, `${i + 1}.${j + 1}`))}
                  </section>
                ) : (
                  leaf(root, String(i + 1))
                );
              })}
            </section>
          )}
          {initial && data.version !== undefined && data.version < initial.version && (
            <p role="alert" className="error">
              The saved draft has changed since you started editing. Your inputs are retained.
              Cancel to discard and reload, or copy your edits before resolving the conflict.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
              {error.includes('changed') &&
                ' Keep these edits. Cancel to discard and reload, or copy your edits before resolving the conflict.'}
            </p>
          )}
          <div className="form-actions">
            <Button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Save and keep editing
            </Button>
            <Button className="primary" disabled={busy || !classes.length}>
              {busy ? 'Saving…' : data.id ? 'Save changes' : 'Save draft →'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
function AddChild({ add, disabled }: { add: (type: string) => void; disabled: boolean }) {
  const [type, setType] = useState('SINGLE_CHOICE');
  return (
    <div className="inline-actions">
      <label>
        Child question type
        <SelectField
          disabled={disabled}
          value={type}
          onChange={(selectedValue) => setType(selectedValue)}
        >
          {Object.entries(questionLabels)
            .filter(([id]) => id !== 'COMPOSITE')
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </SelectField>
      </label>
      <Button type="button" disabled={disabled} onClick={() => add(type)}>
        Add child question
      </Button>
    </div>
  );
}
