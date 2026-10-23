import type { PublicQuestionV2, QuestionV2 } from '@amp/contracts';
import { choiceLabel } from './QuestionAnswer';
import { questionLabels, questionNumbers, questionsInDisplayOrder } from './question-editor';

export type QuestionAnalysisItem = {
  questionId: string;
  type: string;
  submitted: number;
  graded: number;
  averageScore: number | null;
  units: { unitId: string; correctPercent: number | null }[];
};

export function QuestionAnalysis({
  questions,
  items,
  loading,
  error,
}: {
  questions: (QuestionV2 | PublicQuestionV2)[];
  items?: QuestionAnalysisItem[];
  loading: boolean;
  error: string;
}) {
  const ordered = questionsInDisplayOrder(questions);
  const numbers = questionNumbers(questions);
  const order = new Map(ordered.map((question, index) => [question.id, index]));
  return (
    <details className="question-analysis">
      <summary>
        <svg
          className="analysis-chevron"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Question analysis</span>
        {items && <span className="analysis-count">{items.length} questions</span>}
      </summary>
      {loading && (
        <p className="analysis-message" role="status">
          Loading question analysis…
        </p>
      )}
      {error && (
        <p className="analysis-message error" role="alert">
          {error}
        </p>
      )}
      {items?.length === 0 && <p className="analysis-message">No question data available.</p>}
      <div className="analysis-list">
        {items
          ?.slice()
          .sort(
            (a, b) => (order.get(a.questionId) ?? Infinity) - (order.get(b.questionId) ?? Infinity),
          )
          .map((item) => {
            const question = ordered.find((question) => question.id === item.questionId);
            const manual = item.type === 'RESPONSE';
            const pending = item.submitted - item.graded;
            return (
              <article
                className="analysis-card"
                key={item.questionId}
                aria-label={`Analysis for question ${numbers.get(item.questionId)}`}
              >
                <header className="analysis-card-header">
                  <h4>Question {numbers.get(item.questionId)}</h4>
                  {question && (
                    <span className="analysis-type">{questionLabels[question.type]}</span>
                  )}
                </header>
                <div className="analysis-overview">
                  <div>
                    <span>Average score</span>
                    <strong>
                      {item.averageScore === null ? '—' : item.averageScore.toFixed(1)}
                      {question && <small> / {question.points} pts</small>}
                    </strong>
                  </div>
                  <div>
                    <span>{manual ? 'Graded' : 'Submitted'}</span>
                    <strong>
                      {manual ? (
                        <>
                          {item.graded}
                          <small> / {item.submitted}</small>
                        </>
                      ) : (
                        item.submitted
                      )}
                    </strong>
                  </div>
                </div>
                {manual ? (
                  <div className="analysis-review-progress">
                    <div className="analysis-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${item.submitted ? (item.graded / item.submitted) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="analysis-review-status" data-pending={pending > 0}>
                      {item.submitted === 0
                        ? 'No submissions yet'
                        : pending > 0
                          ? `${pending} awaiting review`
                          : 'Grading complete'}
                    </p>
                  </div>
                ) : (
                  <div className="analysis-units">
                    {item.units.map((unit, index) => {
                      const choice =
                        question?.type === 'GROUPING'
                          ? question.config.items.find((item) => item.id === unit.unitId)
                          : question?.type === 'MATCHING'
                            ? question.config.left.find((item) => item.id === unit.unitId)
                            : undefined;
                      const label =
                        item.units.length === 1
                          ? 'Accuracy'
                          : choice
                            ? choiceLabel(choice, index)
                            : `Answer ${index + 1}`;
                      return (
                        <div className="analysis-unit" key={unit.unitId}>
                          <div className="analysis-unit-label">
                            <span>{label}</span>
                            <b>
                              {unit.correctPercent === null
                                ? '—'
                                : `${unit.correctPercent.toFixed(1)}%`}
                            </b>
                          </div>
                          <div className="analysis-track" aria-hidden="true">
                            <span style={{ width: `${unit.correctPercent ?? 0}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {item.submitted === 0 && <p className="analysis-empty">No submissions yet</p>}
                  </div>
                )}
              </article>
            );
          })}
      </div>
    </details>
  );
}
