import { InputField, SelectField, Button, TextAreaField } from './Controls';
import { useId, useState, type ReactNode } from 'react';
import {
  answerV2Schema,
  contentText,
  validateAnswers,
  type AssetView,
  type AnswerV2,
  type PublicQuestionV2,
  type QuestionV2,
  type ChoiceV2,
  type QuestionResult,
} from '@amp/contracts';
import { ContentView, FileUpload, AssetPreview } from './Media';
import { questionLabels } from './question-editor';

export { draftAnswerSchema, emptyAnswer, type DraftAnswer } from './answer-draft';
import { compatibleDraft, emptyAnswer, type DraftAnswer } from './answer-draft';
type Leaf = Exclude<QuestionV2 | PublicQuestionV2, { type: 'COMPOSITE' }>;
export function actualAnswer(q: Leaf, draft: DraftAnswer): AnswerV2 | null {
  draft = compatibleDraft(q, draft);
  let payload: unknown;
  switch (q.type) {
    case 'SINGLE_CHOICE':
      payload = { optionId: draft.optionId };
      break;
    case 'FILL_BLANK':
      payload = {
        blanks: Object.entries(draft.blanks).map(([blankId, text]) => ({ blankId, text })),
      };
      break;
    case 'CLOZE_CHOICE':
      payload = {
        blanks: Object.entries(draft.blanks).map(([blankId, optionId]) => ({ blankId, optionId })),
      };
      break;
    case 'GROUPING':
      payload = {
        placements: Object.entries(draft.placements).map(([itemId, groupId]) => ({
          itemId,
          groupId,
        })),
      };
      break;
    case 'MATCHING':
      payload = {
        pairs: Object.entries(draft.pairs).map(([leftId, rightId]) => ({ leftId, rightId })),
      };
      break;
    case 'ORDERING':
      payload = {
        orderedItemIds: draft.orderedItemIds.length ? draft.orderedItemIds : q.config.initialOrder,
        // The displayed sequence is the answer; keep the existing API's compatibility flag.
        confirmed: true,
      };
      break;
    case 'RESPONSE':
      payload = { text: draft.text, assetIds: draft.assetIds };
      break;
  }
  const result = answerV2Schema.safeParse({
    questionId: q.id,
    type: q.type,
    payload,
    evidenceAssetIds: draft.evidenceAssetIds,
  });
  return result.success && !validateAnswers([q], [result.data]).length ? result.data : null;
}
export function restoreAnswer(answer: AnswerV2): DraftAnswer {
  const draft = emptyAnswer();
  draft.evidenceAssetIds = answer.evidenceAssetIds;
  switch (answer.type) {
    case 'SINGLE_CHOICE':
      draft.optionId = answer.payload.optionId;
      break;
    case 'FILL_BLANK':
      draft.blanks = Object.fromEntries(answer.payload.blanks.map((b) => [b.blankId, b.text]));
      break;
    case 'CLOZE_CHOICE':
      draft.blanks = Object.fromEntries(answer.payload.blanks.map((b) => [b.blankId, b.optionId]));
      break;
    case 'GROUPING':
      draft.placements = Object.fromEntries(
        answer.payload.placements.map((p) => [p.itemId, p.groupId]),
      );
      break;
    case 'MATCHING':
      draft.pairs = Object.fromEntries(answer.payload.pairs.map((p) => [p.leftId, p.rightId]));
      break;
    case 'ORDERING':
      draft.orderedItemIds = answer.payload.orderedItemIds;
      draft.confirmed = true;
      break;
    case 'RESPONSE':
      draft.text = answer.payload.text;
      draft.assetIds = answer.payload.assetIds;
      break;
  }
  return draft;
}
export const choiceLabel = (choice: ChoiceV2, index = 0) =>
  choice.label || contentText(choice.content).trim() || `Item ${index + 1}`;
