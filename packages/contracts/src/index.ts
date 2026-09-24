import { z } from 'zod';

// PostgreSQL accepts uppercase UUIDs and returns their lowercase canonical form.
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const questionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    points: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((value) => value.correctIndex < value.options.length, {
    path: ['correctIndex'],
    message: 'Correct option must exist.',
  });
export const createAssignmentSchema = z
  .object({
    classId: uuidSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    dueAt: z.iso.datetime({ offset: true }),
    questions: z.array(questionSchema).min(1).max(20),
  })
  .strict();
export const submissionSchema = z
  .object({
    requestId: uuidSchema,
    answers: z
      .array(
        z
          .object({ questionId: uuidSchema, selectedIndex: z.number().int().min(0).max(5) })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (value) => new Set(value.answers.map((a) => a.questionId)).size === value.answers.length,
    {
      path: ['answers'],
      message: 'Each question must appear exactly once.',
    },
  );
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type CreateAssignment = z.infer<typeof createAssignmentSchema>;
export type SubmitAssignment = z.infer<typeof submissionSchema>;
export type Actor = { id: string; name: string; email: string; role: 'TEACHER' | 'STUDENT' };
export type Classroom = { id: string; name: string };
export type Assignment = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  dueAt: string;
  createdAt: string;
  version: number;
};
export type QuestionView = {
  id: string;
  prompt: string;
  options: string[];
  points: number;
  correctIndex?: number;
};
export type Submission = {
  id: string;
  assignmentId: string;
  score: number;
  maxScore: number;
  submittedAt: string;
};
export type AssignmentDetail = Assignment & {
  questions: QuestionView[];
  submission: Submission | null;
};
export type AssignmentStats = {
  enrolled: number;
  submitted: number;
  averagePercent: number | null;
};
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export const passwordSchema = z.string().min(12).max(128);
export const updateAssignmentSchema = createAssignmentSchema.extend({
  version: z.number().int().min(1),
});
export type UpdateAssignment = z.infer<typeof updateAssignmentSchema>;
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const registerSchema = z
  .object({
    email: loginSchema.shape.email,
    name: z.string().trim().min(1).max(100),
    password: passwordSchema,
    invitation: inviteTokenSchema,
  })
  .strict();
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict();
export const createClassSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const createInvitationSchema = z
  .object({
    expiresInHours: z.number().int().min(1).max(168).default(48),
    maxUses: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export const joinClassSchema = z.object({ invitation: inviteTokenSchema }).strict();
export const assignmentQuerySchema = paginationSchema
  .extend({
    classId: uuidSchema.optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .strict();
export type AssignmentQuery = z.infer<typeof assignmentQuerySchema>;
export type ClassMember = { id: string; name: string; email: string };
export type Invitation = {
  id: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
};
export type SubmissionRow = {
  studentId: string;
  name: string;
  email: string;
  removed: boolean;
  submission: Submission | null;
};
