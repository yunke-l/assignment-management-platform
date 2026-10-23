import { Button } from './Controls';
import type { RefObject } from 'react';
import type { QuestionV2, ValidationProblem } from '@amp/contracts';
import { questionNumbers, questionsInDisplayOrder, unitPoints } from './question-editor';
import { focusProblem, problemFieldLabel } from './QuestionValidation';

export type CheckPhase = 'idle' | 'checking' | 'checked' | 'stale' | 'failed';

export function AuthoringReview({
  questions,
  problems,
  total,
  phase,
  filesChecked,
  saved,
  failure,
  disabled,
  check,
  summaryRef,
}: {
  questions: QuestionV2[];
  problems: ValidationProblem[];
  total: number;
  phase: CheckPhase;
  filesChecked: boolean;
  saved: boolean;
  failure: string;
  disabled: boolean;
  check: () => void;
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const numbers = questionNumbers(questions);
  // The persisted array can interleave children from different groups. Follow
  // the same parent/child traversal used to number the editor instead.
  const order = new Map([...numbers.keys()].map((id, index) => [id, index]));
  const leaves = questionsInDisplayOrder(questions).filter((q) => q.type !== 'COMPOSITE');
  const groups = new Map<string, ValidationProblem[]>();
  problems.forEach((p) => {
    const key = p.questionId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  });
  const labels = {
    idle: 'Not checked',
    checking: 'Checking…',
    checked: problems.length ? 'Needs fixes' : filesChecked ? 'Checked' : 'Content checked',
    stale: 'Needs recheck',
    failed: 'Check interrupted',
  };
  const heading =
    phase === 'idle'
      ? 'Check when you’re ready'
      : phase === 'checking'
        ? 'Checking current edits…'
        : phase === 'stale'
          ? 'Edits changed since the last check'
          : phase === 'failed'
            ? 'Could not finish checking'
            : problems.length
              ? `${problems.length} issues to fix before publishing`
              : 'Current question content checks passed';
  return (
    <aside
      className={`authoring-review review-phase-${phase}`}
      aria-label="Scoring and publication review"
    >
      <div className="review-overview">
        <span className="eyebrow">ASSIGNMENT OVERVIEW</span>
        <div className="review-metrics">
          <div>
            <output aria-label="Assignment total points">{total}</output>
            <span>Total points</span>
          </div>
          <div>
            <strong>{leaves.length}</strong>
            <span>Questions</span>
          </div>
        </div>
        <details className="score-directory">
          <summary>Points by question</summary>
          <ul>
            {leaves.map((q) => (
              <li key={q.id}>
                <Button
                  type="button"
                  className="score-link"
                  onClick={() =>
                    focusProblem({ questionId: q.id, path: 'points', code: '', message: '' })
                  }
                >
                  <span>Question {numbers.get(q.id)}</span>
                  <b>
                    {unitPoints(q) ?? q.points} pts <span aria-hidden="true">↗</span>
                  </b>
                </Button>
              </li>
            ))}
          </ul>
          {!leaves.length && <p>Add a question to set its points.</p>}
        </details>
      </div>
      <div
        ref={summaryRef}
        tabIndex={-1}
        className={`validation-summary review-check ${problems.length ? 'has-errors' : ''}`}
        aria-label="Publication check results"
      >
        <div className="review-section-title">
          <h3>Publication check</h3>
          <span
            className={`check-state state-${phase === 'checked' && problems.length ? 'issues' : phase}`}
          >
            {labels[phase]}
          </span>
        </div>
        <p className="review-result" role="status">
          {heading}
        </p>
        <p className="review-explanation">
          {phase === 'idle'
            ? 'Keep drafting freely. Check your questions and files before publishing.'
            : phase === 'checking'
              ? 'Checking this version. You can keep editing; new edits will need another check.'
              : phase === 'stale'
                ? saved
                  ? 'Field hints follow your latest edits. Run another check to verify the current teaching files.'
                  : 'Field hints follow your latest edits. Save this draft, then check its teaching files.'
                : phase === 'failed'
                  ? 'Your edits are safe. Question hints remain available; teaching files have not been verified.'
                  : filesChecked
                    ? 'Current teaching files were also checked. Save your edits before publishing; publication rechecks the saved version.'
                    : saved
                      ? 'Question content was checked locally. Run another check to verify teaching files.'
                      : 'Question content was checked locally. Save this draft to verify teaching files. Incomplete drafts can still be saved.'}
        </p>
        <Button
          className="primary review-check-button"
          type="button"
          disabled={disabled}
          onClick={check}
        >
          {phase === 'checking' ? 'Checking…' : 'Check for publication'}
        </Button>
        {failure && (
          <p role="alert" className="error">
            {failure}
          </p>
        )}
        {problems.length > 0 && (
          <>
            <div className="review-issues-heading">
              <b>
                {problems.length} issues · {groups.size}{' '}
                {groups.size === 1 ? 'section' : 'sections'}
              </b>
              <Button
                type="button"
                className="text-button"
                onClick={() => focusProblem(problems[0]!)}
              >
                Fix first issue ↗
              </Button>
            </div>
            <div className="review-issue-groups">
              {[...groups]
                .sort(([a], [b]) => (order.get(a) ?? -1) - (order.get(b) ?? -1))
                .map(([id, entries]) => (
                  <details key={id} open className="review-issue-group">
                    <summary>
                      {id ? `Question ${numbers.get(id) ?? ''}` : 'Assignment details'}
                      <span>{entries.length}</span>
                    </summary>
                    <ul>
                      {entries.map((p, i) => (
                        <li key={`${p.path}:${i}`}>
                          <Button
                            type="button"
                            className="text-button"
                            onClick={() => focusProblem(p)}
                          >
                            <span className="sr-only">
                              {id ? `Question ${numbers.get(id) ?? ''} · ` : ''}
                            </span>
                            <strong>{problemFieldLabel(p.path)}:</strong> {p.message}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
