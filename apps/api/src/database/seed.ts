import { hashPassword } from '../auth/password.js';
import { Database } from './database.js';
import { passwordSchema } from '@amp/contracts';

export const ids = {
  teacher: '10000000-0000-4000-8000-000000000001',
  otherTeacher: '10000000-0000-4000-8000-000000000002',
  student: '20000000-0000-4000-8000-000000000001',
  outsider: '20000000-0000-4000-8000-000000000002',
  classroom: '30000000-0000-4000-8000-000000000001',
  otherClassroom: '30000000-0000-4000-8000-000000000002',
};
export async function seed(db: Database) {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seeding requires ALLOW_DEMO_SEED=true outside production.');
  }
  const password = process.env.DEMO_PASSWORD;
  if (!passwordSchema.safeParse(password).success)
    throw new Error('Set DEMO_PASSWORD to 12–128 characters.');
  const hash = await hashPassword(password!);
  await db.transaction(async (tx) => {
    for (const [id, email, name, role] of [
      [ids.teacher, 'teacher@example.test', 'Alex Morgan', 'TEACHER'],
      [ids.otherTeacher, 'other.teacher@example.test', 'Jordan Lee', 'TEACHER'],
      [ids.student, 'student@example.test', 'Sam Chen', 'STUDENT'],
      [ids.outsider, 'other.student@example.test', 'Taylor Kim', 'STUDENT'],
    ]) {
      await tx.query(
        'INSERT INTO users(id,email,name,role,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
        [id, email, name, role, hash],
      );
    }
    await tx.query(
      'INSERT INTO classrooms(id,name,teacher_id) VALUES ($1,$2,$3),($4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [
        ids.classroom,
        'English · Group A',
        ids.teacher,
        ids.otherClassroom,
        'English · Group B',
        ids.otherTeacher,
      ],
    );
    await tx.query(
      'INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING',
      [ids.classroom, ids.student, ids.otherClassroom, ids.outsider],
    );
  });
}
