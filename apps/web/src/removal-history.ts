import type { QuestionV2 } from '@amp/contracts';
import { reindexQuestions, withDerivedPoints } from './question-editor.js';

export type Removal = { before: QuestionV2[]; after: QuestionV2[] };
function ids(value: unknown, result = new Set<string>()) {
  if (Array.isArray(value)) value.forEach((item) => ids(item, result));
  else if (value && typeof value === 'object') {
    if ('id' in value && typeof value.id === 'string') result.add(value.id);
    Object.values(value).forEach((item) => ids(item, result));
  }
  return result;
}
export function hasRemoval(before: QuestionV2[], after: QuestionV2[]) {
  const remaining = ids(after);
  // Type changes have their own destructive-action confirmation. They are not
  // removals: merging an older type into a newer edited configuration is unsafe.
  const sameTypes = before.filter((q) => {
    const next = after.find((item) => item.id === q.id);
    return !next || next.type === q.type;
  });
  return [...ids(sameTypes)].some((id) => !remaining.has(id));
}
function identity(value: unknown): string {
  if (value && typeof value === 'object')
    for (const key of ['id', 'blankId', 'itemId', 'leftId'])
      if (key in value) return `${key}:${(value as Record<string, unknown>)[key]}`;
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// Apply the inverse of a removal only where its result is still unchanged.
// Stable identities let later typing, additions and reordering survive undo.
function restore(before: unknown, after: unknown, current: unknown): unknown {
  if (
    after &&
    current &&
    typeof after === 'object' &&
    typeof current === 'object' &&
    'type' in after &&
    'type' in current &&
    after.type !== current.type
  )
    return current;
  if (equal(current, after)) return before;
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    const old = new Map(before.map((item) => [identity(item), item]));
    const removedFrom = new Map(after.map((item) => [identity(item), item]));
    const result = current.map((item) => {
      const key = identity(item);
      return old.has(key) && removedFrom.has(key)
        ? restore(old.get(key), removedFrom.get(key), item)
        : item;
    });
    before.forEach((item, index) => {
      const key = identity(item);
      if (removedFrom.has(key) || result.some((value) => identity(value) === key)) return;
      const next = before
        .slice(index + 1)
        .find((value) => result.some((candidate) => identity(candidate) === identity(value)));
      const position =
        next === undefined ? -1 : result.findIndex((value) => identity(value) === identity(next));
      result.splice(position < 0 ? result.length : position, 0, item);
    });
    return result;
  }
  if (
    before &&
    after &&
    current &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    typeof current === 'object'
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(current).map(([key, value]) => [
        key,
        key in a && key in b ? restore(a[key], b[key], value) : value,
      ]),
    );
  }
  return current;
}
export function restoreRemoval(removal: Removal, current: QuestionV2[]) {
  return reindexQuestions(
    (restore(removal.before, removal.after, current) as QuestionV2[]).map(withDerivedPoints),
  );
}
