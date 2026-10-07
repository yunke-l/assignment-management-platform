import { useRef, useState, type FormEvent } from 'react';
import { createAssignmentSchema, type AssignmentDetail, type Classroom } from '@amp/contracts';
import { request } from './api';
import { useConfirm } from './ConfirmDialog';
import { useWork, useWorkDraft, useWorkGuard } from './WorkProtection';

type Choice = { id: string; text: string };
type EditorQuestion = {
  id: string;
  prompt: string;
  options: Choice[];
  correctId: string;
  points: string;
};
type EditorDraft = {
  classId: string;
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  questions: EditorQuestion[];
  version?: number;
};
const blankQuestion = (): EditorQuestion => {
  const options = Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), text: '' }));
  return { id: crypto.randomUUID(), prompt: '', options, correctId: options[0]!.id, points: '10' };
};
function isDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as EditorDraft;
  return (
    ['classId', 'title', 'description', 'dueDate', 'dueTime'].every(
      (key) => typeof v[key as keyof EditorDraft] === 'string',
    ) &&
    (v.version === undefined || Number.isInteger(v.version)) &&
    Array.isArray(v.questions) &&
    v.questions.length > 0 &&
    v.questions.length <= 20 &&
    v.questions.every(
      (q) =>
        q &&
        typeof q.id === 'string' &&
        typeof q.prompt === 'string' &&
        typeof q.points === 'string' &&
        typeof q.correctId === 'string' &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.options.length <= 6 &&
        q.options.every((o) => o && typeof o.id === 'string' && typeof o.text === 'string') &&
        q.options.some((o) => o.id === q.correctId),
    )
  );
}
function initialDraft(initial: AssignmentDetail | undefined, classes: Classroom[]): EditorDraft {
  let local = '';
  if (initial) {
    const date = new Date(initial.dueAt);
    local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return {
    classId: initial?.classId ?? classes[0]?.id ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    dueDate: local.slice(0, 10),
    dueTime: local.slice(11, 16),
    version: initial?.version,
    questions: initial?.questions.map((q) => {
      const options = q.options.map((text) => ({ id: crypto.randomUUID(), text }));
      return {
        id: crypto.randomUUID(),
        prompt: q.prompt,
        options,
        correctId: options[q.correctIndex ?? 0]!.id,
        points: String(q.points),
      };
    }) ?? [blankQuestion()],
  };
}
function validate(value: EditorDraft) {
  const errors: Record<string, string> = {};
  if (!value.title.trim()) errors.title = 'Give this assignment a title.';
  if (!value.classId) errors.classId = 'Choose a class before saving.';
  if (!value.dueDate) errors.dueDate = 'Choose a deadline date.';
  if (!value.dueTime) errors.dueTime = 'Choose a deadline time.';
  if (
    value.dueDate &&
    value.dueTime &&
    !Number.isFinite(new Date(`${value.dueDate}T${value.dueTime}`).getTime())
  )
    errors.dueDate = 'Enter a valid deadline.';
  for (const q of value.questions) {
    if (!q.prompt.trim()) errors[q.id] = 'Write a question.';
    for (const option of q.options)
      if (!option.text.trim()) errors[option.id] = 'Add an answer option.';
    if (
      !q.points ||
      !Number.isInteger(Number(q.points)) ||
      Number(q.points) < 1 ||
      Number(q.points) > 100
    )
      errors[`${q.id}-points`] = 'Use a whole number from 1 to 100.';
  }
  return errors;
}
function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
    </svg>
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
  initial?: AssignmentDetail;
  classes: Classroom[];
  token: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
  onCreateClass: () => void;
}) {
  const key = `assignment:${initial?.id ?? 'new'}`;
  const [data, setData, clear, dirty] = useWorkDraft(
    key,
    initialDraft(initial, classes),
    initial?.title ?? 'New assignment',
    { validate: isDraft },
  );
  const { storageAvailable } = useWork();
  const confirm = useConfirm();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<EditorQuestion[] | null>(null);
  useWorkGuard(`saving:${key}`, false, busy);
  const errors = showErrors ? validate(data) : {};
  const fieldProps = (id: string) => ({
    'aria-invalid': errors[id] ? (true as const) : undefined,
    'aria-describedby': errors[id] ? `error-${id}` : undefined,
  });
  const hint = (id: string) =>
    errors[id] ? (
      <span className="field-error" id={`error-${id}`}>
        {errors[id]}
      </span>
    ) : null;
  function patch(value: Partial<EditorDraft>) {
    setUndo(null);
    setData((old) => ({ ...old, ...value }));
  }
  function update(id: string, value: Partial<EditorQuestion>) {
    patch({ questions: data.questions.map((q) => (q.id === id ? { ...q, ...value } : q)) });
  }
  function remove(questions: EditorQuestion[]) {
    setUndo(data.questions);
    setData((old) => ({ ...old, questions }));
  }
  async function cancel() {
    if (
      !dirty ||
      (await confirm({
        title: 'Discard these edits?',
        description: initial
          ? 'Your saved draft will stay unchanged. These unsaved edits will be removed from this tab.'
          : 'This unfinished assignment will be removed from this tab.',
        danger: true,
      }))
    ) {
      clear();
      onCancel();
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setShowErrors(true);
    if (Object.keys(validate(data)).length) {
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setBusy(true);
    try {
      const input = createAssignmentSchema.parse({
        classId: data.classId,
        title: data.title,
        description: data.description,
        dueAt: new Date(`${data.dueDate}T${data.dueTime}`).toISOString(),
        questions: data.questions.map((q) => ({
          prompt: q.prompt,
          options: q.options.map((o) => o.text),
          correctIndex: q.options.findIndex((o) => o.id === q.correctId),
          points: Number(q.points),
        })),
      });
      const result = await request<AssignmentDetail>(
        initial ? `/assignments/${initial.id}` : '/assignments',
        token,
        {
          method: initial ? 'PATCH' : 'POST',
          body: JSON.stringify(initial ? { ...input, version: data.version } : input),
        },
      );
      clear();
      onCreated(result.id);
    } catch (e) {
      setError(
        e instanceof Error && 'issues' in e
          ? 'Check the title, deadline and every question before saving.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={form} className="assignment-editor" onSubmit={submit} noValidate>
      <header className="editor-heading">
        <div>
          <span className="eyebrow">ASSIGNMENT STUDIO</span>
          <h2 className="detail-title">{initial ? 'Edit assignment' : 'Create an assignment'}</h2>
          <p className="muted">A clear question is a good place to start.</p>
        </div>
        <span className="editor-count">
          {data.questions.length} {data.questions.length === 1 ? 'question' : 'questions'}
        </span>
      </header>
      {initial && data.version !== initial.version && (
        <p className="error" role="alert">
          The saved draft has changed since you started editing. Your local edits are kept. Saving
          will check for a conflict; cancel these edits to load the latest version.
        </p>
      )}
      {!classes.length && (
        <p className="empty-class-note">
          Create a class to save this assignment. Your edits will stay here.{' '}
          <button type="button" className="text-button" onClick={onCreateClass}>
            Go to Classes
          </button>
        </p>
      )}
      <fieldset disabled={busy} className="form-fields">
        <section className="editor-basics" aria-label="Assignment details">
          <h3>Assignment details</h3>
          <label>
            Title
            <input
              required
              maxLength={120}
              placeholder="e.g. Woodland reading · Week 1"
              value={data.title}
              onChange={(e) => patch({ title: e.target.value })}
              {...fieldProps('title')}
            />
            {hint('title')}
          </label>
          <div className="editor-meta">
            <label>
              Class
              <select
                required
                disabled={!!initial}
                value={data.classId}
                onChange={(e) => patch({ classId: e.target.value })}
                {...fieldProps('classId')}
              >
                <option value="" disabled>
                  Select a class
                </option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {hint('classId')}
            </label>
            <label>
              Deadline date
              <input
                type="date"
                required
                value={data.dueDate}
                onChange={(e) => patch({ dueDate: e.target.value })}
                {...fieldProps('dueDate')}
              />
              {hint('dueDate')}
            </label>
            <label>
              Deadline time
              <input
                type="time"
                required
                value={data.dueTime}
                onChange={(e) => patch({ dueTime: e.target.value })}
                {...fieldProps('dueTime')}
              />
              {hint('dueTime')}
            </label>
          </div>
          <p className="field-help">Deadline uses your local time zone.</p>
          <label>
            Instructions <span className="optional">Optional</span>
            <textarea
              maxLength={2000}
              rows={2}
              placeholder="What would you like your students to know?"
              value={data.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
        </section>
        <div className="question-section-heading">
          <h3>Questions</h3>
          <span className="muted">
            {data.questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0)} total points
          </span>
        </div>
        {data.questions.map((q, index) => (
          <section className="editor-question" key={q.id} aria-label={`Question ${index + 1}`}>
            <div className="question-toolbar">
              <h3>
                <span className="question-number">{index + 1}</span>Question {index + 1}
              </h3>
              <div className="question-tools">
                <label className="points-field">
                  Points
                  <input
                    type="number"
                    required
                    min={1}
                    max={100}
                    value={q.points}
                    onChange={(e) => update(q.id, { points: e.target.value })}
                    {...fieldProps(`${q.id}-points`)}
                  />
                </label>
                {data.questions.length > 1 && (
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove question ${index + 1}`}
                    title="Remove question"
                    onClick={() => remove(data.questions.filter((item) => item.id !== q.id))}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
            {hint(`${q.id}-points`)}
            <label>
              Question text
              <textarea
                rows={2}
                required
                maxLength={1000}
                placeholder="Ask something worth discovering…"
                value={q.prompt}
                onChange={(e) => update(q.id, { prompt: e.target.value })}
                {...fieldProps(q.id)}
              />
              {hint(q.id)}
            </label>
            <div className="option-heading">
              <span>Answer options</span>
              <span>Select the circle to mark the correct answer.</span>
            </div>
            <div className="editor-options">
              {q.options.map((option, i) => (
                <div
                  key={option.id}
                  className={`editor-option ${q.correctId === option.id ? 'is-answer' : ''}`}
                >
                  <label
                    className="answer-toggle"
                    title={`Mark option ${String.fromCharCode(65 + i)} as correct`}
                  >
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      aria-label={`Mark option ${String.fromCharCode(65 + i)} as correct for question ${index + 1}`}
                      checked={q.correctId === option.id}
                      onChange={() => update(q.id, { correctId: option.id })}
                    />
                    <span aria-hidden="true">
                      {q.correctId === option.id ? '✓' : String.fromCharCode(65 + i)}
                    </span>
                  </label>
                  <div className="option-input">
                    <label className="sr-only" htmlFor={option.id}>
                      Option {String.fromCharCode(65 + i)}
                    </label>
                    <input
                      id={option.id}
                      required
                      maxLength={500}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      value={option.text}
                      onChange={(e) =>
                        update(q.id, {
                          options: q.options.map((old) =>
                            old.id === option.id ? { ...old, text: e.target.value } : old,
                          ),
                        })
                      }
                      {...fieldProps(option.id)}
                    />
                    {hint(option.id)}
                  </div>
                  {q.options.length > 2 && (
                    <button
                      type="button"
                      className="icon-button remove-option"
                      title="Remove option"
                      aria-label={`Remove option ${String.fromCharCode(65 + i)} from question ${index + 1}`}
                      onClick={() =>
                        remove(
                          data.questions.map((old) =>
                            old.id === q.id
                              ? {
                                  ...old,
                                  options: old.options.filter((o) => o.id !== option.id),
                                  correctId:
                                    old.correctId === option.id
                                      ? old.options.find((o) => o.id !== option.id)!.id
                                      : old.correctId,
                                }
                              : old,
                          ),
                        )
                      }
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="text-button add-option"
              aria-label={`Add option to question ${index + 1}`}
              disabled={q.options.length >= 6}
              onClick={() => {
                const choice = { id: crypto.randomUUID(), text: '' };
                update(q.id, { options: [...q.options, choice] });
                requestAnimationFrame(() => document.getElementById(choice.id)?.focus());
              }}
            >
              + Add option <span className="muted">{q.options.length}/6</span>
            </button>
          </section>
        ))}
        {undo && (
          <div className="undo-notice" role="status">
            Removed from this assignment.
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setData((old) => ({ ...old, questions: undo }));
                setUndo(null);
              }}
            >
              Undo removal
            </button>
          </div>
        )}
        <button
          type="button"
          className="add-question"
          disabled={data.questions.length >= 20}
          onClick={() => {
            const question = blankQuestion();
            patch({ questions: [...data.questions, question] });
          }}
        >
          + Add question
        </button>
        {Object.keys(errors).length > 0 && (
          <p className="error" role="alert">
            Check the highlighted fields before saving.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-savebar">
          <span className={`save-status ${dirty ? 'has-changes' : ''}`}>
            <span aria-hidden="true" />
            {dirty
              ? storageAvailable
                ? 'Kept in this tab · not saved yet'
                : 'Unsaved changes · keep this tab open'
              : initial
                ? 'All changes saved'
                : 'Ready when you are'}
          </span>
          <div className="save-actions">
            <button type="button" className="secondary" onClick={() => void cancel()}>
              Cancel
            </button>
            <button className="primary" disabled={!classes.length}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Save draft →'}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
