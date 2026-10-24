import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { type Actor, createAssignmentV2Schema, submissionV2Schema } from '@amp/contracts';
import { Database } from './database.js';
import { ids, seed } from './seed.js';
import { hashPassword } from '../auth/password.js';
import { AssignmentsService } from '../assignments/assignments.service.js';
import { MultiTypeService } from '../assignments/multi-type.service.js';
import { AssetsService } from '../assets/assets.service.js';
import { ClassesService } from '../classes/classes.js';
import { digest } from '../auth/session.js';
import { showcaseAnswers, showcaseQuestions } from './showcase-content.js';
import { expandShowcaseComposites } from './showcase-composites.js';

// Stable identifiers scope repeat runs to this synthetic dataset. Existing user work is preserved.
const key = (value: string) => {
  const h = createHash('sha256').update(`classwork-showcase-v1:${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const names = [
  'Sam Chen',
  'Mia Patel',
  'Noah Williams',
  'Emma Wilson',
  'Liam Nguyen',
  'Olivia Garcia',
  'Ethan Brown',
  'Ava Singh',
  'Lucas Martin',
  'Sophia Wang',
  'Leo Thompson',
  'Isabella Clark',
  'Taylor Kim',
  'Amelia Davis',
  'Oliver Anderson',
  'Charlotte Li',
  'James Robinson',
  'Harper Lewis',
  'Benjamin Hall',
  'Evelyn Young',
  'Henry Allen',
  'Abigail Scott',
  'Daniel Green',
  'Chloe Adams',
];
const transcript =
  'Welcome to the school gardening club. We meet every Wednesday at three thirty, behind the library. Members plant seeds, water vegetables, and learn how to reduce food waste. Please bring a reusable water bottle. New members are always welcome.';
const DAY = 86_400_000;

export async function seedShowcase(db: Database) {
  await seed(db); // Includes the explicit development-only and password guards.
  const hash = await hashPassword(process.env.DEMO_PASSWORD!);
  const legacy = new AssignmentsService(db);
  const multi = new MultiTypeService(db, legacy);
  const assets = new AssetsService(db, legacy);
  const classes = new ClassesService(db);
  const students: Actor[] = names.map((name, i) => ({
    id: i === 0 ? ids.student : i === 12 ? ids.outsider : key(`student:${i}`),
    name,
    email:
      i === 0
        ? 'student@example.test'
        : i === 12
          ? 'other.student@example.test'
          : `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
    role: 'STUDENT',
  }));
  const teachers: Actor[] = [
    { id: ids.teacher, email: 'teacher@example.test', name: 'Alex Morgan', role: 'TEACHER' },
    {
      id: ids.otherTeacher,
      email: 'other.teacher@example.test',
      name: 'Jordan Lee',
      role: 'TEACHER',
    },
    {
      id: key('teacher:speaking'),
      email: 'speaking.teacher@example.test',
      name: 'Priya Shah',
      role: 'TEACHER',
    },
  ];
  await db.transaction(async (tx) => {
    for (const actor of [...teachers, ...students])
      await tx.query(
        'INSERT INTO users(id,email,name,role,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
        [actor.id, actor.email, actor.name, actor.role, hash],
      );
    // Tidy the original walkthrough account without changing its login or historical records.
    await tx.query(
      "UPDATE users SET name='Jamie Rivera' WHERE email='student@example.com' AND role='STUDENT' AND name='Student 1'",
    );
    // Only normalize known seed names; keep edited profiles and every password intact.
    await tx.query(
      "UPDATE users SET name='Sam Chen' WHERE id=$1 AND name IN ('Student','Demo Student','Sam Chen')",
      [ids.student],
    );
  });
  async function classroom(id: string, name: string, teacher: Actor, previousName?: string) {
    const [previous] = await db.query<{ id: string }>(
      'SELECT id FROM classrooms WHERE teacher_id=$1 AND (id=$2 OR name=$3 OR name=$4) ORDER BY created_at LIMIT 1',
      [teacher.id, id, name, previousName ?? name],
    );
    const classId = previous?.id ?? id;
    await db.query(
      'INSERT INTO classrooms(id,name,teacher_id) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',
      [classId, name, teacher.id],
    );
    return classId;
  }
  const a = await classroom(ids.classroom, 'English · Group A', teachers[0]!);
  const b = await classroom(ids.otherClassroom, 'English · Group B', teachers[1]!);
  const workshop = await classroom(
    key('class:workshop'),
    'English · Green School Project',
    teachers[0]!,
    'class B',
  );
  const seminar = await classroom(
    key('class:seminar'),
    'English · Reading Circle',
    teachers[0]!,
    'class C',
  );
  const speaking = await classroom(key('class:speaking'), 'English · Speaking Lab', teachers[2]!);
  const rosters = [
    { id: a, teacher: teachers[0]!, students: students.slice(0, 12) },
    { id: b, teacher: teachers[1]!, students: students.slice(12) },
    {
      id: workshop,
      teacher: teachers[0]!,
      students: [...students.slice(0, 4), ...students.slice(12, 16)],
    },
    { id: seminar, teacher: teachers[0]!, students: students.slice(0, 6) },
    {
      id: speaking,
      teacher: teachers[2]!,
      students: [...students.slice(0, 3), ...students.slice(12, 15)],
    },
  ];
  for (const roster of rosters) {
    const [published] = await db.query(
      'SELECT 1 FROM assignments WHERE class_id=$1 AND description LIKE $2 LIMIT 1',
      [roster.id, 'Learning focus: %'],
    );
    // Do not re-add showcase members removed after publication.
    if (!published)
      for (const student of roster.students)
        await db.query(
          'INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [roster.id, student.id],
        );
  }
  // Normalize legacy demo titles while preserving identifiers and results.
  await db.query(
    "UPDATE assignments SET title='Reading foundations · Nouns' WHERE class_id=$1 AND title='Reading check · Demo'",
    [a],
  );
  await db.query(
    "UPDATE assignments SET title='Writing warm-up · Sentence practice',description='Practice clear sentences and review your teacher’s feedback.' WHERE class_id=$1 AND title='assignment for student1' AND description='11'",
    [workshop],
  );
  await db.query(
    "UPDATE assignments SET title='English Skills Diagnostic · Mixed Practice',description='Complete the vocabulary, grammar and reading tasks. Use the shared materials and review your answers before submitting.' WHERE class_id=$1 AND id=$2",
    [a, '08fbbc87-b3af-471e-8663-54d73f089f6d'],
  );
  // Remove redundant legacy type prefixes from this known synthetic diagnostic only.
  // Preserve question and option identifiers so existing submissions and grading remain valid.
  const diagnosticId = '08fbbc87-b3af-471e-8663-54d73f089f6d';
  for (const q of await multi.questions(db, diagnosticId)) {
    const definition = JSON.parse(JSON.stringify(q).replace(/【[^】]+】\s*/gu, ''));
    await db.query(
      'UPDATE questions SET prompt=regexp_replace(prompt,$2,$3),definition=$4::jsonb WHERE id=$1',
      [q.id, '^【[^】]+】[[:space:]]*', '', JSON.stringify(definition)],
    );
  }
  await expandShowcaseComposites(db);
  await mkdir(assets.directory, { recursive: true });
  const diagram = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" rx="24" fill="#eff6f0"/><g font-family="Arial,sans-serif" text-anchor="middle"><text x="480" y="74" font-size="34" fill="#243c32">OUR CLASSROOM RECYCLING STATION</text><g font-size="26" fill="#fff"><rect x="75" y="145" width="240" height="230" rx="20" fill="#3975a6"/><rect x="360" y="145" width="240" height="230" rx="20" fill="#b47727"/><rect x="645" y="145" width="240" height="230" rx="20" fill="#427d59"/><text x="195" y="245">PAPER</text><text x="480" y="245">PLASTIC</text><text x="765" y="245">GENERAL</text></g><g font-size="20" fill="#243c32"><text x="195" y="420">Notebooks and card</text><text x="480" y="420">Clean bottles</text><text x="765" y="420">Non-recyclable waste</text><text x="480" y="487">Empty · Sort · Check the label</text></g></g></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const audio = await readFile(new URL('../../demo-media/gardening-club.mp3', import.meta.url));
  async function media(
    actor: Actor,
    assignmentId: string,
    questionId: string,
    purpose: 'TEACHING' | 'ANSWER',
    kind: 'image' | 'audio',
    contentNodeId: string | null,
  ) {
    const request = key(`${assignmentId}:${actor.id}:${purpose}:${kind}`);
    const [existing] = await db.query<{ id: string; status: string }>(
      'SELECT id,status FROM assets WHERE owner_id=$1 AND upload_request_id=$2',
      [actor.id, request],
    );
    if (existing?.status === 'READY') return existing.id;
    let data = kind === 'image' ? diagram : audio;
    if (purpose === 'ANSWER' && kind === 'audio') {
      const [q] = await db.query<{ prompt: string }>('SELECT prompt FROM questions WHERE id=$1', [
        questionId,
      ]);
      data = await readFile(
        new URL(
          `../../demo-media/${q!.prompt.includes('book you recommend') ? 'book-response' : 'club-response'}.mp3`,
          import.meta.url,
        ),
      );
    }
    const file = await assets.initialize(actor, {
      uploadRequestId: request,
      assignmentId,
      questionId,
      contentNodeId,
      purpose,
      kind,
      name: kind === 'image' ? 'recycling-station.png' : 'gardening-club.mp3',
      mime: kind === 'image' ? 'image/png' : 'audio/mpeg',
      bytes: data.length,
    });
    const [row] = await db.query<{ storage_key: string }>(
      'SELECT storage_key FROM assets WHERE id=$1',
      [file.id],
    );
    await writeFile(assets.path(row!.storage_key), data);
    await db.query(
      "UPDATE assets SET status='PROCESSING',attempts=0,lease_until=NULL,lease_token=NULL WHERE id=$1",
      [file.id],
    );
    while ((await assets.metadata(actor, file.id)).status === 'PROCESSING') {
      if (!(await assets.processNext())) throw new Error('Media processing could not proceed.');
    }
    if ((await assets.metadata(actor, file.id)).status !== 'READY')
      throw new Error(`Showcase media failed: ${file.id}`);
    if (kind === 'audio' && purpose === 'TEACHING')
      await assets.transcript(actor, file.id, transcript);
    if (purpose === 'ANSWER')
      await assets.caption(
        actor,
        file.id,
        purpose === 'ANSWER'
          ? 'Student planning evidence · synthetic demonstration'
          : kind === 'audio'
            ? 'School gardening club · listening practice'
            : 'Three clearly labelled classroom bins',
      );
    return file.id;
  }
  const specs = [
    {
      classId: a,
      teacher: teachers[0]!,
      title: '01 · Everyday English — Grammar Check',
      kind: 'grammar',
      submitted: 12,
      graded: 12,
      due: -7,
      created: -21,
    },
    {
      classId: a,
      teacher: teachers[0]!,
      title: '02 · Green Vocabulary — Sort, Match & Order',
      kind: 'vocabulary',
      submitted: 9,
      graded: 9,
      due: -2,
      created: -16,
    },
    {
      classId: a,
      teacher: teachers[0]!,
      title: '03 · Park Clean-up — Reading & Evidence',
      kind: 'reading',
      submitted: 8,
      graded: 5,
      due: 3,
      created: -10,
    },
    {
      classId: a,
      teacher: teachers[0]!,
      title: '04 · A Greener School — Writing Workshop',
      kind: 'writing',
      submitted: 7,
      graded: 3,
      due: 5,
      created: -7,
    },
    {
      classId: a,
      teacher: teachers[0]!,
      title: '05 · Gardening Club — Listen & Respond',
      kind: 'listening',
      submitted: 5,
      graded: 2,
      due: 7,
      created: -5,
    },
    {
      classId: workshop,
      teacher: teachers[0]!,
      title: '06 · Green School Challenge — Project Portfolio',
      kind: 'project',
      submitted: 6,
      graded: 4,
      due: 10,
      created: -3,
    },
    {
      classId: seminar,
      teacher: teachers[0]!,
      title: '07 · Book Talk — Next Week’s Reading Circle',
      kind: 'speaking',
      submitted: 0,
      graded: 0,
      due: 14,
      created: -1,
      draft: true,
    },
    {
      classId: b,
      teacher: teachers[1]!,
      title: '08 · Group B — Grammar Consolidation',
      kind: 'grammar',
      submitted: 10,
      graded: 10,
      due: -1,
      created: -12,
    },
    {
      classId: b,
      teacher: teachers[1]!,
      title: '09 · Group B — Community Reading Journal',
      kind: 'reading',
      submitted: 6,
      graded: 3,
      due: 6,
      created: -6,
    },
    {
      classId: speaking,
      teacher: teachers[2]!,
      title: '10 · Speaking Lab — My Book Recommendation',
      kind: 'speaking',
      submitted: 4,
      graded: 2,
      due: 8,
      created: -4,
    },
  ];
  const summary = [];
  for (const spec of specs) {
    const marker = `Learning focus: ${spec.kind}.`;
    let [stored] = await db.query<{ id: string }>(
      'SELECT id FROM assignments WHERE class_id=$1 AND description LIKE $2',
      [spec.classId, marker + '\n%'],
    );
    const fresh = !stored;
    if (!stored)
      stored = await multi.create(
        spec.teacher,
        createAssignmentV2Schema.parse({
          schemaVersion: 2,
          classId: spec.classId,
          title: spec.title,
          description: `${marker}\n${spec.kind === 'listening' ? 'Listen carefully, then answer in complete sentences.' : 'Read the instructions for each task. Review your answers before submitting.'} ${spec.draft ? 'Teacher preparation draft for the next lesson.' : ['grammar', 'vocabulary'].includes(spec.kind) ? 'Your results are scored automatically after submission.' : 'Your teacher will review written responses and publish feedback.'}`,
          dueAt: new Date(Date.now() + Math.max(spec.due, 1) * DAY).toISOString(),
          questions: showcaseQuestions(spec.kind),
        }),
      );
    let detail = await multi.detail(spec.teacher, stored.id);
    const unfinished = detail.status === 'DRAFT' && !spec.draft;
    if (detail.status === 'DRAFT' && !spec.draft) {
      if (['listening', 'project'].includes(spec.kind)) {
        const questions = await multi.questions(db, stored.id);
        const target = questions.find((q) => q.type !== 'COMPOSITE')!;
        const kind = spec.kind === 'listening' ? 'audio' : 'image';
        const nodeId = key(`${stored.id}:teaching-node`);
        if (!target.prompt.some((block) => block.id === nodeId)) {
          const assetId = await media(spec.teacher, stored.id, target.id, 'TEACHING', kind, nodeId);
          target.prompt.push(
            kind === 'audio'
              ? {
                  id: nodeId,
                  type: 'audio',
                  assetId,
                  label: 'Gardening club announcement',
                  caption: 'Listen for the meeting time and activities.',
                }
              : {
                  id: nodeId,
                  type: 'image',
                  assetId,
                  label: 'Recycling station plan',
                  alt: 'Three bins labelled paper, plastic and general waste.',
                  caption: 'Use this plan as inspiration for your own design.',
                },
          );
          detail = await multi.update(spec.teacher, stored.id, {
            schemaVersion: 2,
            classId: spec.classId,
            title: spec.title,
            description: String(detail.description),
            dueAt: new Date(String(detail.dueAt)).toISOString(),
            version: Number(detail.version),
            questions,
          });
        }
      }
      await multi.publish(spec.teacher, stored.id, { schemaVersion: 2, version: detail.version });
      detail = await multi.detail(spec.teacher, stored.id);
    }
    const members = rosters.find((r) => r.id === spec.classId)!.students;
    // The main student account demonstrates graded, pending, and still-answerable work.
    const roster =
      spec.kind === 'reading'
        ? [...members.slice(6), ...members.slice(0, 6)]
        : spec.kind === 'listening'
          ? [...members.slice(1), members[0]!]
          : members;
    if (!spec.draft)
      for (let i = 0; i < spec.submitted; i++) {
        const student = roster[i]!;
        const [existing] = await db.query<{
          id: string;
          grading_status: string;
          grading_version: number;
        }>(
          'SELECT id,grading_status,grading_version FROM submissions WHERE assignment_id=$1 AND student_id=$2',
          [stored.id, student.id],
        );
        // Existing attempts and teacher changes always win on reruns.
        if (existing) continue;
        const questions = await multi.questions(db, stored.id);
        const answers = showcaseAnswers(questions, i);
        const manual = questions.filter((q) => q.type === 'RESPONSE');
        if (i === 0 && ['project', 'writing', 'listening', 'speaking'].includes(spec.kind)) {
          const answer = answers.find((a) => a.type === 'RESPONSE')!;
          if (answer.type === 'RESPONSE')
            answer.payload.assetIds = [
              await media(
                student,
                stored.id,
                answer.questionId,
                'ANSWER',
                spec.kind === 'writing' || spec.kind === 'project' ? 'image' : 'audio',
                null,
              ),
            ];
        }
        await multi.submit(
          student,
          stored.id,
          submissionV2Schema.parse({
            schemaVersion: 2,
            publishedVersion: detail.publishedVersion,
            requestId: key(`${stored.id}:${student.id}:submit`),
            answers,
          }),
        );
        const [result] = await db.query<{ id: string }>(
          'SELECT id FROM submissions WHERE assignment_id=$1 AND student_id=$2',
          [stored.id, student.id],
        );
        if (!result) throw new Error('Showcase submission was not saved.');
        if (manual.length && i <= spec.graded) {
          const grading = manual.map((q) => ({
            questionId: q.id,
            dimensions: q.config.rubric.map((d, index) => ({
              dimensionId: d.id,
              score: Math.max(0, d.points - ((i + index) % 4)),
            })),
            feedback:
              i % 2
                ? 'Your main idea is clear. Add one specific example and use a connector to explain its benefit. Check subject–verb agreement in your final sentence.'
                : 'Strong use of supporting details and a clear structure. For the next task, vary your sentence openings and check punctuation.',
          }));
          const saved = await multi.saveGrading(spec.teacher, String(result.id), {
            gradingVersion: 0,
            answers: grading,
          });
          if (i < spec.graded) {
            const released = await multi.publishGrading(spec.teacher, String(result.id), {
              gradingVersion: Number(saved.gradingVersion),
              requestId: key(`${stored.id}:${student.id}:grade`),
              reason: '',
            });
            if (i === 0 && spec.kind === 'writing') {
              grading[0]!.dimensions[0]!.score = 10;
              grading[0]!.feedback +=
                ' Revision: the supporting evidence meets the full ideas criterion.';
              const revised = await multi.saveGrading(spec.teacher, String(result.id), {
                gradingVersion: Number(released.gradingVersion),
                answers: grading,
              });
              await multi.publishGrading(spec.teacher, String(result.id), {
                gradingVersion: Number(revised.gradingVersion),
                requestId: key(`${stored.id}:${student.id}:revision`),
                reason:
                  'Moderation review: award full evidence credit for the concrete refill-station example.',
              });
            }
          }
        }
        // Historical timestamps are synthetic, ordered, and before the seeded deadline.
        const submitted = new Date(Date.now() + (spec.created + 1 + i * 0.08) * DAY);
        await db.query(
          "UPDATE submissions SET submitted_at=$2,graded_at=CASE WHEN grading_status='GRADED' THEN $2::timestamptz+interval '4 hours' ELSE NULL END WHERE id=$1",
          [result.id, submitted],
        );
        await db.query(
          "UPDATE grading_revisions SET created_at=$2::timestamptz+version*interval '1 hour' WHERE submission_id=$1",
          [result.id, submitted],
        );
        await db.query(
          "UPDATE grading_drafts SET updated_at=$2::timestamptz+interval '3 hours' WHERE submission_id=$1",
          [result.id, submitted],
        );
      }
    if (fresh || unfinished)
      await db.query(
        "UPDATE assignments SET created_at=$2,published_at=CASE WHEN status='PUBLISHED' THEN $2::timestamptz+interval '1 hour' ELSE NULL END,due_at=$3 WHERE id=$1",
        [
          stored.id,
          new Date(Date.now() + spec.created * DAY),
          new Date(Date.now() + spec.due * DAY),
        ],
      );
    summary.push({
      title: spec.title,
      id: stored.id,
      ...(await multi.stats(spec.teacher, stored.id)),
    });
  }
  // One student has historical grades after leaving the project group. Main English access remains.
  const removed = students[3]!;
  const [recipient] = await db.query(
    'SELECT 1 FROM assignment_recipients r JOIN assignments a ON a.id=r.assignment_id WHERE a.class_id=$1 AND r.student_id=$2 AND r.removed_at IS NULL AND a.description LIKE $3',
    [workshop, removed.id, 'Learning focus: %'],
  );
  if (recipient) await classes.remove(teachers[0]!, workshop, removed.id);
  // Active invitation rows are visible in Classes. Do not manufacture past usage counts.
  for (const roster of rosters) {
    const id = key(`${roster.id}:invitation`);
    await db.query(
      "INSERT INTO invitations(id,token_hash,kind,class_id,max_uses,expires_at) VALUES ($1,$2,'CLASS',$3,20,clock_timestamp()+interval '30 days') ON CONFLICT(id) DO NOTHING",
      [
        id,
        digest(createHash('sha256').update(`${id}:demo-invitation`).digest('base64url')),
        roster.id,
      ],
    );
  }
  return {
    teachers: teachers.map((t) => ({ name: t.name, email: t.email })),
    students: students.length,
    classes: rosters.length,
    assignments: summary,
  };
}
