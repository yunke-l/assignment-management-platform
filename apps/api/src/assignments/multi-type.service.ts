import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  type Actor,
  type QuestionV2,
  type CreateAssignmentV2,
  type UpdateAssignmentV2,
  type SubmitAssignmentV2,
  type GradingDraft,
  type GradingPublish,
  type AnswerV2,
  questionV2Schema,
  contentText,
  allQuestionContents,
  contentAssets,
  mediaLimits,
  publicQuestion,
  validateQuestions,
  validateAnswers,
  gradeAnswers,
  canonicalSubmission,
  publishAssignmentV2Schema,
  sameIdSet,
  type ValidationProblem,
} from '@amp/contracts';
import { Database, type Connection } from '../database/database.js';
import { AssignmentsService } from './assignments.service.js';
import { prepareOrdering } from './question-storage.js';

const resultProjection = `id,assignment_id AS "assignmentId",student_id AS "studentId",submitted_at AS "submittedAt",
 published_version AS "publishedVersion",grading_status AS "gradingStatus",objective_score AS "objectiveScore",
 objective_max_score AS "objectiveMaxScore",score,max_score AS "maxScore",grading_version AS "gradingVersion",
 published_grading_version AS "publishedGradingVersion",graded_at AS "gradedAt"`;
type AssetRow = {
  id: string;
  owner_id: string;
  assignment_id: string;
  question_id: string | null;
  purpose: 'TEACHING' | 'ANSWER';
  status: string;
  kind: 'image' | 'audio';
  declared_bytes: string | number;
  actual_bytes: string | number | null;
} & Record<string, unknown>;
type StoredSubmission = {
  id: string;
  assignmentId: string;
  studentId: string;
  gradingStatus: string;
  objectiveScore: number;
  objectiveMaxScore: number;
  maxScore: number;
  score: number | null;
  gradingVersion: number;
  publishedGradingVersion: number;
  answers_v2: AnswerV2[];
  request_hash: string;
} & Record<string, unknown>;

