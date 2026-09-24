import type { PipeTransform } from '@nestjs/common';
import { uuidSchema } from '@amp/contracts';

export const uuidPipe: PipeTransform = {
  transform(value: unknown) {
    return uuidSchema.parse(value);
  },
};
