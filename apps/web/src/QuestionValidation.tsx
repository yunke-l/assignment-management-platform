import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import {
  questionV2Schema,
  validateQuestions,
  validationMessage,
  type QuestionV2,
  type ValidationProblem,
} from '@amp/contracts';

export function uniqueProblems(problems: ValidationProblem[]) {
  return [...new Map(problems.map((p) => [`${p.questionId}:${p.path}:${p.message}`, p])).values()];
}
export function currentQuestionProblems(
  questions: QuestionV2[],
  publish = true,
): ValidationProblem[] {
  const shape = questionV2Schema.array().max(120).safeParse(questions);
  const shapeProblems = shape.success
    ? []
    : shape.error.issues.map((issue) => ({
        questionId: typeof issue.path[0] === 'number' ? questions[issue.path[0]]?.id : undefined,
        path: issue.path.slice(1).join('.') || 'questions',
        code: 'INVALID_QUESTION',
        message: validationMessage(issue),
      }));
  return uniqueProblems([...shapeProblems, ...validateQuestions(questions, publish)]);
}

export const QuestionProblems = createContext<ValidationProblem[]>([]);
export function QuestionField({
  path,
  label,
  exact = false,
  children,
}: {
  path: string;
  label: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const problems = useContext(QuestionProblems).filter(
    (p) => p.path === path || (!exact && p.path.startsWith(`${path}.`)),
  );
  const errorId = useId();
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!problems.length || !field.current) return;
    const inputs = [...field.current.querySelectorAll('input, textarea, select')].filter(
      (input) => input.closest('[data-question-field]') === field.current,
    );
    inputs.forEach((input) => {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute(
        'aria-describedby',
        [input.getAttribute('aria-describedby'), errorId].filter(Boolean).join(' '),
      );
    });
    return () =>
      inputs.forEach((input) => {
        input.removeAttribute('aria-invalid');
        const rest = (input.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .filter((id) => id !== errorId)
          .join(' ');
        if (rest) input.setAttribute('aria-describedby', rest);
        else input.removeAttribute('aria-describedby');
      });
  }, [problems.length, errorId]);
  return (
    <div
      ref={field}
      className={problems.length ? 'question-field invalid-field' : 'question-field'}
      data-question-field={path}
      data-field-label={label}
    >
      {children}
      {problems.length > 0 && (
        <>
          <span id={errorId} className="sr-only">
            {[...new Set(problems.map((p) => p.message))].join(' ')}
          </span>
          <ul className="field-error" aria-label={`${label} errors`}>
            {[...new Set(problems.map((p) => p.message))].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
export function focusProblem(problem: ValidationProblem) {
  if (!problem.questionId) {
    const field = [...document.querySelectorAll<HTMLElement>('[data-assignment-field]')].find(
      (el) => el.dataset.assignmentField === problem.path,
    );
    if (field) {
      field.scrollIntoView({ block: 'center' });
      field.focus({ preventScroll: true });
    }
    return;
  }
  const question = problem.questionId
    ? document.getElementById(`edit-${problem.questionId}`)
    : null;
  const fields = [...(question?.querySelectorAll<HTMLElement>('[data-question-field]') ?? [])];
  const target =
    fields
      .filter((field) => {
        const path = field.dataset.questionField!;
        return problem.path === path || problem.path.startsWith(`${path}.`);
      })
      .sort((a, b) => b.dataset.questionField!.length - a.dataset.questionField!.length)[0] ??
    question;
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  const input = target.querySelector<HTMLElement>(
    problem.path === 'points'
      ? 'input:not([disabled])'
      : problem.path === 'answerKey.correctOptionId'
        ? 'input[type="radio"]'
        : problem.path === 'answerKey.placements' || problem.path === 'answerKey.pairs'
          ? '[role="combobox"]:not([disabled])'
          : 'textarea, input:not([disabled]):not([type="hidden"]), button:not([disabled])',
  );
  target.scrollIntoView({ block: 'center' });
  if (input) input.focus({ preventScroll: true });
  else {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}

export function problemFieldLabel(path: string): string {
  const option = /^config\.options\.(\d+)/.exec(path);
  if (option) return `Option ${String.fromCharCode(65 + Number(option[1]))}`;
  const cloze = /^config\.blanks\.(\d+)\.options\.(\d+)/.exec(path);
  if (cloze) return `Blank ${Number(cloze[1]) + 1}, option ${Number(cloze[2]) + 1}`;
  const answer = /^answerKey\.answers\.(\d+)/.exec(path);
  if (answer) return `Blank answers ${Number(answer[1]) + 1}`;
  const item = /^config\.(groups|items|left|right)\.(\d+)/.exec(path);
  if (item)
    return `${({ groups: 'Category', items: 'Item', left: 'Left item', right: 'Right item' } as Record<string, string>)[item[1]!]} ${Number(item[2]) + 1}`;
  return (
    (
      {
        prompt: 'Question text',
        answerAreaContent: 'Answer area materials',
        points: 'Total points',
        'answerKey.correctOptionId': 'Correct answer',
        'answerKey.answers': 'Blank answers',
        'answerKey.placements': 'Correct categories',
        'answerKey.pairs': 'Correct matches',
        'answerKey.orders': 'Acceptable orders',
        'config.blanks': 'Blanks',
        'config.rubric': 'Assessment rubric',
        'config.options': 'Options',
        children: 'Child questions',
        assets: 'Teaching files',
        questions: 'Questions',
        title: 'Title',
        classId: 'Class',
        dueAt: 'Deadline',
        config: 'Answer requirements',
      } as Record<string, string>
    )[path] ?? 'Question settings'
  );
}