@Injectable()
export class MultiTypeService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AssignmentsService) private readonly legacy: AssignmentsService,
  ) {}

  async questions(tx: Connection, assignmentId: string): Promise<QuestionV2[]> {
    const rows = await tx.query<{ definition: unknown }>(
      'SELECT definition FROM questions WHERE assignment_id=$1 ORDER BY position,id',
      [assignmentId],
    );
    return rows.map((row) => questionV2Schema.parse(row.definition));
  }
  private result(row: Record<string, unknown>, teacher: boolean) {
    const { publishedGradingVersion, answers_v2: _answers, request_hash: _hash, ...view } = row;
    return { ...view, gradingVersion: teacher ? row.gradingVersion : publishedGradingVersion };
  }
  async detail(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const { teacherId: _teacher, ...assignment } = await this.legacy.visible(actor, id, tx);
      const [meta] = await tx.query('SELECT published_version FROM assignments WHERE id=$1', [id]);
      const questions = await this.questions(tx, id);
      const submissions =
        actor.role === 'STUDENT'
          ? await tx.query(
              `SELECT ${resultProjection} FROM submissions WHERE assignment_id=$1 AND student_id=$2`,
              [id, actor.id],
            )
          : [];
      return {
        ...assignment,
        schemaVersion: 2,
        publishedVersion: meta!.published_version,
        questions: actor.role === 'TEACHER' ? questions : questions.map(publicQuestion),
        submission: submissions[0] ? this.result(submissions[0], false) : null,
      };
    });
  }
  private async future(tx: Connection, dueAt: string) {
    const [row] = await tx.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [dueAt]);
    if (!row?.valid) throw new BadRequestException('Choose a deadline in the future.');
  }
  private async teachingAssets(
    actor: Actor,
    assignmentId: string,
    questions: QuestionV2[],
    tx: Connection,
    ready: boolean,
    lock = true,
  ) {
    const media = questions.flatMap((q) => allQuestionContents(q).flatMap(contentAssets));
    const ids = [...new Set(media.map((block) => block.assetId))].sort();
    if (!ids.length) return;
    const assets = await tx.query<AssetRow>(
      `SELECT * FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id${lock ? ' FOR SHARE' : ''}`,
      [ids],
    );
    if (
      assets.length !== ids.length ||
      assets.some(
        (a) =>
          a.owner_id !== actor.id || a.assignment_id !== assignmentId || a.purpose !== 'TEACHING',
      )
    )
      throw new BadRequestException('Use teaching resources belonging to this assignment.');
    if (
      assets.some((a) =>
        ready ? a.status !== 'READY' : !['UPLOADING', 'PROCESSING', 'READY'].includes(a.status),
      )
    )
      throw new ConflictException(
        ready
          ? 'Wait for all teaching files to finish processing before publishing.'
          : 'A teaching file has failed or was removed. Replace it before saving.',
      );
    if (media.some((block) => assets.find((a) => a.id === block.assetId)?.kind !== block.type))
      throw new BadRequestException('The media block type must match its uploaded file.');
    if (
      assets.length > mediaLimits.teachingFiles ||
      assets.reduce((sum, a) => sum + Number(a.actual_bytes ?? a.declared_bytes), 0) >
        mediaLimits.teachingBytes
    )
      throw new BadRequestException('Teaching resources exceed 100 files or 300 MiB.');
  }
  private async saveQuestions(tx: Connection, assignmentId: string, questions: QuestionV2[]) {
    const ids = questions.map((q) => q.id);
    await tx.query('DELETE FROM questions WHERE assignment_id=$1 AND NOT(id=ANY($2::uuid[]))', [
      assignmentId,
      ids,
    ]);
    // Parent foreign keys are deferred so moves and sibling reordering remain atomic.
    // Temporary disjoint positions prevent the sibling unique index from rejecting swaps.
    await tx.query('UPDATE questions SET position=position+10000 WHERE assignment_id=$1', [
      assignmentId,
    ]);
    for (const q of questions) {
      const options =
        q.type === 'SINGLE_CHOICE' && q.config.options.length >= 2
          ? q.config.options.map((o) => contentText(o.content))
          : null;
      const correct =
        q.type === 'SINGLE_CHOICE' && options && q.answerKey.correctOptionId !== null
          ? q.config.options.findIndex((o) => o.id === q.answerKey.correctOptionId)
          : null;
      const saved = await tx.query(
        `INSERT INTO questions(id,assignment_id,parent_id,position,prompt,options,correct_index,points,question_type,definition)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)
         ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id,position=EXCLUDED.position,prompt=EXCLUDED.prompt,
         options=EXCLUDED.options,correct_index=EXCLUDED.correct_index,points=EXCLUDED.points,question_type=EXCLUDED.question_type,definition=EXCLUDED.definition
         WHERE questions.assignment_id=EXCLUDED.assignment_id RETURNING id`,
        [
          q.id,
          assignmentId,
          q.parentId,
          q.position,
          contentText(q.prompt),
          options === null ? null : JSON.stringify(options),
          correct,
          q.points,
          q.type,
          JSON.stringify(q),
        ],
      );
      if (!saved.length)
        throw new BadRequestException('A question identifier belongs to another assignment.');
    }
    await tx.query(
      `UPDATE assets SET detached_at=clock_timestamp() WHERE id IN (
      SELECT asset_id FROM asset_references WHERE reference_type='DRAFT' AND reference_id=$1)
      AND id<>ALL($2::uuid[])`,
      [
        assignmentId,
        [
          ...new Set(
            questions.flatMap((q) =>
              allQuestionContents(q)
                .flatMap(contentAssets)
                .map((m) => m.assetId),
            ),
          ),
        ],
      ],
    );
    await tx.query(
      "DELETE FROM asset_references WHERE reference_type='DRAFT' AND reference_id=$1",
      [assignmentId],
    );
    for (const q of questions)
      for (const contents of allQuestionContents(q))
        for (const block of contentAssets(contents)) {
          await tx.query(
            "INSERT INTO asset_references(asset_id,reference_type,reference_id,location_id,is_private) VALUES ($1,'DRAFT',$2,$3,$4)",
            [
              block.assetId,
              assignmentId,
              block.id,
              q.type === 'RESPONSE' && contents === q.answerKey.referenceContent,
            ],
          );
          await tx.query('UPDATE assets SET detached_at=NULL WHERE id=$1', [block.assetId]);
        }
  }
  async create(actor: Actor, input: CreateAssignmentV2) {
    this.legacy.requireTeacher(actor);
    const id = randomUUID();
    const questions = prepareOrdering(input.questions);
    await this.db.transaction(async (tx) => {
      const classes = await tx.query('SELECT 1 FROM classrooms WHERE id=$1 AND teacher_id=$2', [
        input.classId,
        actor.id,
      ]);
      if (!classes.length) throw new NotFoundException('Class not found.');
      await this.future(tx, input.dueAt);
      await tx.query(
        'INSERT INTO assignments(id,class_id,title,description,due_at,schema_version) VALUES ($1,$2,$3,$4,$5,2)',
        [id, input.classId, input.title.trim(), input.description, input.dueAt],
      );
      await this.teachingAssets(actor, id, questions, tx, false);
      await this.saveQuestions(tx, id, questions);
    });
    return this.detail(actor, id);
  }
  async update(actor: Actor, id: string, input: UpdateAssignmentV2) {
    this.legacy.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.legacy.visible(actor, id, tx);
      const [locked] = await tx.query(
        'SELECT status,version FROM assignments WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (locked!.status !== 'DRAFT' || locked!.version !== input.version)
        throw new ConflictException('The draft changed or was published. Reload it before saving.');
      if (row.classId !== input.classId)
        throw new BadRequestException('The class of an existing draft cannot be changed.');
      await this.future(tx, input.dueAt);
      const questions = prepareOrdering(input.questions, await this.questions(tx, id));
      await this.teachingAssets(actor, id, questions, tx, false);
      await this.saveQuestions(tx, id, questions);
      await tx.query(
        'UPDATE assignments SET title=$2,description=$3,due_at=$4,schema_version=2,version=version+1 WHERE id=$1',
        [id, input.title.trim(), input.description, input.dueAt],
      );
    });
    return this.detail(actor, id);
  }
  async remove(actor: Actor, id: string) {
    this.legacy.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      await this.legacy.visible(actor, id, tx);
      const [locked] = await tx.query('SELECT status FROM assignments WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      if (locked!.status !== 'DRAFT') throw new ConflictException('Only drafts can be deleted.');
      await tx.query(
        "UPDATE assets SET detached_at=clock_timestamp() WHERE id IN (SELECT asset_id FROM asset_references WHERE reference_type='DRAFT' AND reference_id=$1)",
        [id],
      );
      await tx.query(
        "DELETE FROM asset_references WHERE reference_type='DRAFT' AND reference_id=$1",
        [id],
      );
      await tx.query('DELETE FROM questions WHERE assignment_id=$1', [id]);
      await tx.query('DELETE FROM assignments WHERE id=$1', [id]);
    });
    return { ok: true };
  }
  private publicationProblems(questions: QuestionV2[]): ValidationProblem[] {
    const errors = validateQuestions(questions);
    for (const q of questions)
      if (
        q.type === 'ORDERING' &&
        !sameIdSet(
          q.config.initialOrder,
          q.config.items.map((item) => item.id),
        )
      )
        errors.push({
          questionId: q.id,
          path: 'answerKey.orders',
          code: 'INVALID_QUESTION',
          message: 'At least one complete ordering must be incorrect. Rewrite this ordering task.',
        });
    return errors;
  }
  async validate(actor: Actor, id: string, version: number, snapshot?: QuestionV2[]) {
    this.legacy.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const row = await this.legacy.visible(actor, id, tx);
      if (row.version !== version)
        throw new ConflictException('The draft changed. Reload before checking it.');
      const saved = await this.questions(tx, id);
      const questions = snapshot ? prepareOrdering(snapshot, saved) : saved;
      const errors = this.publicationProblems(questions);
      // Validation is advisory. The final publication repeats this while locking resources.
      try {
        await this.teachingAssets(actor, id, questions, tx, true, false);
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof ConflictException))
          throw error;
        errors.push({ path: 'assets', code: 'RESOURCE_NOT_READY', message: error.message });
      }
      return { valid: errors.length === 0, version: row.version, errors };
    });
  }
  async publish(actor: Actor, id: string, body: unknown) {
    this.legacy.requireTeacher(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.legacy.visible(actor, id, tx);
      await tx.query('SELECT id FROM classrooms WHERE id=$1 FOR UPDATE', [row.classId]);
      const [locked] = await tx.query(
        'SELECT status,version FROM assignments WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (locked!.status === 'PUBLISHED') return;
      const parsed = publishAssignmentV2Schema.safeParse(body);
      if (!parsed.success)
        throw new ConflictException('Refresh the editor and publish with its current version.');
      if (locked!.version !== parsed.data.version)
        throw new ConflictException(
          'The draft changed. Preview the latest version before publishing.',
        );
      const questions = await this.questions(tx, id);
      const errors = this.publicationProblems(questions);
      if (errors.length)
        throw new BadRequestException({
          message: 'Complete the highlighted questions before publishing.',
          code: 'PUBLICATION_INVALID',
          errors,
        });
      await this.teachingAssets(actor, id, questions, tx, true);
      const saved = await tx.query(
        `UPDATE assignments SET status='PUBLISHED',published_at=clock_timestamp(),version=version+1,published_version=version+1
        WHERE id=$1 AND due_at>clock_timestamp() RETURNING id`,
        [id],
      );
      if (!saved.length)
        throw new ConflictException('The deadline has passed. Edit the draft first.');
      await tx.query(
        "UPDATE asset_references SET reference_type='PUBLISHED' WHERE reference_type='DRAFT' AND reference_id=$1",
        [id],
      );
      await tx.query(
        'INSERT INTO assignment_recipients(assignment_id,student_id) SELECT $1,student_id FROM class_memberships WHERE class_id=$2',
        [id, row.classId],
      );
    });
    return this.detail(actor, id);
  }
  private async answerAssets(
    actor: Actor,
    assignmentId: string,
    questions: QuestionV2[],
    answers: AnswerV2[],
    tx: Connection,
  ) {
    const ids = [
      ...new Set(
        answers.flatMap((a) => [
          ...a.evidenceAssetIds,
          ...(a.type === 'RESPONSE' ? a.payload.assetIds : []),
        ]),
      ),
    ].sort();
    const assets = ids.length
      ? await tx.query<AssetRow>(
          'SELECT * FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
          [ids],
        )
      : [];
    if (
      assets.length !== ids.length ||
      assets.some(
        (a) =>
          a.owner_id !== actor.id || a.assignment_id !== assignmentId || a.purpose !== 'ANSWER',
      )
    )
      throw new BadRequestException('Use your own answer files from this assignment.');
    if (assets.some((a) => a.status !== 'READY'))
      throw new ConflictException('Wait for all answer files to finish processing.');
    if (
      assets.length > mediaLimits.answerFiles ||
      assets.reduce((sum, a) => sum + Number(a.actual_bytes), 0) > mediaLimits.answerBytes
    )
      throw new BadRequestException(
        'Final answers exceed 30 files or 100 MiB. Remove optional attachments.',
      );
    for (const a of answers) {
      const own = assets.filter((asset) =>
        [...a.evidenceAssetIds, ...(a.type === 'RESPONSE' ? a.payload.assetIds : [])].includes(
          asset.id,
        ),
      );
      if (own.some((asset) => asset.question_id !== a.questionId))
        throw new BadRequestException('An answer file belongs to a different question.');
      const images = own.filter((asset) => asset.kind === 'image'),
        audios = own.filter((asset) => asset.kind === 'audio');
      const q = questions.find((item) => item.id === a.questionId)!;
      if (q.type === 'RESPONSE') {
        const c = q.config;
        if (
          images.length < c.minImages ||
          images.length > c.maxImages ||
          audios.length < c.minAudios ||
          audios.length > c.maxAudios
        )
          throw new BadRequestException(
            'Answer attachments do not meet the required image and audio counts.',
          );
        if (
          images.some((asset) => Number(asset.actual_bytes) > c.maxImageBytes) ||
          audios.some((asset) => Number(asset.actual_bytes) > c.maxAudioBytes)
        )
          throw new BadRequestException('An answer file exceeds this question’s size limit.');
      } else if (images.length > 3 || audios.length > 1)
        throw new BadRequestException(
          'Supplementary evidence allows at most 3 images and 1 audio file.',
        );
    }
    return assets;
  }
  async submit(actor: Actor, id: string, input: SubmitAssignmentV2) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('Only students can submit answers.');
    const hash = createHash('sha256').update(canonicalSubmission(id, input)).digest('hex');
    return this.db.transaction(async (tx) => {
      await this.legacy.visible(actor, id, tx, true);
      const replay = async () => {
        const [previous] = await tx.query(
          `SELECT ${resultProjection},request_hash FROM submissions WHERE student_id=$1 AND request_id=$2`,
          [actor.id, input.requestId],
        );
        if (!previous) return null;
        if (previous.request_hash !== hash)
          throw new ConflictException('This request ID was already used for different answers.');
        return this.result(previous, false);
      };
      const previous = await replay();
      if (previous) return previous;
      const [meta] = await tx.query('SELECT published_version FROM assignments WHERE id=$1', [id]);
      if (meta!.published_version !== input.publishedVersion)
        throw new ConflictException('The published assignment version does not match. Reload it.');
      const questions = await this.questions(tx, id);
      const errors = validateAnswers(questions, input.answers);
      if (errors.length)
        throw new BadRequestException({
          message: 'Complete every answer with valid input.',
          code: 'ANSWERS_INVALID',
          errors,
        });
      await this.answerAssets(actor, id, questions, input.answers, tx);
      const grade = gradeAnswers(questions, input.answers);
      const [saved] = await tx.query(
        `INSERT INTO submissions(id,assignment_id,student_id,request_id,request_hash,answers,answers_v2,
        schema_version,published_version,grading_status,objective_score,objective_max_score,score,max_score,graded_at)
        SELECT $1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,2,$7,$8,$9,$10,$11,$12,
        CASE WHEN $8='GRADED' THEN clock_timestamp() ELSE NULL END FROM assignments
        WHERE id=$2 AND status='PUBLISHED' AND due_at>clock_timestamp()
        ON CONFLICT DO NOTHING RETURNING ${resultProjection}`,
        [
          randomUUID(),
          id,
          actor.id,
          input.requestId,
          hash,
          JSON.stringify(input.answers),
          input.publishedVersion,
          grade.gradingStatus,
          grade.objectiveScore,
          grade.objectiveMaxScore,
          grade.score,
          grade.maxScore,
        ],
      );
      if (!saved) {
        const repeated = await replay();
        if (repeated) return repeated;
        throw new ConflictException('Already submitted, or the assignment deadline has passed.');
      }
      for (const result of grade.results) {
        const a = input.answers.find((answer) => answer.questionId === result.questionId)!;
        await tx.query(
          'INSERT INTO answer_results(submission_id,question_id,question_type,answer_payload,score,max_score,units) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)',
          [
            saved.id,
            result.questionId,
            result.type,
            JSON.stringify(a.payload),
            result.score,
            result.maxScore,
            JSON.stringify(result.units),
          ],
        );
        for (const assetId of [
          ...a.evidenceAssetIds,
          ...(a.type === 'RESPONSE' ? a.payload.assetIds : []),
        ])
          await tx.query(
            "INSERT INTO asset_references(asset_id,reference_type,reference_id,location_id) VALUES ($1,'ANSWER',$2,$3)",
            [assetId, saved.id, a.questionId],
          );
      }
      return this.result(saved, false);
    });
  }
  async submissionDetail(actor: Actor, assignmentId: string, submissionId: string) {
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await this.legacy.visible(actor, assignmentId, tx);
      const [submission] = await tx.query<StoredSubmission>(
        `SELECT ${resultProjection},answers_v2 FROM submissions WHERE id=$1 AND assignment_id=$2`,
        [submissionId, assignmentId],
      );
      if (!submission || (actor.role === 'STUDENT' && submission.studentId !== actor.id))
        throw new NotFoundException('Submission not found.');
      const teacher = actor.role === 'TEACHER';
      const results = await tx.query(
        'SELECT question_id AS "questionId",question_type AS type,answer_payload AS payload,score,max_score AS "maxScore",units,feedback FROM answer_results WHERE submission_id=$1 ORDER BY question_id',
        [submissionId],
      );
      const drafts = teacher
        ? await tx.query('SELECT data FROM grading_drafts WHERE submission_id=$1', [submissionId])
        : [];
      const revisions = teacher
        ? await tx.query(
            'SELECT version,score,max_score AS "maxScore",reason,data,created_at AS "createdAt" FROM grading_revisions WHERE submission_id=$1 ORDER BY version DESC',
            [submissionId],
          )
        : [];
      return {
        ...this.result(submission, teacher),
        answers: submission.answers_v2,
        results: teacher
          ? results
          : results.map((row) => ({
              questionId: row.questionId,
              type: row.type,
              payload: row.payload,
              feedback: row.feedback,
            })),
        ...(teacher ? { gradingDraft: drafts[0]?.data ?? [], gradingRevisions: revisions } : {}),
      };
    });
  }
  private async gradeContext(actor: Actor, submissionId: string, tx: Connection) {
    this.legacy.requireTeacher(actor);
    const [lookup] = await tx.query('SELECT assignment_id FROM submissions WHERE id=$1', [
      submissionId,
    ]);
    if (!lookup) throw new NotFoundException('Submission not found.');
    const assignmentId = String(lookup.assignment_id);
    await this.legacy.visible(actor, assignmentId, tx);
    const [submission] = await tx.query<StoredSubmission>(
      `SELECT ${resultProjection},answers_v2 FROM submissions WHERE id=$1 FOR UPDATE`,
      [submissionId],
    );
    const manual = (await this.questions(tx, assignmentId)).filter((q) => q.type === 'RESPONSE');
    if (!manual.length)
      throw new BadRequestException('This submission has no manually graded questions.');
    return { submission: submission!, manual };
  }
  private checkGrading(manual: QuestionV2[], draft: GradingDraft['answers'], complete: boolean) {
    const ids = draft.map((a) => a.questionId);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !manual.some((q) => q.id === id)) ||
      (complete &&
        !sameIdSet(
          ids,
          manual.map((q) => q.id),
        ))
    )
      throw new BadRequestException('Grade each manual question exactly once before publishing.');
    for (const a of draft) {
      const q = manual.find((question) => question.id === a.questionId)!;
      if (q.type !== 'RESPONSE') throw new BadRequestException('Grade only manual questions.');
      const dimensions = a.dimensions.map((d) => d.dimensionId);
      if (
        new Set(dimensions).size !== dimensions.length ||
        dimensions.some((id) => !q.config.rubric.some((d) => d.id === id)) ||
        (complete &&
          !sameIdSet(
            dimensions,
            q.config.rubric.map((d) => d.id),
          ))
      )
        throw new BadRequestException('Grade every rubric dimension before publishing.');
      if (
        a.dimensions.some(
          (d) => d.score > q.config.rubric.find((r) => r.id === d.dimensionId)!.points,
        )
      )
        throw new BadRequestException('A rubric score exceeds its maximum.');
    }
  }
  async saveGrading(actor: Actor, submissionId: string, input: GradingDraft) {
    return this.db.transaction(async (tx) => {
      const { submission, manual } = await this.gradeContext(actor, submissionId, tx);
      if (submission.gradingVersion !== input.gradingVersion)
        throw new ConflictException('The grading draft changed. Reload before saving.');
      this.checkGrading(manual, input.answers, false);
      await tx.query(
        `INSERT INTO grading_drafts(submission_id,teacher_id,data) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT(submission_id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id,data=EXCLUDED.data,updated_at=clock_timestamp()`,
        [submissionId, actor.id, JSON.stringify(input.answers)],
      );
      const [saved] = await tx.query(
        `UPDATE submissions SET grading_version=grading_version+1 WHERE id=$1 RETURNING ${resultProjection}`,
        [submissionId],
      );
      return { ...this.result(saved!, true), gradingDraft: input.answers };
    });
  }
  async publishGrading(actor: Actor, submissionId: string, input: GradingPublish) {
    this.legacy.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
      const { submission, manual } = await this.gradeContext(actor, submissionId, tx);
      const [existing] = await tx.query(
        'SELECT * FROM grading_revisions WHERE teacher_id=$1 AND request_id=$2',
        [actor.id, input.requestId],
      );
      if (existing) {
        const hash = createHash('sha256')
          .update(
            JSON.stringify({
              submissionId,
              gradingVersion: input.gradingVersion,
              reason: input.reason,
            }),
          )
          .digest('hex');
        if (existing.request_hash !== hash)
          throw new ConflictException('This grading request ID was used for different content.');
        return {
          submissionId,
          gradingVersion: existing.version,
          score: existing.score,
          maxScore: existing.max_score,
          gradedAt: existing.created_at,
        };
      }
      if (submission.gradingVersion !== input.gradingVersion)
        throw new ConflictException('The grading draft changed. Reload before publishing.');
      if (submission.gradingStatus === 'GRADED' && !input.reason.trim())
        throw new BadRequestException('Explain why the published grade is being changed.');
      const [row] = await tx.query<{ data: GradingDraft['answers'] }>(
        'SELECT data FROM grading_drafts WHERE submission_id=$1',
        [submissionId],
      );
      if (!row) throw new BadRequestException('Save the grading draft before publishing.');
      this.checkGrading(manual, row.data, true);
      const score =
        submission.objectiveScore +
        row.data.reduce((sum, a) => sum + a.dimensions.reduce((total, d) => total + d.score, 0), 0);
      const version = submission.gradingVersion + 1;
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            submissionId,
            gradingVersion: input.gradingVersion,
            reason: input.reason,
          }),
        )
        .digest('hex');
      // The locked version uniquely identifies the immutable saved draft being published.
      await tx.query(
        'INSERT INTO grading_revisions(id,submission_id,teacher_id,version,request_id,request_hash,data,score,max_score,reason) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',
        [
          randomUUID(),
          submissionId,
          actor.id,
          version,
          input.requestId,
          hash,
          JSON.stringify(row.data),
          score,
          submission.maxScore,
          input.reason,
        ],
      );
      for (const a of row.data)
        await tx.query(
          'UPDATE answer_results SET score=$3,feedback=$4 WHERE submission_id=$1 AND question_id=$2',
          [
            submissionId,
            a.questionId,
            a.dimensions.reduce((sum, d) => sum + d.score, 0),
            a.feedback,
          ],
        );
      const [saved] = await tx.query(
        `UPDATE submissions SET score=$2,grading_status='GRADED',graded_at=clock_timestamp(),grading_version=$3,published_grading_version=$3 WHERE id=$1 RETURNING ${resultProjection}`,
        [submissionId, score, version],
      );
      return {
        submissionId,
        gradingVersion: version,
        score,
        maxScore: submission.maxScore,
        gradedAt: saved!.gradedAt,
      };
    });
  }
  async stats(actor: Actor, id: string) {
    this.legacy.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const row = await this.legacy.visible(actor, id, tx);
      const [counts] = await tx.query(
        `SELECT count(*) AS submitted,
        count(*) FILTER (WHERE grading_status='GRADED') AS graded,
        count(*) FILTER (WHERE grading_status='PENDING_REVIEW') AS pending,
        round(avg(score::numeric/max_score*100) FILTER(WHERE grading_status='GRADED'),1) AS average
        FROM submissions WHERE assignment_id=$1`,
        [id],
      );
      const [audience] = await tx.query(
        row.status === 'DRAFT'
          ? 'SELECT count(*) AS enrolled FROM class_memberships WHERE class_id=$1'
          : 'SELECT count(*) AS enrolled FROM assignment_recipients WHERE assignment_id=$1',
        [row.status === 'DRAFT' ? row.classId : id],
      );
      return {
        enrolled: Number(audience!.enrolled),
        submitted: Number(counts!.submitted),
        gradedCount: Number(counts!.graded),
        pendingReviewCount: Number(counts!.pending),
        averagePercent: counts!.average === null ? null : Number(counts!.average),
      };
    });
  }
  async submissions(actor: Actor, id: string, page: number, pageSize: number, status?: string) {
    this.legacy.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const row = await this.legacy.visible(actor, id, tx);
      const audience =
        row.status === 'DRAFT'
          ? 'SELECT student_id,NULL::timestamptz AS removed_at FROM class_memberships WHERE class_id=$2'
          : 'SELECT student_id,removed_at FROM assignment_recipients WHERE assignment_id=$1';
      const source = `FROM (${audience}) r JOIN users u ON u.id=r.student_id LEFT JOIN submissions s ON s.assignment_id=$1 AND s.student_id=r.student_id WHERE $2::uuid IS NOT NULL AND ($3::text IS NULL OR s.grading_status=$3)`;
      const [count] = await tx.query(`SELECT count(*) AS total ${source}`, [
        id,
        row.classId,
        status ?? null,
      ]);
      const items = await tx.query(
        `SELECT u.id AS "studentId",u.name,u.email,r.removed_at IS NOT NULL AS removed,
        CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'assignmentId',s.assignment_id,'studentId',s.student_id,
        'gradingStatus',s.grading_status,'gradingVersion',s.grading_version,'score',s.score,'maxScore',s.max_score,
        'objectiveScore',s.objective_score,'objectiveMaxScore',s.objective_max_score,'submittedAt',s.submitted_at,'gradedAt',s.graded_at) END AS submission
        ${source} ORDER BY u.name,u.id LIMIT $4 OFFSET $5`,
        [id, row.classId, status ?? null, pageSize, (page - 1) * pageSize],
      );
      return { items, total: Number(count!.total), page, pageSize };
    });
  }
  async questionStats(actor: Actor, id: string) {
    this.legacy.requireTeacher(actor);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await this.legacy.visible(actor, id, tx);
      const questions = await this.questions(tx, id);
      const results = await tx.query<{
        question_id: string;
        score: number | null;
        max_score: number;
        units: { unitId: string; correct: boolean }[];
      }>(
        'SELECT r.question_id,r.score,r.max_score,r.units FROM answer_results r JOIN submissions s ON s.id=r.submission_id WHERE s.assignment_id=$1',
        [id],
      );
      return {
        items: questions
          .filter((q) => q.type !== 'COMPOSITE')
          .map((q) => {
            const rows = results.filter((r) => r.question_id === q.id);
            const graded = rows.filter((r) => r.score !== null);
            const unitIds =
              q.type === 'FILL_BLANK' || q.type === 'CLOZE_CHOICE'
                ? q.config.blanks.map((b) => b.id)
                : q.type === 'GROUPING'
                  ? q.config.items.map((item) => item.id)
                  : q.type === 'MATCHING'
                    ? q.config.left.map((item) => item.id)
                    : [q.id];
            return {
              questionId: q.id,
              type: q.type,
              submitted: rows.length,
              graded: graded.length,
              averageScore: graded.length
                ? graded.reduce((sum, r) => sum + r.score!, 0) / graded.length
                : null,
              units:
                q.type === 'RESPONSE'
                  ? []
                  : unitIds.map((unitId) => ({
                      unitId,
                      correctPercent: rows.length
                        ? (rows.filter((r) => r.units.some((u) => u.unitId === unitId && u.correct))
                            .length /
                            rows.length) *
                          100
                        : null,
                    })),
            };
          }),
      };
    });
  }
}
