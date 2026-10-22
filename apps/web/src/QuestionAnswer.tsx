import { InputField, SelectField, Button, TextAreaField } from './Controls';
import { useState } from 'react';
import {
  answerV2Schema,
  contentText,
  validateAnswers,
  type AssetView,
  type AnswerV2,
  type PublicQuestionV2,
  type QuestionV2,
  type ChoiceV2,
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
        confirmed: draft.confirmed,
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
export function QuestionAnswer({
  q,
  number,
  answer,
  onChange,
  token,
  assignmentId,
  disabled,
  teacher = false,
  onStatus,
  onUploadBusy,
  canUpload,
}: {
  q: Leaf;
  number: string;
  answer: DraftAnswer;
  onChange: (change: (old: DraftAnswer) => DraftAnswer) => void;
  token: string;
  assignmentId?: string;
  disabled: boolean;
  teacher?: boolean;
  onStatus?: (id: string, asset: AssetView | null) => void;
  onUploadBusy?: (key: string, busy: boolean) => void;
  canUpload?: (id: string, kind: 'image' | 'audio', bytes: number) => string | null;
}) {
  answer = compatibleDraft(q, answer);
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
  }
  const blank = (id: string) => {
    if (q.type !== 'FILL_BLANK' && q.type !== 'CLOZE_CHOICE') return null;
    const index = q.config.blanks.findIndex((b) => b.id === id),
      gap = q.config.blanks[index];
    if (q.type === 'FILL_BLANK')
      return (
        <label className="inline-answer">
          Blank {index + 1}
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
        Blank {index + 1}
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
    onChange((old) => ({ ...old, orderedItemIds: next, confirmed: false }));
  }
  return (
    <section
      className="question mixed-question"
      id={`question-${q.id}`}
      aria-label={`Question ${number}`}
    >
      <h3>
        <span className="question-number">{number}</span> {questionLabels[q.type]}{' '}
        <small>{q.points} pts</small>
      </h3>
      <ContentView content={q.prompt} token={token} blank={blank} />
      <ContentView content={q.answerAreaContent} token={token} />
      {q.type === 'SINGLE_CHOICE' && (
        <div role="radiogroup" aria-label={`Question ${number} options`}>
          {q.config.options.map((o, i) => (
            <div
              className={`option ${teacher && 'answerKey' in q && q.answerKey.correctOptionId === o.id ? 'correct' : ''}`}
              key={o.id}
            >
              <label>
                <InputField
                  type="radio"
                  aria-label={choiceLabel(o, i)}
                  disabled={disabled}
                  name={q.id}
                  checked={answer.optionId === o.id}
                  onChange={() => onChange((old) => ({ ...old, optionId: o.id }))}
                />
                <ContentView
                  content={o.content.filter((b) => b.type !== 'audio' && b.type !== 'image')}
                  token={token}
                />{' '}
                {teacher && 'answerKey' in q && q.answerKey.correctOptionId === o.id && (
                  <small>Answer key</small>
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
      {q.type === 'FILL_BLANK' && (
        <small>Enter a word or phrase (up to 200 characters) in every blank.</small>
      )}
      {q.type === 'CLOZE_CHOICE' &&
        q.config.blanks.map((gap, i) => (
          <details key={gap.id}>
            <summary>View options for blank {i + 1}</summary>
            {gap.options.map((o, j) => (
              <div className="answer-card" key={o.id}>
                <ContentView content={o.content} token={token} />
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => mapValue('blanks', gap.id, o.id)}
                >
                  Choose {choiceLabel(o, j)}
                </Button>
              </div>
            ))}
          </details>
        ))}
      {q.type === 'GROUPING' && (
        <>
          <div className="group-cards">{cards(q.config.groups)}</div>
          {q.config.items.map((item, i) => (
            <div className="answer-card" key={item.id}>
              <ContentView content={item.content} token={token} />
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
            </div>
          ))}
        </>
      )}
      {q.type === 'MATCHING' && (
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
                <div className="answer-card" key={item.id}>
                  <Button
                    type="button"
                    aria-pressed={activeLeft === item.id}
                    disabled={disabled}
                    onClick={() => setActiveLeft(item.id)}
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
                <div className="answer-card" key={item.id}>
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
      )}
      {q.type === 'ORDERING' && (
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
          <Button
            type="button"
            disabled={disabled || !order.length}
            onClick={() => onChange((old) => ({ ...old, orderedItemIds: order, confirmed: true }))}
          >
            Confirm this order
          </Button>
          <p role="status">
            {answer.confirmed ? 'Order confirmed.' : 'Confirm your order before submitting.'}
          </p>
        </>
      )}
      {q.type === 'RESPONSE' && (
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
    </section>
  );
}
