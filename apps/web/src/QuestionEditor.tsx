import { InputField, Button, TextAreaField, SelectField } from './Controls';
import { useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import {
  contentAssets,
  contentText,
  type ChoiceV2,
  type Content,
  type InlineContent,
  type QuestionV2,
} from '@amp/contracts';
import { ContentEditor } from './ContentEditor';
import { type UploadContext } from './Media';
import { useConfirm } from './ConfirmDialog';
import { newChoice, newQuestion, questionLabels, unitPoints } from './question-editor';
import { choiceLabel } from './QuestionAnswer';
import { QuestionField } from './QuestionValidation';

type Edit<T> = Dispatch<SetStateAction<T>>;
type Context = { token: string; context: UploadContext | null };
function typedEdit<T extends QuestionV2>(q: T, edit: Edit<QuestionV2>): Edit<T> {
  return (action) =>
    edit((old) =>
      old.type === q.type
        ? typeof action === 'function'
          ? (action as (value: T) => T)(old as T)
          : action
        : old,
    );
}
function number(value: string, max = 100, min = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : min;
}
function PointInput({
  value,
  edit,
  label = 'Points',
}: {
  value: number;
  edit: (value: number) => void;
  label?: string;
}) {
  const [input, setInput] = useState({ source: value, text: String(value) });
  const text = input.source === value ? input.text : String(value);
  return (
    <label>
      {label}
      <InputField
        data-score-input
        type="number"
        min={1}
        max={100}
        step={1}
        required
        value={text}
        onChange={(e) => {
          const text = e.target.value;
          setInput({ source: value, text });
          const parsed = Number(text);
          if (text !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) edit(parsed);
        }}
      />
    </label>
  );
}
function ScoreBreakdown({ q }: { q: QuestionV2 }) {
  const units =
    q.type === 'FILL_BLANK' || q.type === 'CLOZE_CHOICE'
      ? q.config.blanks.map((unit, i) => ({ name: `Blank ${i + 1}`, points: unit.points }))
      : q.type === 'GROUPING'
        ? q.config.items.map((unit, i) => ({ name: `Item ${i + 1}`, points: unit.points }))
        : q.type === 'MATCHING'
          ? q.config.left.map((unit, i) => ({ name: `Match ${i + 1}`, points: unit.points }))
          : q.type === 'RESPONSE'
            ? q.config.rubric.map((unit, i) => ({
                name: unit.name || `Dimension ${i + 1}`,
                points: unit.points,
              }))
            : [];
  return units.length ? (
    <details className="scoring-breakdown">
      <summary>
        Scoring breakdown · {units.length} {units.length === 1 ? 'unit' : 'units'}
      </summary>
      <ul>
        {units.map((unit, i) => (
          <li key={i}>
            <span>{unit.name}</span>
            <Button
              type="button"
              aria-label={`Edit points for ${unit.name.toLowerCase()}`}
              onClick={() => {
                const input = document
                  .getElementById(`edit-${q.id}`)
                  ?.querySelectorAll<HTMLInputElement>('[data-score-input]')[i];
                input?.scrollIntoView({ block: 'center' });
                input?.focus({ preventScroll: true });
                input?.select();
              }}
            >
              {unit.points} pts <span aria-hidden="true">↗</span>
            </Button>
          </li>
        ))}
      </ul>
    </details>
  ) : (
    <p className="scoring-empty">
      {q.type === 'RESPONSE'
        ? 'Add a grading criterion below to set the points.'
        : 'Add scoring items below to start scoring.'}
    </p>
  );
}
function AcceptedAnswers({
  values,
  onChange,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  label: string;
}) {
  const source = JSON.stringify(values);
  const [input, setInput] = useState({ source, text: values.join('\n') });
  return (
    <label>
      {label}
      <TextAreaField
        aria-label={label}
        value={input.source === source ? input.text : values.join('\n')}
        onChange={(e) => {
          const text = e.target.value;
          const next = text.split('\n').filter((line) => line.length > 0);
          setInput({ source: JSON.stringify(next), text });
          onChange(next);
        }}
      />
    </label>
  );
}
function Choices<T extends ChoiceV2>({
  choices,
  edit,
  max,
  min = 2,
  label,
  make,
  weighted = false,
  questionNumber,
  token,
  context,
  path,
  extra,
}: Context & {
  path: string;
  choices: T[];
  edit: Edit<T[]>;
  max: number;
  min?: number;
  label: string;
  make: () => T;
  weighted?: boolean;
  questionNumber?: string;
  extra?: (choice: T, index: number) => ReactNode;
}) {
  return (
    <div className="choice-editors">
      {choices.map((choice, index) => (
        <div className="choice-editor" key={choice.id}>
          <QuestionField path={`${path}.${index}`} label={`${label} ${index + 1}`}>
            <ContentEditor
              compact
              label={
                label === 'Option'
                  ? `Option ${String.fromCharCode(65 + index)}`
                  : `${label} ${index + 1}`
              }
              content={choice.content}
              token={token}
              context={context}
              limit={500}
              onChange={(action) =>
                edit((old) =>
                  old.map((item) =>
                    item.id === choice.id
                      ? {
                          ...item,
                          content: typeof action === 'function' ? action(item.content) : action,
                        }
                      : item,
                  ),
                )
              }
            />
            <details
              className="choice-label-settings"
              open={
                !!choice.label ||
                (!contentText(choice.content).trim() && contentAssets(choice.content).length > 0) ||
                undefined
              }
            >
              <summary>Short label (for media-only items)</summary>
              <label>
                {label} {index + 1} short label
                <InputField
                  value={choice.label}
                  onChange={(e) =>
                    edit((old) =>
                      old.map((item) =>
                        item.id === choice.id ? { ...item, label: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
            </details>
            {weighted && 'points' in choice && (
              <PointInput
                value={Number(choice.points)}
                label={`${label} ${index + 1} points`}
                edit={(points) =>
                  edit((old) =>
                    old.map((item) => (item.id === choice.id ? { ...item, points } : item)),
                  )
                }
              />
            )}
            <div className="choice-actions">
              {(['up', 'down'] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  disabled={direction === 'up' ? index === 0 : index === choices.length - 1}
                  aria-label={`Move ${label.toLowerCase()} ${label === 'Option' ? String.fromCharCode(65 + index) : index + 1} ${direction}${questionNumber ? ` in question ${questionNumber}` : ''}`}
                  onClick={() =>
                    edit((old) => {
                      const next = [...old],
                        from = next.findIndex((item) => item.id === choice.id),
                        to = from + (direction === 'up' ? -1 : 1);
                      if (from >= 0 && to >= 0 && to < next.length)
                        [next[from], next[to]] = [next[to]!, next[from]!];
                      return next;
                    })
                  }
                >
                  {direction === 'up' ? '↑ Up' : '↓ Down'}
                </Button>
              ))}
              {choices.length > min && (
                <Button
                  type="button"
                  onClick={() => edit((old) => old.filter((item) => item.id !== choice.id))}
                >
                  Remove {label.toLowerCase()}{' '}
                  {label === 'Option' ? String.fromCharCode(65 + index) : index + 1}
                  {questionNumber && ` from question ${questionNumber}`}
                </Button>
              )}
            </div>
          </QuestionField>
          {extra?.(choice, index)}
        </div>
      ))}
      <Button
        type="button"
        disabled={choices.length >= max}
        onClick={() => edit((old) => [...old, make()])}
      >
        Add {label.toLowerCase()}
        {questionNumber && ` to question ${questionNumber}`}
      </Button>
    </div>
  );
}
function Single({
  q,
  edit,
  number: display,
  ...ctx
}: Context & {
  q: Extract<QuestionV2, { type: 'SINGLE_CHOICE' }>;
  edit: Edit<typeof q>;
  number: string;
}) {
  return (
    <QuestionField path="answerKey.correctOptionId" label="Correct answer">
      <p className="type-hint">Write your options and select the correct answer beside it.</p>
      <Choices
        {...ctx}
        path="config.options"
        choices={q.config.options}
        max={6}
        label="Option"
        questionNumber={display}
        make={newChoice}
        extra={(option, i) => (
          <label className="inline-correct-answer">
            <InputField
              type="radio"
              name={`key-${q.id}`}
              aria-label={`Mark option ${String.fromCharCode(65 + i)} as correct for question ${display}`}
              checked={q.answerKey.correctOptionId === option.id}
              onChange={() =>
                edit((old) => ({ ...old, answerKey: { correctOptionId: option.id } }))
              }
            />
            Correct answer
          </label>
        )}
        edit={(action) =>
          edit((old) => {
            const options = typeof action === 'function' ? action(old.config.options) : action;
            return {
              ...old,
              config: { options },
              answerKey: {
                correctOptionId: options.some((o) => o.id === old.answerKey.correctOptionId)
                  ? old.answerKey.correctOptionId
                  : null,
              },
            };
          })
        }
      />
    </QuestionField>
  );
}
function tokenRemoved(content: Content, id: string): Content {
  return content.map((block) => {
    if (block.type === 'image' || block.type === 'audio') return block;
    const filter = (row: InlineContent[]) =>
      row.filter((inline) => inline.type !== 'blank' || inline.blankId !== id);
    return block.type === 'list'
      ? { ...block, items: block.items.map(filter) }
      : { ...block, children: filter(block.children) };
  });
}
function addToken(content: Content, id: string): Content {
  const last = content.at(-1);
  if (last?.type === 'paragraph')
    return [
      ...content.slice(0, -1),
      {
        ...last,
        children: [...last.children, { type: 'text', text: ' ' }, { type: 'blank', blankId: id }],
      },
    ];
  return [
    ...content,
    { id: crypto.randomUUID(), type: 'paragraph', children: [{ type: 'blank', blankId: id }] },
  ];
}
function Fill({
  q,
  edit,
}: {
  q: Extract<QuestionV2, { type: 'FILL_BLANK' }>;
  edit: Edit<typeof q>;
}) {
  return (
    <>
      <p>
        Click Add blank, then move [blank 1] to the right place in your question. Enter an answer
        for each blank; put alternative answers on separate lines.
      </p>
      {q.config.blanks.map((gap, i) => (
        <div className="blank-editor" key={gap.id}>
          <h4>Blank {i + 1}</h4>
          <PointInput
            value={gap.points}
            edit={(points) =>
              edit((old) => {
                const blanks = old.config.blanks.map((b) =>
                  b.id === gap.id ? { ...b, points } : b,
                );
                return {
                  ...old,
                  config: { blanks },
                  points: blanks.reduce((sum, b) => sum + b.points, 0),
                };
              })
            }
          />
          <label>
            <InputField
              type="checkbox"
              checked={gap.caseSensitive}
              onChange={(e) =>
                edit((old) => ({
                  ...old,
                  config: {
                    blanks: old.config.blanks.map((b) =>
                      b.id === gap.id ? { ...b, caseSensitive: e.target.checked } : b,
                    ),
                  },
                }))
              }
            />
            Case sensitive
          </label>
          <QuestionField
            path={`answerKey.answers.${q.answerKey.answers.findIndex((a) => a.blankId === gap.id)}.values`}
            label={`Accepted answers for blank ${i + 1}`}
          >
            <AcceptedAnswers
              label={`Accepted answers for blank ${i + 1} (one per line)`}
              values={q.answerKey.answers.find((a) => a.blankId === gap.id)?.values ?? []}
              onChange={(values) =>
                edit((old) => ({
                  ...old,
                  answerKey: {
                    answers: [
                      ...old.answerKey.answers.filter((a) => a.blankId !== gap.id),
                      {
                        blankId: gap.id,
                        values,
                      },
                    ],
                  },
                }))
              }
            />
          </QuestionField>
          <Button
            type="button"
            onClick={() =>
              edit((old) => {
                const blanks = old.config.blanks.filter((b) => b.id !== gap.id);
                return {
                  ...old,
                  prompt: tokenRemoved(old.prompt, gap.id),
                  config: { blanks },
                  points: Math.max(
                    1,
                    blanks.reduce((sum, b) => sum + b.points, 0),
                  ),
                  answerKey: { answers: old.answerKey.answers.filter((a) => a.blankId !== gap.id) },
                };
              })
            }
          >
            Remove blank {i + 1}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={q.config.blanks.length >= 20}
        onClick={() =>
          edit((old) => {
            const id = crypto.randomUUID(),
              blanks = [...old.config.blanks, { id, points: 1, caseSensitive: false }];
            return {
              ...old,
              prompt: addToken(old.prompt, id),
              config: { blanks },
              points: blanks.reduce((sum, b) => sum + b.points, 0),
            };
          })
        }
      >
        Add blank
      </Button>
    </>
  );
}
function Cloze({
  q,
  edit,
  ...ctx
}: Context & { q: Extract<QuestionV2, { type: 'CLOZE_CHOICE' }>; edit: Edit<typeof q> }) {
  return (
    <>
      <p>
        Click Add blank, then move its [blank N] marker into your question. Add choices and select
        the correct answer for each blank.
      </p>
      {q.config.blanks.map((gap, i) => (
        <div className="blank-editor" key={gap.id}>
          <h4>Blank {i + 1}</h4>
          <PointInput
            value={gap.points}
            edit={(points) =>
              edit((old) => {
                const blanks = old.config.blanks.map((b) =>
                  b.id === gap.id ? { ...b, points } : b,
                );
                return {
                  ...old,
                  config: { blanks },
                  points: blanks.reduce((sum, b) => sum + b.points, 0),
                };
              })
            }
          />
          <Choices
            extra={(option, j) => (
              <label className="inline-correct-answer">
                <InputField
                  type="radio"
                  name={`blank-key-${gap.id}`}
                  aria-label={`Mark option ${j + 1} as correct for blank ${i + 1}`}
                  checked={
                    q.answerKey.answers.find((a) => a.blankId === gap.id)?.optionId === option.id
                  }
                  onChange={() =>
                    edit((old) => ({
                      ...old,
                      answerKey: {
                        answers: [
                          ...old.answerKey.answers.filter((a) => a.blankId !== gap.id),
                          { blankId: gap.id, optionId: option.id },
                        ],
                      },
                    }))
                  }
                />
                Correct answer
              </label>
            )}
            {...ctx}
            path={`config.blanks.${i}.options`}
            choices={gap.options}
            label={`Blank ${i + 1} option`}
            max={6}
            make={newChoice}
            edit={(action) =>
              edit((old) => {
                const blanks = old.config.blanks.map((b) =>
                    b.id === gap.id
                      ? { ...b, options: typeof action === 'function' ? action(b.options) : action }
                      : b,
                  ),
                  options = blanks.find((b) => b.id === gap.id)!.options;
                return {
                  ...old,
                  config: { blanks },
                  answerKey: {
                    answers: old.answerKey.answers.filter(
                      (a) => a.blankId !== gap.id || options.some((o) => o.id === a.optionId),
                    ),
                  },
                };
              })
            }
          />

          <Button
            type="button"
            onClick={() =>
              edit((old) => {
                const blanks = old.config.blanks.filter((b) => b.id !== gap.id);
                return {
                  ...old,
                  prompt: tokenRemoved(old.prompt, gap.id),
                  config: { blanks },
                  points: Math.max(
                    1,
                    blanks.reduce((sum, b) => sum + b.points, 0),
                  ),
                  answerKey: { answers: old.answerKey.answers.filter((a) => a.blankId !== gap.id) },
                };
              })
            }
          >
            Remove blank {i + 1}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={q.config.blanks.length >= 20}
        onClick={() =>
          edit((old) => {
            const id = crypto.randomUUID(),
              blanks = [
                ...old.config.blanks,
                { id, points: 1, options: [newChoice(), newChoice()] },
              ];
            return {
              ...old,
              config: { blanks },
              prompt: addToken(old.prompt, id),
              points: blanks.reduce((sum, b) => sum + b.points, 0),
            };
          })
        }
      >
        Add blank
      </Button>
    </>
  );
}
function Grouping({
  q,
  edit,
  ...ctx
}: Context & { q: Extract<QuestionV2, { type: 'GROUPING' }>; edit: Edit<typeof q> }) {
  return (
    <>
      <p className="type-hint">Create categories, then choose a category beside each item.</p>
      <h4>1. Categories</h4>
      <Choices
        {...ctx}
        path="config.groups"
        label="Category"
        choices={q.config.groups}
        max={8}
        make={newChoice}
        edit={(action) =>
          edit((old) => {
            const groups = typeof action === 'function' ? action(old.config.groups) : action;
            return {
              ...old,
              config: { ...old.config, groups },
              answerKey: {
                placements: old.answerKey.placements.filter((p) =>
                  groups.some((g) => g.id === p.groupId),
                ),
              },
            };
          })
        }
      />
      <h4>2. Items and their categories</h4>
      <QuestionField path="answerKey.placements" label="Correct categories">
        <Choices
          extra={(item, i) => (
            <label>
              Correct category for {choiceLabel(item, i)}
              <SelectField
                aria-label={`Correct category for ${choiceLabel(item, i)}`}
                value={q.answerKey.placements.find((p) => p.itemId === item.id)?.groupId ?? ''}
                onChange={(selectedValue) =>
                  edit((old) => ({
                    ...old,
                    answerKey: {
                      placements: [
                        ...old.answerKey.placements.filter((p) => p.itemId !== item.id),
                        ...(selectedValue ? [{ itemId: item.id, groupId: selectedValue }] : []),
                      ],
                    },
                  }))
                }
              >
                <option value="">Set category…</option>
                {q.config.groups.map((g, j) => (
                  <option value={g.id} key={g.id}>
                    {choiceLabel(g, j)}
                  </option>
                ))}
              </SelectField>
            </label>
          )}
          {...ctx}
          path="config.items"
          label="Item"
          weighted
          choices={q.config.items}
          max={20}
          make={() => ({ ...newChoice(), points: 1 })}
          edit={(action) =>
            edit((old) => {
              const items = typeof action === 'function' ? action(old.config.items) : action;
              return {
                ...old,
                config: { ...old.config, items },
                points: items.reduce((sum, i) => sum + i.points, 0),
                answerKey: {
                  placements: old.answerKey.placements.filter((p) =>
                    items.some((i) => i.id === p.itemId),
                  ),
                },
              };
            })
          }
        />
      </QuestionField>
    </>
  );
}
function Matching({
  q,
  edit,
  ...ctx
}: Context & { q: Extract<QuestionV2, { type: 'MATCHING' }>; edit: Edit<typeof q> }) {
  return (
    <>
      <p className="type-hint">
        Add possible matches first. Then choose the correct match beside each item.
      </p>
      <details className="question-advanced">
        <summary>
          Matching rules ·{' '}
          {q.config.mode === 'ONE_TO_ONE' ? 'Each match used once' : 'Matches can be reused'}
        </summary>
        <label>
          Matching mode
          <SelectField
            aria-label="Matching mode"
            value={q.config.mode}
            onChange={(selectedValue) =>
              edit((old) => ({
                ...old,
                config: { ...old.config, mode: selectedValue as typeof old.config.mode },
              }))
            }
          >
            <option value="ONE_TO_ONE">Each match used once</option>
            <option value="MANY_TO_ONE">Matches can be reused</option>
          </SelectField>
        </label>
      </details>
      <h4>1. Possible matches</h4>
      <Choices
        {...ctx}
        path="config.right"
        label="Match option"
        choices={q.config.right}
        max={30}
        make={newChoice}
        edit={(action) =>
          edit((old) => {
            const right = typeof action === 'function' ? action(old.config.right) : action;
            return {
              ...old,
              config: { ...old.config, right },
              answerKey: {
                pairs: old.answerKey.pairs.filter((p) => right.some((i) => i.id === p.rightId)),
              },
            };
          })
        }
      />
      <h4>2. Items and their correct matches</h4>
      <QuestionField path="answerKey.pairs" label="Correct matches">
        <Choices
          extra={(item, i) => (
            <label>
              Correct match for {choiceLabel(item, i)}
              <SelectField
                aria-label={`Correct match for ${choiceLabel(item, i)}`}
                value={q.answerKey.pairs.find((p) => p.leftId === item.id)?.rightId ?? ''}
                onChange={(selectedValue) =>
                  edit((old) => ({
                    ...old,
                    answerKey: {
                      pairs: [
                        ...old.answerKey.pairs.filter((p) => p.leftId !== item.id),
                        ...(selectedValue ? [{ leftId: item.id, rightId: selectedValue }] : []),
                      ],
                    },
                  }))
                }
              >
                <option value="">Choose a match…</option>
                {q.config.right.map((r, j) => (
                  <option key={r.id} value={r.id}>
                    {choiceLabel(r, j)}
                  </option>
                ))}
              </SelectField>
            </label>
          )}
          {...ctx}
          path="config.left"
          label="Item"
          weighted
          choices={q.config.left}
          max={20}
          make={() => ({ ...newChoice(), points: 1 })}
          edit={(action) =>
            edit((old) => {
              const left = typeof action === 'function' ? action(old.config.left) : action;
              return {
                ...old,
                config: { ...old.config, left },
                points: left.reduce((sum, i) => sum + i.points, 0),
                answerKey: {
                  pairs: old.answerKey.pairs.filter((p) => left.some((i) => i.id === p.leftId)),
                },
              };
            })
          }
        />
      </QuestionField>
    </>
  );
}
function Ordering({
  q,
  edit,
  ...ctx
}: Context & { q: Extract<QuestionV2, { type: 'ORDERING' }>; edit: Edit<typeof q> }) {
  function move(orderIndex: number, from: number, to: number) {
    edit((old) => {
      const orders = old.answerKey.orders.map((sequence, i) => {
        if (i !== orderIndex) return sequence;
        const next = [...sequence],
          [item] = next.splice(from, 1);
        next.splice(to, 0, item!);
        return next;
      });
      return { ...old, answerKey: { orders } };
    });
  }
  return (
    <>
      <Choices
        {...ctx}
        path="config.items"
        label="Card"
        choices={q.config.items}
        max={20}
        make={newChoice}
        edit={(action) =>
          edit((old) => {
            const items = typeof action === 'function' ? action(old.config.items) : action;
            const ids = items.map((i) => i.id);
            return {
              ...old,
              config: { items, initialOrder: [] },
              answerKey: {
                orders: old.answerKey.orders.map((seq) => [
                  ...seq.filter((id) => ids.includes(id)),
                  ...ids.filter((id) => !seq.includes(id)),
                ]),
              },
            };
          })
        }
      />
      <p className="type-hint">
        Write the cards above, then set the correct order below. Students will see shuffled cards.
      </p>
      <QuestionField path="answerKey.orders" label="Acceptable orders">
        {q.answerKey.orders.map((order, k) => (
          <div className="acceptable-order" key={k}>
            <h4>{k === 0 ? 'Correct order' : `Alternative correct order ${k + 1}`}</h4>
            <ol>
              {order.map((id, i) => (
                <li key={id}>
                  {choiceLabel(
                    q.config.items.find((c) => c.id === id)!,
                    i,
                  )}{' '}
                  <Button
                    type="button"
                    disabled={!i}
                    aria-label={`Move card ${i + 1} up in acceptable order ${k + 1}`}
                    onClick={() => move(k, i, i - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    disabled={i === order.length - 1}
                    aria-label={`Move card ${i + 1} down in acceptable order ${k + 1}`}
                    onClick={() => move(k, i, i + 1)}
                  >
                    ↓
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              onClick={() =>
                edit((old) => ({
                  ...old,
                  answerKey: { orders: old.answerKey.orders.filter((_, i) => i !== k) },
                }))
              }
            >
              Remove acceptable order
            </Button>
          </div>
        ))}
        <Button
          type="button"
          disabled={q.answerKey.orders.length >= 5}
          onClick={() =>
            edit((old) => ({
              ...old,
              answerKey: { orders: [...old.answerKey.orders, old.config.items.map((i) => i.id)] },
            }))
          }
        >
          {q.answerKey.orders.length ? 'Add another correct order (optional)' : 'Set correct order'}
        </Button>
      </QuestionField>
    </>
  );
}
function Response({
  q,
  edit,
  ...ctx
}: Context & { q: Extract<QuestionV2, { type: 'RESPONSE' }>; edit: Edit<typeof q> }) {
  const set = (key: keyof typeof q.config, value: unknown) =>
    edit((old) => ({ ...old, config: { ...old.config, [key]: value } }));
  return (
    <>
      <h4>How can students answer?</h4>
      <p className="type-hint">Choose one or more answer formats.</p>
      <div className="answer-format-options">
        <label>
          <InputField
            type="checkbox"
            checked={q.config.textEnabled}
            onChange={(e) =>
              edit((old) => ({
                ...old,
                config: {
                  ...old.config,
                  textEnabled: e.target.checked,
                  textRequired: e.target.checked && old.config.textRequired,
                },
              }))
            }
          />
          Allow text
        </label>
        {(['Images', 'Audios'] as const).map((kind) => (
          <label key={kind}>
            <InputField
              type="checkbox"
              checked={q.config[`max${kind}`] > 0}
              onChange={(e) =>
                edit((old) => ({
                  ...old,
                  config: {
                    ...old.config,
                    [`max${kind}`]: e.target.checked ? (kind === 'Images' ? 5 : 2) : 0,
                    [`min${kind}`]: 0,
                  },
                }))
              }
            />
            Allow {kind === 'Images' ? 'images' : 'audio'}
          </label>
        ))}
      </div>
      <p className="answer-requirements-summary">
        {[
          q.config.textEnabled ? (q.config.textRequired ? 'Text required' : 'Text optional') : null,
          q.config.maxImages ? `${q.config.minImages}–${q.config.maxImages} images` : null,
          q.config.maxAudios ? `${q.config.minAudios}–${q.config.maxAudios} audio files` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Choose at least one answer format.'}
      </p>
      <details className="question-advanced">
        <summary>Answer requirements & file limits</summary>
        <label>
          <InputField
            type="checkbox"
            disabled={!q.config.textEnabled}
            checked={q.config.textRequired}
            onChange={(e) => set('textRequired', e.target.checked)}
          />
          Text required
        </label>
        <div className="form-row">
          {(['Images', 'Audios'] as const).map((kind) => (
            <div key={kind}>
              <label>
                Minimum {kind.toLowerCase()}
                <InputField
                  type="number"
                  min={0}
                  max={kind === 'Images' ? 5 : 2}
                  value={q.config[`min${kind}`]}
                  onChange={(e) =>
                    set(`min${kind}`, number(e.target.value, kind === 'Images' ? 5 : 2, 0))
                  }
                />
              </label>
              <label>
                Maximum {kind.toLowerCase()}
                <InputField
                  type="number"
                  min={0}
                  max={kind === 'Images' ? 5 : 2}
                  value={q.config[`max${kind}`]}
                  onChange={(e) =>
                    set(`max${kind}`, number(e.target.value, kind === 'Images' ? 5 : 2, 0))
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="form-row">
          {(['Image', 'Audio'] as const).map((kind) => (
            <label key={kind}>
              Maximum {kind.toLowerCase()} file (MiB)
              <InputField
                type="number"
                min={0.001}
                max={kind === 'Image' ? 10 : 50}
                step={0.001}
                value={q.config[`max${kind}Bytes`] / 1048576}
                onChange={(e) =>
                  set(`max${kind}Bytes`, Math.max(1, Math.round(Number(e.target.value) * 1048576)))
                }
              />
            </label>
          ))}
        </div>
      </details>
      <QuestionField path="config.rubric" label="Assessment rubric">
        <h4>Grading criteria</h4>
        <p className="type-hint">
          Add what you will assess and the points it is worth. You grade these answers manually.
        </p>
        {q.config.rubric.map((dimension, i) => (
          <div className="rubric-editor" key={dimension.id}>
            <label>
              Criterion {i + 1} name
              <InputField
                value={dimension.name}
                onChange={(e) =>
                  edit((old) => ({
                    ...old,
                    config: {
                      ...old.config,
                      rubric: old.config.rubric.map((d) =>
                        d.id === dimension.id ? { ...d, name: e.target.value } : d,
                      ),
                    },
                  }))
                }
              />
            </label>
            <label>
              How to award points for criterion {i + 1}
              <TextAreaField
                value={dimension.description}
                onChange={(e) =>
                  edit((old) => ({
                    ...old,
                    config: {
                      ...old.config,
                      rubric: old.config.rubric.map((d) =>
                        d.id === dimension.id ? { ...d, description: e.target.value } : d,
                      ),
                    },
                  }))
                }
              />
            </label>
            <PointInput
              value={dimension.points}
              edit={(points) =>
                edit((old) => {
                  const rubric = old.config.rubric.map((d) =>
                    d.id === dimension.id ? { ...d, points } : d,
                  );
                  return {
                    ...old,
                    config: { ...old.config, rubric },
                    points: rubric.reduce((sum, d) => sum + d.points, 0),
                  };
                })
              }
            />
            <Button
              type="button"
              onClick={() =>
                edit((old) => {
                  const rubric = old.config.rubric.filter((d) => d.id !== dimension.id);
                  return {
                    ...old,
                    config: { ...old.config, rubric },
                    points: Math.max(
                      1,
                      rubric.reduce((sum, d) => sum + d.points, 0),
                    ),
                  };
                })
              }
            >
              Remove criterion
            </Button>
          </div>
        ))}
        <Button
          type="button"
          disabled={q.config.rubric.length >= 10}
          onClick={() =>
            edit((old) => {
              const rubric = [
                ...old.config.rubric,
                { id: crypto.randomUUID(), name: '', description: '', points: 1 },
              ];
              return {
                ...old,
                config: { ...old.config, rubric },
                points: rubric.reduce((sum, d) => sum + d.points, 0),
              };
            })
          }
        >
          Add grading criterion
        </Button>
      </QuestionField>
      <details>
        <summary>Teacher-only reference example</summary>
        <label>
          Private reference answer
          <TextAreaField
            value={q.answerKey.referenceText}
            onChange={(e) =>
              edit((old) => ({
                ...old,
                answerKey: { ...old.answerKey, referenceText: e.target.value },
              }))
            }
          />
        </label>
        <ContentEditor
          compact
          {...ctx}
          label="Private reference materials"
          limit={10000}
          content={q.answerKey.referenceContent}
          onChange={(action) =>
            edit((old) => ({
              ...old,
              answerKey: {
                ...old.answerKey,
                referenceContent:
                  typeof action === 'function' ? action(old.answerKey.referenceContent) : action,
              },
            }))
          }
        />
      </details>
    </>
  );
}
export function QuestionEditor({
  q,
  edit,
  token,
  assignmentId,
  number: display,
}: {
  q: QuestionV2;
  edit: Edit<QuestionV2>;
  token: string;
  assignmentId?: string;
  number: string;
}) {
  const confirm = useConfirm();
  const context: UploadContext | null = assignmentId
    ? { assignmentId, questionId: q.id, contentNodeId: null, purpose: 'TEACHING' }
    : null;
  const ctx = { token, context };
  const blanks =
    q.type === 'FILL_BLANK' || q.type === 'CLOZE_CHOICE' ? q.config.blanks.map((b) => b.id) : [];
  return (
    <div className="question-editor">
      {q.type !== 'COMPOSITE' ? (
        <label>
          Question type
          <SelectField
            value={q.type}
            onChange={async (selectedValue) => {
              const type = selectedValue as QuestionV2['type'];
              if (type === q.type) return;
              if (
                !(await confirm({
                  title: 'Change the question type?',
                  description:
                    'This clears the current choices, blanks, answers, rubric and scoring configuration. Teaching media and instructions are retained.',
                  confirmLabel: 'Change type',
                  cancelLabel: 'Keep type',
                  danger: true,
                }))
              )
                return;
              edit((old) => {
                let prompt = old.prompt;
                if (old.type === 'FILL_BLANK' || old.type === 'CLOZE_CHOICE')
                  for (const b of old.config.blanks) prompt = tokenRemoved(prompt, b.id);
                return {
                  ...newQuestion(type, old.parentId, old.position),
                  id: old.id,
                  prompt,
                  answerAreaContent: old.answerAreaContent,
                  explanation: old.explanation,
                };
              });
            }}
          >
            {Object.entries(questionLabels)
              .filter(([type]) => type !== 'COMPOSITE')
              .map(([type, name]) => (
                <option value={type} key={type}>
                  {name}
                </option>
              ))}
          </SelectField>
        </label>
      ) : (
        <label>
          Group template
          <SelectField
            value={q.config.kind}
            onChange={(selectedValue) =>
              edit((old) =>
                old.type === 'COMPOSITE'
                  ? { ...old, config: { kind: selectedValue as 'READING' | 'GENERAL' } }
                  : old,
              )
            }
          >
            <option value="READING">Reading</option>
            <option value="GENERAL">Shared question / subtasks</option>
          </SelectField>
        </label>
      )}
      {q.type === 'COMPOSITE' && (
        <p className="type-hint">
          Add shared reading or instructions here, then add questions below. Each question has its
          own answer and points.
        </p>
      )}
      {q.type !== 'COMPOSITE' && (
        <section className="question-scoring" aria-label={`Scoring for question ${display}`}>
          <div className="scoring-heading">
            <h4>Scoring</h4>
            <span>{unitPoints(q) !== null ? 'Auto total' : 'Whole question'}</span>
          </div>
          <QuestionField path="points" label="Total points">
            {unitPoints(q) !== null ? (
              <div className="calculated-points">
                Total points: <output aria-label="Total points">{unitPoints(q)}</output>
                <span className="scoring-help">Updates automatically as you edit unit points.</span>
                <ScoreBreakdown q={q} />
                {unitPoints(q)! > 100 && (
                  <span className="error">
                    {' '}
                    Reduce scoring units to at most 100 points per question.
                  </span>
                )}
              </div>
            ) : (
              <PointInput
                value={q.points}
                edit={(points) =>
                  edit((old) => (old.type === 'COMPOSITE' ? old : { ...old, points }))
                }
              />
            )}
          </QuestionField>
        </section>
      )}
      <QuestionField path="prompt" label="Question text">
        <ContentEditor
          compact
          {...ctx}
          label="Question text"
          content={q.prompt}
          blankIds={blanks}
          limit={q.type === 'COMPOSITE' ? 30000 : 5000}
          onChange={(action) =>
            edit((old) => ({
              ...old,
              prompt: typeof action === 'function' ? action(old.prompt) : action,
            }))
          }
        />
      </QuestionField>
      <details>
        <summary>Answer area materials</summary>
        <QuestionField path="answerAreaContent" label="Answer area materials">
          <ContentEditor
            compact
            {...ctx}
            label="Answer area instructions"
            limit={2000}
            content={q.answerAreaContent}
            onChange={(action) =>
              edit((old) => ({
                ...old,
                answerAreaContent:
                  typeof action === 'function' ? action(old.answerAreaContent) : action,
              }))
            }
          />
        </QuestionField>
      </details>
      {q.type === 'SINGLE_CHOICE' && (
        <Single {...ctx} q={q} edit={typedEdit(q, edit)} number={display} />
      )}
      {q.type === 'FILL_BLANK' && (
        <QuestionField path="config.blanks" label="Blanks" exact>
          <QuestionField path="answerKey.answers" label="Blank answers" exact>
            <Fill q={q} edit={typedEdit(q, edit)} />
          </QuestionField>
        </QuestionField>
      )}
      {q.type === 'CLOZE_CHOICE' && (
        <QuestionField path="config.blanks" label="Blanks" exact>
          <QuestionField path="answerKey.answers" label="Blank answers">
            <Cloze {...ctx} q={q} edit={typedEdit(q, edit)} />
          </QuestionField>
        </QuestionField>
      )}
      {q.type === 'GROUPING' && <Grouping {...ctx} q={q} edit={typedEdit(q, edit)} />}
      {q.type === 'MATCHING' && <Matching {...ctx} q={q} edit={typedEdit(q, edit)} />}
      {q.type === 'ORDERING' && <Ordering {...ctx} q={q} edit={typedEdit(q, edit)} />}
      {q.type === 'RESPONSE' && (
        <QuestionField path="config" label="Answer requirements" exact>
          <Response {...ctx} q={q} edit={typedEdit(q, edit)} />
        </QuestionField>
      )}
      {q.type !== 'COMPOSITE' && (
        <>
          <details className="question-advanced">
            <summary>More question settings</summary>
            {q.type !== 'RESPONSE' && (
              <label>
                <InputField
                  type="checkbox"
                  checked={q.evidenceEnabled}
                  onChange={(e) =>
                    edit((old) =>
                      old.type === 'COMPOSITE' || old.type === 'RESPONSE'
                        ? old
                        : { ...old, evidenceEnabled: e.target.checked },
                    )
                  }
                />
                Allow optional image/audio evidence (does not affect automatic scoring)
              </label>
            )}
            <details>
              <summary>Private explanation</summary>
              <label>
                Teacher-only explanation
                <TextAreaField
                  value={q.explanation}
                  onChange={(e) => edit((old) => ({ ...old, explanation: e.target.value }))}
                />
              </label>
            </details>
          </details>
        </>
      )}
    </div>
  );
}
