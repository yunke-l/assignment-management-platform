import { z } from 'zod';
import { limitedText, uuidSchema } from './primitives.js';

export const uploadInitSchema = z
  .object({
    uploadRequestId: uuidSchema,
    assignmentId: uuidSchema,
    questionId: uuidSchema,
    contentNodeId: uuidSchema.nullable(),
    purpose: z.enum(['TEACHING', 'ANSWER']),
    kind: z.enum(['image', 'audio']),
    name: limitedText(200, 1).refine(
      (s) =>
        !/[/\\]/.test(s) &&
        [...s].every((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0)! !== 127),
      'Use a filename without paths or control characters.',
    ),
    mime: limitedText(100, 1),
    // The service applies kind-specific limits with HTTP 413 before reserving
    // quota. Keeping size validation there avoids misreporting oversize as 400.
    bytes: z.number().int().positive(),
  })
  .strict();
export type UploadInit = z.infer<typeof uploadInitSchema>;
export type AssetView = {
  id: string;
  uploadId: string;
  kind: 'image' | 'audio';
  purpose: 'TEACHING' | 'ANSWER';
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  bytes: number;
  mime: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  contentUrl: string | null;
  thumbnailUrl: string | null;
  caption: string;
  originalName?: string;
  transcript?: string;
};
