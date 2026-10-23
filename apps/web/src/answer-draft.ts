import { z } from 'zod';
import type { PublicQuestionV2, QuestionV2 } from '@amp/contracts';
export const draftAnswerSchema = z
  .object({
    optionId: z.string().default(''),
    blanks: z.record(z.string(), z.string()).default({}),
    placements: z.record(z.string(), z.string()).default({}),
    pairs: z.record(z.string(), z.string()).default({}),
    orderedItemIds: z.array(z.string()).default([]),
    // Accept older saved drafts; manual order confirmation is no longer used.
    confirmed: z.boolean().default(false),
    text: z.string().default(''),
    assetIds: z.array(z.string()).default([]),
    evidenceAssetIds: z.array(z.string()).default([]),
    captions: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type DraftAnswer = z.infer<typeof draftAnswerSchema>;
export const emptyAnswer = (): DraftAnswer => draftAnswerSchema.parse({});
/** Drop obsolete local identity fields; retain visible input and recheck resource status. */
export function compatibleDraft(q: QuestionV2 | PublicQuestionV2, value: DraftAnswer): DraftAnswer {
  const draft = draftAnswerSchema.parse(value);
  switch (q.type) {
    case 'SINGLE_CHOICE':
      if (!q.config.options.some((o) => o.id === draft.optionId)) draft.optionId = '';
      break;
    case 'FILL_BLANK':
      draft.blanks = Object.fromEntries(
        Object.entries(draft.blanks).filter(([id]) => q.config.blanks.some((b) => b.id === id)),
      );
      break;
    case 'CLOZE_CHOICE':
      draft.blanks = Object.fromEntries(
        Object.entries(draft.blanks).filter(([id, option]) =>
          q.config.blanks.some((b) => b.id === id && b.options.some((o) => o.id === option)),
        ),
      );
      break;
    case 'GROUPING':
      draft.placements = Object.fromEntries(
        Object.entries(draft.placements).filter(
          ([id, group]) =>
            q.config.items.some((i) => i.id === id) && q.config.groups.some((g) => g.id === group),
        ),
      );
      break;
    case 'MATCHING':
      draft.pairs = Object.fromEntries(
        Object.entries(draft.pairs).filter(
          ([id, target]) =>
            q.config.left.some((i) => i.id === id) && q.config.right.some((r) => r.id === target),
        ),
      );
      break;
    case 'ORDERING':
      if (
        draft.orderedItemIds.length &&
        (new Set(draft.orderedItemIds).size !== q.config.items.length ||
          draft.orderedItemIds.length !== q.config.items.length ||
          draft.orderedItemIds.some((id) => !q.config.items.some((i) => i.id === id)))
      ) {
        draft.orderedItemIds = [];
        draft.confirmed = false;
      }
      break;
  }
  return draft;
}
