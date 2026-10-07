import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Actor,
  Assignment,
  CreateAssignment,
  SubmitAssignment,
  UpdateAssignment,
  AssignmentQuery,
} from '@amp/contracts';
import { Database, type Connection } from '../database/database.js';

const projection = `a.id, a.class_id AS "classId", c.name AS "className", a.title, a.description,
  a.status, a.version, a.due_at AS "dueAt", a.created_at AS "createdAt"`;
const submissionProjection = `id, assignment_id AS "assignmentId", score, max_score AS "maxScore", submitted_at AS "submittedAt"`;
type StoredAssignment = Omit<Assignment, 'dueAt' | 'createdAt'> & {
  teacherId: string;
  dueAt: Date;
  createdAt: Date;
} & Record<string, unknown>;
type StoredQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  points: number;
} & Record<string, unknown>;

@Injectable()
export class AssignmentsService {
  constructor(@Inject(Database) private readonly db: Database) {}
  private requireTeacher(actor: Actor) {
    if (actor.role !== 'TEACHER')
      throw new ForbiddenException('Only teachers can manage assignments.');
  }
  private async visible(actor: Actor, id: string, tx: Connection = this.db, lockAudience = false) {
    const [row] = await tx.query<StoredAssignment>(
      `SELECT ${projection}, c.teacher_id AS "teacherId"
      FROM assignments a JOIN classrooms c ON c.id=a.class_id WHERE a.id=$1`,
      [id],
    );
    if (!row) throw new NotFoundException('Assignment not found.');
    if (actor.role === 'TEACHER') {
      if (row.teacherId !== actor.id) throw new NotFoundException('Assignment not found.');
    } else {
      const members = await tx.query(
        `SELECT 1 FROM assignment_recipients WHERE assignment_id=$1 AND student_id=$2 AND removed_at IS NULL${lockAudience ? ' FOR SHARE' : ''}`,
        [id, actor.id],
      );
      if (row.status !== 'PUBLISHED' || !members.length)
        throw new NotFoundException('Assignment not found.');
    }
    return row;
  }
  async classes(actor: Actor) {
    return this.db.query(
      `SELECT c.id,c.name FROM classrooms c WHERE ${
        actor.role === 'TEACHER'
          ? 'c.teacher_id=$1'
          : 'EXISTS (SELECT 1 FROM class_memberships m WHERE m.class_id=c.id AND m.student_id=$1)'
      } ORDER BY c.name,c.id`,
      [actor.id],
    );
  }
  async list(actor: Actor, query: AssignmentQuery) {
    const { page, pageSize } = query;
    const params: unknown[] = [actor.id];
    const conditions = [
      actor.role === 'TEACHER'
        ? 'c.teacher_id=$1'
        : `a.status='PUBLISHED' AND EXISTS (SELECT 1 FROM assignment_recipients r WHERE r.assignment_id=a.id AND r.student_id=$1 AND r.removed_at IS NULL)`,
    ];
    if (query.classId) {
      params.push(query.classId);
      conditions.push(`a.class_id=$${params.length}`);
    }
    if (query.search) {
      params.push(query.search);
      conditions.push(`strpos(lower(a.title),lower($${params.length}))>0`);
    }
    if (query.status === 'DRAFT') conditions.push("a.status='DRAFT'");
    if (query.status === 'PUBLISHED') conditions.push("a.status='PUBLISHED' AND a.due_at>now()");
    if (query.status === 'CLOSED') conditions.push("a.status='PUBLISHED' AND a.due_at<=now()");
    const from = `FROM assignments a JOIN classrooms c ON c.id=a.class_id WHERE ${conditions.join(' AND ')}`;
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const [count] = await tx.query(`SELECT count(*) AS total ${from}`, params);
      const items = await tx.query(
        `SELECT ${projection} ${from} ORDER BY a.created_at DESC,a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      return { items, total: Number(count?.total ?? 0), page, pageSize };
    });
  }
  async detail(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const { teacherId: _teacher, ...assignment } = await this.visible(actor, id, tx);
      const questions = await tx.query<StoredQuestion>(
        `SELECT id,prompt,options,points,correct_index AS "correctIndex" FROM questions WHERE assignment_id=$1 ORDER BY position`,
        [id],
      );
      // Never send answer keys to students, including after submission.
      const visibleQuestions = questions.map((q) =>
        actor.role === 'TEACHER'
          ? q
          : { id: q.id, prompt: q.prompt, options: q.options, points: q.points },
      );
      const submissions =
        actor.role === 'STUDENT'
          ? await tx.query(
              `SELECT ${submissionProjection} FROM submissions WHERE assignment_id=$1 AND student_id=$2`,
              [id, actor.id],
            )
          : [];
      return { ...assignment, questions: visibleQuestions, submission: submissions[0] ?? null };
    });
  }
  async create(actor: Actor, input: CreateAssignment) {
    this.requireTeacher(actor);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      const classes = await tx.query('SELECT 1 FROM classrooms WHERE id=$1 AND teacher_id=$2', [
        input.classId,
        actor.id,
      ]);
      if (!classes.length) throw new NotFoundException('Class not found.');
      const [valid] = await tx.query('SELECT $1::timestamptz > clock_timestamp() AS valid', [
        input.dueAt,
      ]);
      if (!valid?.valid) throw new BadRequestException('Choose a deadline in the future.');
      await tx.query(
        'INSERT INTO assignments(id,class_id,title,description,due_at) VALUES ($1,$2,$3,$4,$5)',
        [id, input.classId, input.title, input.description, input.dueAt],
      );
      for (const [index, q] of input.questions.entries()) {
        await tx.query(
          'INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
          [randomUUID(), id, index, q.prompt, JSON.stringify(q.options), q.correctIndex, q.points],
        );
      }
    });
    return this.detail(actor, id);
  }
  async update(actor: Actor, id: string, input: UpdateAssignment) {
    this.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.visible(actor, id, tx);
      const [locked] = await tx.query(
        'SELECT status,version FROM assignments WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!locked || locked.status !== 'DRAFT' || locked.version !== input.version)
        throw new ConflictException(
          'The draft changed or was published. Reopen it before editing.',
        );
      if (input.classId !== row.classId)
        throw new BadRequestException('The class of an existing draft cannot be changed.');
      const [valid] = await tx.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [
        input.dueAt,
      ]);
      if (!valid?.valid) throw new BadRequestException('Choose a deadline in the future.');
      await tx.query(
        'UPDATE assignments SET title=$2,description=$3,due_at=$4,version=version+1 WHERE id=$1',
        [id, input.title, input.description, input.dueAt],
      );
      await tx.query('DELETE FROM questions WHERE assignment_id=$1', [id]);
      for (const [index, q] of input.questions.entries()) {
        await tx.query(
          'INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
          [randomUUID(), id, index, q.prompt, JSON.stringify(q.options), q.correctIndex, q.points],
        );
      }
    });
    return this.detail(actor, id);
  }
  async remove(actor: Actor, id: string) {
    this.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      await this.visible(actor, id, tx);
      const [locked] = await tx.query('SELECT status FROM assignments WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      if (!locked || locked.status !== 'DRAFT')
        throw new ConflictException('Only drafts can be deleted.');
      await tx.query('DELETE FROM questions WHERE assignment_id=$1', [id]);
      await tx.query('DELETE FROM assignments WHERE id=$1', [id]);
    });
    return { ok: true };
  }
  async publish(actor: Actor, id: string) {
    this.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.visible(actor, id, tx);
      await tx.query('SELECT id FROM classrooms WHERE id=$1 FOR UPDATE', [row.classId]);
      const [locked] = await tx.query('SELECT status FROM assignments WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      if (!locked) throw new NotFoundException('Assignment not found.');
      if (locked.status === 'PUBLISHED') return;
      const updated = await tx.query(
        `UPDATE assignments SET status='PUBLISHED',published_at=clock_timestamp(),version=version+1
        WHERE id=$1 AND due_at>clock_timestamp() AND status='DRAFT' RETURNING id`,
        [id],
      );
      if (!updated.length)
        throw new ConflictException('The deadline has passed. Edit the draft before publishing.');
      await tx.query(
        `INSERT INTO assignment_recipients(assignment_id,student_id)
        SELECT $1,student_id FROM class_memberships WHERE class_id=$2`,
        [id, row.classId],
      );
    });
    return this.detail(actor, id);
  }
  async submit(actor: Actor, id: string, input: SubmitAssignment) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('Only students can submit answers.');
    const answers = [...input.answers].sort((a, b) => a.questionId.localeCompare(b.questionId));
    const hash = createHash('sha256')
      .update(JSON.stringify({ assignmentId: id, answers }))
      .digest('hex');
    return this.db.transaction(async (tx) => {
      await this.visible(actor, id, tx, true);
      const replay = async () => {
        const [existing] = await tx.query(
          `SELECT ${submissionProjection},request_hash FROM submissions WHERE student_id=$1 AND request_id=$2`,
          [actor.id, input.requestId],
        );
        if (!existing) return null;
        if (existing.request_hash !== hash)
          throw new ConflictException('This request ID was already used for different answers.');
        const { request_hash: _, ...result } = existing;
        return result;
      };
      const previous = await replay();
      if (previous) return previous;
      const questions = await tx.query<StoredQuestion>(
        `SELECT id,options,points,correct_index AS "correctIndex" FROM questions WHERE assignment_id=$1`,
        [id],
      );
      if (
        questions.length !== answers.length ||
        questions.some(
          (q) => !answers.some((a) => a.questionId === q.id && a.selectedIndex < q.options.length),
        )
      ) {
        throw new BadRequestException('Submit one valid answer for every question.');
      }
      const maxScore = questions.reduce((sum, q) => sum + q.points, 0);
      const score = questions.reduce(
        (sum, q) =>
          sum +
          (answers.find((a) => a.questionId === q.id)?.selectedIndex === q.correctIndex
            ? q.points
            : 0),
        0,
      );
      // The deadline check is performed by the database at insertion time, not by the client.
      // Unique constraints arbitrate concurrent submissions; the transaction keeps grading and saving atomic.
      const [saved] = await tx.query(
        `INSERT INTO submissions(id,assignment_id,student_id,request_id,request_hash,answers,score,max_score)
        SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,$8 FROM assignments WHERE id=$2 AND status='PUBLISHED' AND due_at>clock_timestamp()
        ON CONFLICT DO NOTHING RETURNING ${submissionProjection}`,
        [
          randomUUID(),
          id,
          actor.id,
          input.requestId,
          hash,
          JSON.stringify(answers),
          score,
          maxScore,
        ],
      );
      if (saved) return saved;
      const repeated = await replay();
      if (repeated) return repeated;
      throw new ConflictException('Already submitted, or the assignment deadline has passed.');
    });
  }
  async stats(actor: Actor, id: string) {
    this.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const row = await this.visible(actor, id, tx);
      const [stats] = await tx.query(
        `SELECT
      (SELECT count(*) FROM ${row.status === 'DRAFT' ? 'class_memberships WHERE class_id=$2' : 'assignment_recipients WHERE assignment_id=$1'}) AS enrolled,
      count(*) AS submitted,round(avg(score::numeric/max_score*100),1) AS average
      FROM submissions WHERE assignment_id=$1 AND $2::uuid IS NOT NULL`,
        [id, row.classId],
      );
      return {
        enrolled: Number(stats?.enrolled ?? 0),
        submitted: Number(stats?.submitted ?? 0),
        averagePercent: stats?.average == null ? null : Number(stats.average),
      };
    });
  }
  async submissions(actor: Actor, id: string, page: number, pageSize: number) {
    this.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const row = await this.visible(actor, id, tx);
      const audience =
        row.status === 'DRAFT'
          ? 'SELECT student_id,NULL::timestamptz AS removed_at FROM class_memberships WHERE class_id=$2'
          : 'SELECT student_id,removed_at FROM assignment_recipients WHERE assignment_id=$1';
      const params = [id, row.classId];
      const [count] = await tx.query(
        `SELECT count(*) AS total FROM (${audience}) r WHERE $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL`,
        params,
      );
      const items = await tx.query(
        `SELECT u.id AS "studentId",u.name,u.email,r.removed_at IS NOT NULL AS removed,
        CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'assignmentId',s.assignment_id,'score',s.score,'maxScore',s.max_score,'submittedAt',s.submitted_at) END AS submission
        FROM (${audience}) r JOIN users u ON u.id=r.student_id
        LEFT JOIN submissions s ON s.assignment_id=$1 AND s.student_id=r.student_id WHERE $2::uuid IS NOT NULL
        ORDER BY u.name,u.id LIMIT $3 OFFSET $4`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      return { items, total: Number(count?.total ?? 0), page, pageSize };
    });
  }
}
