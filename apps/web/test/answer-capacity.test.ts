import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaLimits, type QuestionV2 } from '@amp/contracts';
import { attachmentCapacity, checkAttachmentAddition } from '../src/answer-capacity.js';
import { newQuestion } from '../src/question-editor.js';
function response(position: number, textEnabled = true) {
  const q = newQuestion('RESPONSE', null, position);
  if (q.type !== 'RESPONSE') throw new Error('Unexpected type');
  q.config = {
    ...q.config,
    textEnabled,
    textRequired: textEnabled,
    maxImages: 5,
    maxAudios: 2,
    minImages: textEnabled ? 1 : 0,
  };
  return q;
}
test('optional evidence cannot consume the capacity reserved for mandatory answers', () => {
  const tasks = Array.from({ length: 5 }, (_, i) => response(i));
  const choice = newQuestion('SINGLE_CHOICE', null, 5);
  const answers = { [choice.id]: { assetIds: [], evidenceAssetIds: ['large'] } };
  const files = { large: { kind: 'audio' as const, bytes: mediaLimits.audioBytes } };
  const capacity = attachmentCapacity([...tasks, choice], answers, files);
  assert.equal(capacity.reservedFiles, 5);
  assert.equal(capacity.freeBytes, 0);
  assert.match(
    checkAttachmentAddition([...tasks, choice], answers, files, choice.id, 'image', 1)!,
    /reserved/,
  );
  // Filling a required image consumes its reservation, rather than charging twice.
  assert.equal(
    checkAttachmentAddition(
      [...tasks, choice],
      answers,
      files,
      tasks[0]!.id,
      'image',
      mediaLimits.imageBytes,
    ),
    null,
  );
});
test('image-or-audio questions reserve the largest valid input path; completed answers release it', () => {
  const q = response(0, false);
  assert.equal(attachmentCapacity([q], {}, {}).reservedBytes, mediaLimits.audioBytes);
  assert.equal(
    attachmentCapacity(
      [q],
      { [q.id]: { assetIds: ['image'], evidenceAssetIds: [] } },
      { image: { kind: 'image', bytes: 100 } },
    ).reservedBytes,
    0,
  );
});
test('files in transfer count against limits and an unknown status prevents concurrent overfilling', () => {
  const q = response(0);
  const answers = { [q.id]: { assetIds: ['pending'], evidenceAssetIds: [] } };
  assert.match(checkAttachmentAddition([q], answers, {}, q.id, 'image', 1)!, /Wait/);
  q.config.maxImages = 1;
  assert.match(
    checkAttachmentAddition(
      [q],
      answers,
      { pending: { kind: 'image', bytes: 100 } },
      q.id,
      'image',
      1,
    )!,
    /at most 1/,
  );
});
test('minimum counts are reserved across a maximum legal tree without charging shared materials', () => {
  const group = newQuestion('COMPOSITE', null, 0);
  const children: QuestionV2[] = [response(0), response(1)];
  children.forEach((q) => {
    q.parentId = group.id;
  });
  assert.equal(attachmentCapacity([group, ...children], {}, {}).reservedFiles, 2);
});
