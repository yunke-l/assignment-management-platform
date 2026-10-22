import {
  mediaLimits,
  type AssetView,
  type PublicQuestionV2,
  type QuestionV2,
} from '@amp/contracts';
type FileAnswer = { assetIds: string[]; evidenceAssetIds: string[] };
type Question = QuestionV2 | PublicQuestionV2;
type FileInfo = Pick<AssetView, 'kind' | 'bytes'>;
/** Reserve the largest remaining minimal valid path, including image-or-audio tasks. */
export function attachmentCapacity(
  questions: Question[],
  answers: Record<string, FileAnswer>,
  files: Record<string, FileInfo | null>,
) {
  const ids = new Set<string>();
  let reservedFiles = 0,
    reservedBytes = 0;
  for (const q of questions) {
    if (q.type === 'COMPOSITE') continue;
    const answer = answers[q.id],
      own = [...(answer?.assetIds ?? []), ...(answer?.evidenceAssetIds ?? [])];
    own.forEach((id) => ids.add(id));
    if (q.type !== 'RESPONSE') continue;
    const images = own.filter((id) => files[id]?.kind === 'image').length;
    const audios = own.filter((id) => files[id]?.kind === 'audio').length;
    const missingImages = Math.max(0, q.config.minImages - images);
    const missingAudios = Math.max(0, q.config.minAudios - audios);
    reservedFiles += missingImages + missingAudios;
    reservedBytes +=
      missingImages * q.config.maxImageBytes + missingAudios * q.config.maxAudioBytes;
    if (!q.config.textEnabled && !q.config.minImages && !q.config.minAudios && !images && !audios) {
      reservedFiles++;
      reservedBytes += Math.max(
        q.config.maxImages ? q.config.maxImageBytes : 0,
        q.config.maxAudios ? q.config.maxAudioBytes : 0,
      );
    }
  }
  const usedBytes = [...ids].reduce((sum, id) => sum + (files[id]?.bytes ?? 0), 0);
  return {
    usedFiles: ids.size,
    usedBytes,
    reservedFiles,
    reservedBytes,
    freeFiles: mediaLimits.answerFiles - ids.size - reservedFiles,
    freeBytes: mediaLimits.answerBytes - usedBytes - reservedBytes,
  };
}
export function checkAttachmentAddition(
  questions: Question[],
  answers: Record<string, FileAnswer>,
  files: Record<string, FileInfo | null>,
  questionId: string,
  kind: 'image' | 'audio',
  bytes: number,
): string | null {
  const q = questions.find((q) => q.id === questionId);
  if (!q || q.type === 'COMPOSITE') return 'This question cannot receive an attachment.';
  const answer = answers[questionId],
    own = [...(answer?.assetIds ?? []), ...(answer?.evidenceAssetIds ?? [])];
  if (own.some((id) => !files[id]))
    return 'Wait for the existing file status before adding another attachment.';
  const count = own.filter((id) => files[id]?.kind === kind).length;
  const limit =
    q.type === 'RESPONSE'
      ? kind === 'image'
        ? q.config.maxImages
        : q.config.maxAudios
      : kind === 'image'
        ? 3
        : 1;
  if (count >= limit) return `This question allows at most ${limit} ${kind} attachments.`;
  const id = '__incoming_file__',
    field = q.type === 'RESPONSE' ? 'assetIds' : 'evidenceAssetIds';
  const capacity = attachmentCapacity(
    questions,
    {
      ...answers,
      [questionId]: { ...answer, [field]: [...(answer?.[field] ?? []), id] } as FileAnswer,
    },
    { ...files, [id]: { kind, bytes } },
  );
  return capacity.freeFiles < 0 || capacity.freeBytes < 0
    ? 'This attachment would use capacity reserved for required answers. Remove optional attachments or choose a smaller file.'
    : null;
}
