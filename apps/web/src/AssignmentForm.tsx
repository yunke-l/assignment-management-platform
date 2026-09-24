import { useState, type FormEvent } from 'react';
import {
  createAssignmentSchema,
  type AssignmentDetail,
  type Classroom,
  type CreateAssignment,
} from '@amp/contracts';
import { request } from './api';
const blankQuestion = () => ({
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  points: 10,
});

export function AssignmentForm({
  classes,
  token,
  onCreated,
  onCancel,
  initial,
}: {
  initial?: AssignmentDetail;
  classes: Classroom[];
  token: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [classId, setClassId] = useState(initial?.classId ?? classes[0]?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [dueAt, setDueAt] = useState(() => {
    if (!initial) return '';
    const date = new Date(initial.dueAt);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [questions, setQuestions] = useState<CreateAssignment['questions']>(
    initial?.questions.map((q) => ({
      prompt: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex!,
      points: q.points,
    })) ?? [blankQuestion()],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function update(index: number, patch: Partial<CreateAssignment['questions'][number]>) {
    setQuestions((items) => items.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const input = createAssignmentSchema.parse({
        classId,
        title,
        description,
        dueAt: new Date(dueAt).toISOString(),
        questions,
      });
      const result = await request<AssignmentDetail>(
        initial ? `/assignments/${initial.id}` : '/assignments',
        token,
        {
          method: initial ? 'PATCH' : 'POST',
          body: JSON.stringify(initial ? { ...input, version: initial.version } : input),
        },
      );
      onCreated(result.id);
    } catch (e) {
      setError(
        e instanceof Error && 'issues' in e
          ? 'Check the title, deadline and every question. Text cannot be blank; each question needs 2–6 options and a correct answer.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <span className="eyebrow">{initial ? 'REFINE YOUR DRAFT' : 'A NEW CHALLENGE'}</span>
      <h2 className="detail-title">{initial ? 'Edit assignment' : 'Create an assignment'}</h2>
      <p className="muted">Save a draft, review the questions, then publish.</p>
      <fieldset disabled={busy} className="form-fields">
        <label>
          Title
          <input
            required
            maxLength={120}
            placeholder="e.g. Reading comprehension · Week 1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            Class
            <select
              disabled={!!initial}
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required
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
          </label>
          <label>
            Deadline · your local time
            <input
              type="datetime-local"
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
        </div>
        <label>
          Instructions
          <textarea
            maxLength={2000}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {questions.map((q, index) => (
          <div className="editor-question" key={index}>
            <div className="panel-title">
              <h3>Question {index + 1}</h3>
              {questions.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setQuestions((items) => items.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              )}
            </div>
            <label>
              Question text
              <input
                required
                maxLength={1000}
                value={q.prompt}
                onChange={(e) => update(index, { prompt: e.target.value })}
              />
            </label>
            <div className="option-grid">
              {q.options.map((option, i) => (
                <div key={i}>
                  <label>
                    Option {String.fromCharCode(65 + i)}
                    <input
                      required
                      maxLength={500}
                      value={option}
                      onChange={(e) =>
                        update(index, {
                          options: q.options.map((old, j) => (i === j ? e.target.value : old)),
                        })
                      }
                    />
                  </label>
                  {q.options.length > 2 && (
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Remove option ${String.fromCharCode(65 + i)} from question ${index + 1}`}
                      onClick={() =>
                        update(index, {
                          options: q.options.filter((_, j) => j !== i),
                          correctIndex:
                            q.correctIndex === i
                              ? 0
                              : q.correctIndex > i
                                ? q.correctIndex - 1
                                : q.correctIndex,
                        })
                      }
                    >
                      Remove option
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              disabled={q.options.length >= 6}
              onClick={() => update(index, { options: [...q.options, ''] })}
            >
              Add option to question {index + 1}
            </button>
            <div className="form-row">
              <label>
                Correct answer
                <select
                  value={q.correctIndex}
                  onChange={(e) => update(index, { correctIndex: Number(e.target.value) })}
                >
                  {q.options.map((_, i) => (
                    <option value={i} key={i}>
                      Option {String.fromCharCode(65 + i)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Points
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={q.points}
                  onChange={(e) => update(index, { points: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={questions.length >= 20}
          onClick={() => setQuestions((items) => [...items, blankQuestion()])}
        >
          + Add question
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={!classes.length}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Save draft →'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