function AnswerChoice({ choice, token }: { choice?: ChoiceV2; token: string }) {
  if (!choice) return <p>Not set</p>;
  const hasText = !!contentText(choice.content).trim();
  const hasMedia = choice.content.some((block) => block.type === 'image' || block.type === 'audio');
  return (
    <>
      {!hasText && (choice.label || !hasMedia) && <p>{choice.label || 'Not set'}</p>}
      <ContentView content={choice.content} token={token} />
    </>
  );
}
export function QuestionAnswer({
  q,
  anchorId,
  children,
  number,
  answer,
  onChange,
  token,
  assignmentId,
  disabled,
  teacher = false,
  showAnswerKey = teacher,
  result,
  onStatus,
  onUploadBusy,
  canUpload,
}: {
  q: Leaf;
  anchorId?: string;
  children?: ReactNode;
  number: string;
  answer: DraftAnswer;
  onChange: (change: (old: DraftAnswer) => DraftAnswer) => void;
  token: string;
  assignmentId?: string;
  disabled: boolean;
  teacher?: boolean;
  showAnswerKey?: boolean;
  result?: Pick<QuestionResult, 'score' | 'maxScore' | 'units'>;
  onStatus?: (id: string, asset: AssetView | null) => void;
  onUploadBusy?: (key: string, busy: boolean) => void;
  canUpload?: (id: string, kind: 'image' | 'audio', bytes: number) => string | null;
}) {
  answer = compatibleDraft(q, answer);
  const key = teacher && showAnswerKey && 'answerKey' in q ? q : null;
  const choiceGroup = useId();
  const [activeLeft, setActiveLeft] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  function mapValue(field: 'blanks' | 'placements' | 'pairs', id: string, value: string) {
    onChange((old) => {
      const values = { ...old[field] };
      if (value) values[id] = value;
      else delete values[id];
      return { ...old, [field]: values };
    });
  }
  function pair(leftId: string, rightId: string) {
    if (q.type !== 'MATCHING') return;
    if (
      q.config.mode === 'ONE_TO_ONE' &&
      Object.entries(answer.pairs).some(([left, right]) => left !== leftId && right === rightId)
    ) {
      setHint('That target is already connected. Clear its existing connection first.');
      return;
    }
    setHint('');
    mapValue('pairs', leftId, rightId);
    setActiveLeft(null);
  }
  const blank = (id: string) => {
    if (q.type !== 'FILL_BLANK' && q.type !== 'CLOZE_CHOICE') return null;
    const index = q.config.blanks.findIndex((b) => b.id === id),
      gap = q.config.blanks[index];
    if (key?.type === 'FILL_BLANK' || key?.type === 'CLOZE_CHOICE') {
      let value: string | undefined;
      if (key.type === 'FILL_BLANK') {
        value = key.answerKey.answers.find((a) => a.blankId === id)?.values.join(' / ');
      } else {
        const correctId = key.answerKey.answers.find((a) => a.blankId === id)?.optionId;
        const option = key.config.blanks
          .find((b) => b.id === id)
          ?.options.find((o) => o.id === correctId);
        if (option) value = choiceLabel(option);
      }
      return (
        <span
          className="inline-answer teacher-blank-answer"
          role="note"
          aria-label={`Question ${number} blank ${index + 1} answer key`}
        >
          <strong>{value || 'Not set'}</strong>
          {gap && 'caseSensitive' in gap && (
            <small>{gap.caseSensitive ? 'Case sensitive' : 'Not case sensitive'}</small>
          )}
        </span>
      );
    }
    if (q.type === 'FILL_BLANK')
      return (
        <label className="inline-answer">
          <InputField
            value={answer.blanks[id] ?? ''}
            disabled={disabled}
            onChange={(e) => mapValue('blanks', id, e.target.value)}
            aria-label={`Question ${number} blank ${index + 1}`}
          />
        </label>
      );
    const options = gap && 'options' in gap ? gap.options : [];
    return (
      <label className="inline-answer">
        <SelectField
          disabled={disabled}
          value={answer.blanks[id] ?? ''}
          onChange={(selectedValue) => mapValue('blanks', id, selectedValue)}
          aria-label={`Question ${number} blank ${index + 1}`}
        >
          <option value="">Choose…</option>
          {options.map((o, i) => (
            <option key={o.id} value={o.id}>
              {choiceLabel(o, i)}
            </option>
          ))}
        </SelectField>
      </label>
    );
  };
  const cards = (items: ChoiceV2[]) =>
    items.map((item) => (
      <div className="answer-card" key={item.id}>
        <ContentView content={item.content} token={token} />
      </div>
    ));
  const uploadField = q.type === 'RESPONSE' ? 'assetIds' : 'evidenceAssetIds';
  const files = answer[uploadField];
  function remove(id: string) {
    onChange((old) => ({ ...old, [uploadField]: old[uploadField].filter((a) => a !== id) }));
  }
  const order =
    q.type === 'ORDERING'
      ? answer.orderedItemIds.length
        ? answer.orderedItemIds
        : q.config.initialOrder
      : [];
  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    const next = [...order],
      [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange((old) => ({ ...old, orderedItemIds: next }));
  }
  return (
    <section
      className="question mixed-question"
      id={anchorId ?? `question-${q.id}`}
      aria-label={`Question ${number}`}
    >
      <h3>
        <span className="question-number">{number}</span> {questionLabels[q.type]}{' '}
        <small>{q.points} pts</small>
      </h3>
      {q.type !== 'RESPONSE' && typeof result?.score === 'number' && (
        <p className="question-score" aria-label={`Automatic score for question ${number}`}>
          <b>
            Automatically graded · {result.score} / {result.maxScore} points
          </b>
        </p>
      )}
      <ContentView content={q.prompt} token={token} blank={blank} />
      <ContentView content={q.answerAreaContent} token={token} />
      {q.type === 'SINGLE_CHOICE' && (
        <div role="radiogroup" aria-label={`Question ${number} options`}>
          {q.config.options.map((o, i) => (
            <div
              className={`option ${key?.type === 'SINGLE_CHOICE' && key.answerKey.correctOptionId === o.id ? 'correct' : ''}`}
              key={o.id}
            >
              <label>
                <InputField
                  type="radio"
                  aria-label={choiceLabel(o, i)}
                  disabled={disabled}
                  name={`${choiceGroup}-${q.id}`}
                  checked={
                    key?.type === 'SINGLE_CHOICE'
                      ? key.answerKey.correctOptionId === o.id
                      : answer.optionId === o.id
                  }
                  onChange={() => onChange((old) => ({ ...old, optionId: o.id }))}
                />
                <ContentView
                  content={o.content.filter((b) => b.type !== 'audio' && b.type !== 'image')}
                  token={token}
                />{' '}
                {key?.type === 'SINGLE_CHOICE' && key.answerKey.correctOptionId === o.id && (
                  <small className="answer-key-label">Answer key</small>
                )}
              </label>
              <ContentView
                content={o.content.filter((b) => b.type === 'audio' || b.type === 'image')}
                token={token}
              />
            </div>
          ))}
        </div>
      )}
      {q.type === 'FILL_BLANK' && !key && (
        <small>Enter a word or phrase (up to 200 characters) in every blank.</small>
      )}
      {q.type === 'CLOZE_CHOICE' &&
        q.config.blanks.map((gap, i) => (
          <details key={gap.id} open={key ? true : undefined}>
            <summary>View options for blank {i + 1}</summary>
            {gap.options.map((o, j) => (
              <div className="answer-card" key={o.id}>
                <ContentView content={o.content} token={token} />
                {key?.type === 'CLOZE_CHOICE' ? (
                  key.answerKey.answers.some(
                    (a) => a.blankId === gap.id && a.optionId === o.id,
                  ) && <span className="answer-key-label">Answer key</span>
                ) : (
                  <Button
                    type="button"
                    disabled={disabled}
                    onClick={() => mapValue('blanks', gap.id, o.id)}
                  >
                    Choose {choiceLabel(o, j)}
                  </Button>
                )}
              </div>
            ))}
          </details>
        ))}
      {q.type === 'GROUPING' && (
        <>
          {!key && <div className="group-cards">{cards(q.config.groups)}</div>}
          {q.config.items.map((item, i) => {
            const group =
              key?.type === 'GROUPING'
                ? key.config.groups.find(
                    (g) =>
                      g.id === key.answerKey.placements.find((p) => p.itemId === item.id)?.groupId,
                  )
                : undefined;
            return (
              <div className="answer-card" key={item.id}>
                <ContentView content={item.content} token={token} />
                {key?.type === 'GROUPING' ? (
                  <div className="inline-answer-key group-answer-key">
                    <b>Answer key</b>
                    <AnswerChoice choice={group} token={token} />
                  </div>
                ) : (
                  <label>
                    Category for {choiceLabel(item, i)}
                    <SelectField
                      aria-label={`Category for ${choiceLabel(item, i)}`}
                      disabled={disabled}
                      value={answer.placements[item.id] ?? ''}
                      onChange={(selectedValue) => mapValue('placements', item.id, selectedValue)}
                    >
                      <option value="">Not grouped</option>
                      {q.config.groups.map((g, j) => (
                        <option key={g.id} value={g.id}>
                          {choiceLabel(g, j)}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                )}
              </div>
            );
          })}
        </>
      )}
      {q.type === 'MATCHING' &&
        (key?.type === 'MATCHING' ? (
          <div className="matching-answer-key">
            {key.config.left.map((item) => {
              const target = key.config.right.find(
                (r) => r.id === key.answerKey.pairs.find((p) => p.leftId === item.id)?.rightId,
              );
              return (
                <div className="answer-card" key={item.id}>
                  <ContentView content={item.content} token={token} />
                  <div className="inline-answer-key">
                    <b>Answer key</b>
                    <AnswerChoice choice={target} token={token} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <p>
              {q.config.mode === 'ONE_TO_ONE'
                ? 'Each right item can be used once.'
                : 'Right items may be used more than once.'}{' '}
              Select a left item, then a right item, or use the selectors.
            </p>
            <div className="matching-columns">
              <div>
                {q.config.left.map((item, i) => (
                  <div
                    className="answer-card matching-card"
                    key={item.id}
                    data-paired={!!answer.pairs[item.id] || undefined}
                    data-active={activeLeft === item.id || undefined}
                  >
                    <Button
                      type="button"
                      aria-pressed={activeLeft === item.id}
                      disabled={disabled}
                      onClick={() => {
                        setActiveLeft(item.id);
                        setHint('');
                      }}
                    >
                      Select {choiceLabel(item, i)}
                    </Button>
                    <ContentView content={item.content} token={token} />
                    <label>
                      Connect {choiceLabel(item, i)} to
                      <SelectField
                        aria-label={`Connect ${choiceLabel(item, i)} to`}
                        disabled={disabled}
                        value={answer.pairs[item.id] ?? ''}
                        onChange={(selectedValue) => pair(item.id, selectedValue)}
                      >
                        <option value="">Not connected</option>
                        {q.config.right.map((right, j) => (
                          <option
                            key={right.id}
                            value={right.id}
                            disabled={
                              q.config.mode === 'ONE_TO_ONE' &&
                              Object.entries(answer.pairs).some(
                                ([left, target]) => left !== item.id && target === right.id,
                              )
                            }
                          >
                            {choiceLabel(right, j)}
                          </option>
                        ))}
                      </SelectField>
                    </label>
                  </div>
                ))}
              </div>
              <div>
                {q.config.right.map((item, i) => (
                  <div
                    className="answer-card matching-card"
                    key={item.id}
                    data-paired={Object.values(answer.pairs).includes(item.id) || undefined}
                    data-active={
                      (!!activeLeft && answer.pairs[activeLeft] === item.id) || undefined
                    }
                  >
                    <Button
                      type="button"
                      disabled={disabled || !activeLeft}
                      onClick={() => {
                        if (activeLeft) pair(activeLeft, item.id);
                      }}
                    >
                      Connect to {choiceLabel(item, i)}
                    </Button>
                    <ContentView content={item.content} token={token} />
                  </div>
                ))}
              </div>
            </div>
            {hint && <p role="status">{hint}</p>}
          </>
        ))}
      {q.type === 'ORDERING' &&
        (key?.type === 'ORDERING' ? (
          <div className="ordering-answer-key">
            {key.answerKey.orders.length ? (
              key.answerKey.orders.map((ids, index) => (
                <div key={index}>
                  <b>
                    {key.answerKey.orders.length === 1
                      ? 'Answer key'
                      : `Acceptable order ${index + 1}`}
                  </b>
                  <ol className="ordering-list">
                    {ids.map((id) => {
                      const item = key.config.items.find((item) => item.id === id);
                      return item ? (
                        <li key={id}>
                          <AnswerChoice choice={item} token={token} />
                        </li>
                      ) : null;
                    })}
                  </ol>
                </div>
              ))
            ) : (
              <p>Answer key: Not set</p>
            )}
          </div>
        ) : (
          <>
            <ol className="ordering-list">
              {order.map((id, index) => {
                const card = q.config.items.find((i) => i.id === id);
                return card ? (
                  <li key={id}>
                    <ContentView content={card.content} token={token} />
                    <div className="inline-actions">
                      <Button
                        type="button"
                        disabled={disabled || !index}
                        aria-label={`Move ${choiceLabel(card, index)} up`}
                        onClick={() => move(index, index - 1)}
                      >
                        ↑ Up
                      </Button>
                      <Button
                        type="button"
                        disabled={disabled || index === order.length - 1}
                        aria-label={`Move ${choiceLabel(card, index)} down`}
                        onClick={() => move(index, index + 1)}
                      >
                        ↓ Down
                      </Button>
                      <label>
                        Position
                        <SelectField
                          aria-label="Position"
                          disabled={disabled}
                          value={index}
                          onChange={(selectedValue) => move(index, Number(selectedValue))}
                        >
                          {order.map((_, j) => (
                            <option key={j} value={j}>
                              {j + 1}
                            </option>
                          ))}
                        </SelectField>
                      </label>
                    </div>
                  </li>
                ) : null;
              })}
            </ol>
          </>
        ))}
      {q.type === 'RESPONSE' && (
        <>
          {key?.type === 'RESPONSE' ? (
            <div className="reference-answer">
              <b>Reference answer</b>
              {key.answerKey.referenceText && <p>{key.answerKey.referenceText}</p>}
              <ContentView content={key.answerKey.referenceContent} token={token} />
              {!key.answerKey.referenceText && !key.answerKey.referenceContent.length && (
                <p>Not set</p>
              )}
            </div>
          ) : (
            <>
              <p>
                {q.config.textRequired ? 'Text required. ' : ''}Images: {q.config.minImages}–
                {q.config.maxImages}; audio: {q.config.minAudios}–{q.config.maxAudios}. Your teacher
                will grade this response.
              </p>
              {q.config.textEnabled && (
                <label>
                  Your response
                  <TextAreaField
                    aria-label="Your response"
                    disabled={disabled}
                    rows={4}
                    value={answer.text}
                    onChange={(e) => onChange((old) => ({ ...old, text: e.target.value }))}
                  />
                  <small>{[...answer.text].length} / 2000 characters</small>
                </label>
              )}
            </>
          )}
          <details>
            <summary>Assessment criteria</summary>
            {q.config.rubric.map((dimension) => (
              <p key={dimension.id}>
                <b>
                  {dimension.name} · {dimension.points} pts
                </b>
                <br />
                {dimension.description}
              </p>
            ))}
          </details>
        </>
      )}
      {key?.explanation && (
        <p className="question-explanation">
          <b>Explanation</b>
          <br />
          {key.explanation}
        </p>
      )}
      {q.type !== 'RESPONSE' && result && result.units.length > 1 && (
        <details>
          <summary>Scoring details</summary>
          {result.units.map((unit, index) => (
            <p key={unit.unitId}>
              Item {index + 1}: {unit.correct ? 'Correct' : 'Incorrect'} · {unit.score} /{' '}
              {unit.points} points
            </p>
          ))}
        </details>
      )}
      {(q.type === 'RESPONSE' || q.evidenceEnabled) && (
        <div className="answer-attachments">
          {q.evidenceEnabled && (
            <p>
              Optional evidence: up to 3 images and 1 audio. Attachments do not affect this
              question’s automatic score.
            </p>
          )}
          {files.map((id, i) => (
            <div key={id}>
              <AssetPreview
                id={id}
                token={token}
                label={`Student attachment ${i + 1}`}
                original={teacher}
                onStatus={onStatus}
                caption={answer.captions?.[id]}
                onCaption={
                  !disabled && !teacher
                    ? (caption) =>
                        onChange((old) => ({
                          ...old,
                          captions: { ...old.captions, [id]: caption },
                        }))
                    : undefined
                }
              />
              {!disabled && (
                <Button type="button" onClick={() => remove(id)}>
                  Remove attachment {i + 1}
                </Button>
              )}
            </div>
          ))}
          {!teacher &&
            !disabled &&
            (['image', 'audio'] as const).map((kind) =>
              q.type === 'RESPONSE' &&
              !(kind === 'image' ? q.config.maxImages : q.config.maxAudios) ? null : (
                <FileUpload
                  key={kind}
                  token={token}
                  context={
                    assignmentId
                      ? { assignmentId, questionId: q.id, contentNodeId: null, purpose: 'ANSWER' }
                      : null
                  }
                  kind={kind}
                  validateFile={canUpload ? (file) => canUpload(q.id, kind, file.size) : undefined}
                  maxBytes={
                    q.type === 'RESPONSE'
                      ? kind === 'image'
                        ? q.config.maxImageBytes
                        : q.config.maxAudioBytes
                      : undefined
                  }
                  onAsset={(id) =>
                    onChange((old) => ({ ...old, [uploadField]: [...old[uploadField], id] }))
                  }
                  onRemove={remove}
                  onBusy={onUploadBusy}
                />
              ),
            )}
        </div>
      )}
      {children}
    </section>
  );
}
