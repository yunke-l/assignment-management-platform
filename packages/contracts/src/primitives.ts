import { z } from 'zod';

export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

/** Product text limits count Unicode code points, not UTF-16 code units. */
export function limitedText(max: number, min = 0) {
  return z.string().refine((value) => [...value].length >= min && [...value].length <= max, {
    message: `Use ${min}–${max} characters.`,
  });
}
