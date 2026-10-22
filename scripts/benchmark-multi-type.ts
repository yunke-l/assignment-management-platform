import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import supertest from 'supertest';
import {
  questionV2Schema,
  validateQuestions,
  scoreUnitCount,
  type QuestionV2,
  type Content,
  type AnswerV2,
} from '@amp/contracts';
import { createApp } from '../apps/api/src/app.js';
import { Database } from '../apps/api/src/database/database.js';
import { migrate } from '../apps/api/src/database/migrate.js';
import { seed, ids } from '../apps/api/src/database/seed.js';
import { digest, newToken } from '../apps/api/src/auth/session.js';
const url = process.env.BENCH_MULTI_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_multi_bench'))
  throw new Error('Set BENCH_MULTI_DATABASE_URL to a new empty database ending in _multi_bench.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'postgres';
process.env.DATABASE_URL = url;
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'BenchmarkOnly123!';
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
const choice = (label: string) => ({ id: randomUUID(), label, content: text(label) });
function fixture() {
  const questions: QuestionV2[] = [];
  for (let i = 0; i < 20; i++) {
    const parentId = randomUUID();
    const make = (
      type: QuestionV2['type'],
      position: number,
      config: unknown,
      answerKey: unknown,
      points: number,
      prompt = text('Complete this English task.'),
    ) =>
      questionV2Schema.parse({
        id: type === 'COMPOSITE' ? parentId : randomUUID(),
        parentId: type === 'COMPOSITE' ? null : parentId,
        position,
        type,
        prompt,
        answerAreaContent: [],
        config,
        answerKey,
        points,
      });
    questions.push(
      make(
        'COMPOSITE',
        i,
        { kind: i % 2 ? 'GENERAL' : 'READING' },
        {},
        0,
        text('Read the shared material. Birds can fly. An owl is active at night.'),
      ),
    );
    const options = [choice('Owl'), choice('Robin')];
    questions.push(
      i % 2
        ? make(
            'ORDERING',
            0,
            { items: options, initialOrder: [] },
            { orders: [options.map((c) => c.id)] },
            1,
          )
        : make('SINGLE_CHOICE', 0, { options }, { correctOptionId: options[0]!.id }, 1),
    );
    const blanks = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      points: 1,
      caseSensitive: false,
    }));
    questions.push(
      make(
        'FILL_BLANK',
        1,
        { blanks },
        { answers: blanks.map((b) => ({ blankId: b.id, values: ['night'] })) },
        2,
        [
          {
            id: randomUUID(),
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Fill each gap: ' },
              ...blanks.map((b) => ({ type: 'blank' as const, blankId: b.id })),
            ],
          },
        ],
      ),
    );
    const gaps = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      points: 1,
      options: [choice('sings'), choice('sing')],
    }));
    questions.push(
      make(
        'CLOZE_CHOICE',
        2,
        { blanks: gaps },
        { answers: gaps.map((b) => ({ blankId: b.id, optionId: b.options[0]!.id })) },
        2,
        [
          {
            id: randomUUID(),
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Choose the verb: ' },
              ...gaps.map((b) => ({ type: 'blank' as const, blankId: b.id })),
            ],
          },
        ],
      ),
    );
    const groups = [choice('Noun'), choice('Verb')],
      items = [choice('bird'), choice('fly')].map((c) => ({ ...c, points: 1 }));
    questions.push(
      make(
        'GROUPING',
        3,
        { groups, items },
        { placements: items.map((c, j) => ({ itemId: c.id, groupId: groups[j]!.id })) },
        2,
      ),
    );
    const left = [choice('cat'), choice('dog'), choice('owl')].map((c) => ({ ...c, points: 1 })),
      right = [choice('meow'), choice('bark'), choice('hoot')];
    questions.push(
      make(
        'MATCHING',
        4,
        { mode: 'ONE_TO_ONE', left, right },
        { pairs: left.map((c, j) => ({ leftId: c.id, rightId: right[j]!.id })) },
        3,
      ),
    );
  }
  const errors = validateQuestions(questions);
  if (errors.length) throw new Error(JSON.stringify(errors));
  if (
    questions.filter((q) => q.parentId === null).length !== 20 ||
    questions.filter((q) => q.type !== 'COMPOSITE').length !== 100 ||
    questions.reduce((sum, q) => sum + scoreUnitCount(q), 0) !== 200
  )
    throw new Error('Incorrect maximum-capacity benchmark fixture.');
  const answers: AnswerV2[] = questions.flatMap<AnswerV2>((q) => {
    const base = { questionId: q.id, evidenceAssetIds: [] };
    switch (q.type) {
      case 'COMPOSITE':
        return [];
      case 'SINGLE_CHOICE':
        return [{ ...base, type: q.type, payload: { optionId: q.answerKey.correctOptionId! } }];
      case 'FILL_BLANK':
        return [
          {
            ...base,
            type: q.type,
            payload: { blanks: q.config.blanks.map((b) => ({ blankId: b.id, text: 'night' })) },
          },
        ];
      case 'CLOZE_CHOICE':
        return [
          {
            ...base,
            type: q.type,
            payload: {
              blanks: q.answerKey.answers.map((b) => ({
                blankId: b.blankId,
                optionId: b.optionId!,
              })),
            },
          },
        ];
      case 'GROUPING':
        return [{ ...base, type: q.type, payload: { placements: q.answerKey.placements } }];
      case 'MATCHING':
        return [{ ...base, type: q.type, payload: { pairs: q.answerKey.pairs } }];
      case 'ORDERING':
        return [
          {
            ...base,
            type: q.type,
            payload: { orderedItemIds: q.answerKey.orders[0]!, confirmed: true },
          },
        ];
      case 'RESPONSE':
        throw new Error('This benchmark measures purely objective final submissions.');
    }
  });
  return { questions, answers };
}
async function main() {
  const app = await createApp(true),
    db = app.get(Database);
  try {
    const [existing] = await db.query("SELECT to_regclass('public.users') AS name");
    if (existing?.name)
      throw new Error('Benchmark requires a new empty database; no existing data is modified.');
    await migrate(db);
    await seed(db);
    const clients = Array.from({ length: 50 }, () => ({ id: randomUUID(), token: newToken() }));
    await db.transaction(async (tx) => {
      for (const [i, client] of clients.entries()) {
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash,role) SELECT $1,$2,$3,password_hash,'STUDENT' FROM users WHERE id=$4",
          [client.id, `multi-bench-${i}@example.test`, `Learner ${i}`, ids.student],
        );
        await tx.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
          ids.classroom,
          client.id,
        ]);
        await tx.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
          [digest(client.token), client.id],
        );
      }
    });
    await app.listen(0, '127.0.0.1');
    const http = supertest(await app.getUrl());
    const teacher = (
      await http
        .post('/api/auth/login')
        .send({ email: 'teacher@example.test', password: process.env.DEMO_PASSWORD })
        .expect(201)
    ).body.token;
    const f = fixture();
    const draft = (
      await http
        .post('/api/assignments')
        .set('Authorization', `Bearer ${teacher}`)
        .send({
          schemaVersion: 2,
          classId: ids.classroom,
          title: 'Maximum legal mixed questions benchmark',
          description: '',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          questions: f.questions,
        })
        .expect(201)
    ).body;
    const published = (
      await http
        .post(`/api/assignments/${draft.id}/publish`)
        .set('Authorization', `Bearer ${teacher}`)
        .send({ schemaVersion: 2, version: draft.version })
        .expect(201)
    ).body;
    const path = `/api/assignments/${draft.id}?schemaVersion=2`;
    for (let i = 0; i < 5; i++)
      await http.get(path).set('Authorization', `Bearer ${clients[i]!.token}`).expect(200);
    const measure = async (mode: 'metadata' | 'objective-submit') => {
      const timings = await Promise.all(
        clients.map(async (client) => {
          const start = performance.now();
          if (mode === 'metadata') {
            const res = await http
              .get(path)
              .set('Authorization', `Bearer ${client.token}`)
              .expect(200);
            if (JSON.stringify(res.body).includes('answerKey'))
              throw new Error('Private key leaked.');
          } else {
            const res = await http
              .post(`/api/assignments/${draft.id}/submissions`)
              .set('Authorization', `Bearer ${client.token}`)
              .send({
                schemaVersion: 2,
                publishedVersion: published.publishedVersion,
                requestId: randomUUID(),
                answers: f.answers,
              })
              .expect(201);
            if (res.body.score !== 200 || res.body.gradingStatus !== 'GRADED')
              throw new Error('Incorrect benchmark score.');
          }
          return performance.now() - start;
        }),
      ).then((values) => values.sort((a, b) => a - b));
      return {
        operation: mode,
        concurrentClients: 50,
        requests: 50,
        p50Ms: timings[24],
        p95Ms: timings[47],
        maxMs: timings[49],
        targetP95Ms: 1000,
        metLocalTarget: timings[47]! <= 1000,
      };
    };
    const results = [await measure('metadata'), await measure('objective-submit')];
    const [version] = await db.query('SELECT version() AS version');
    const report = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      os: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      postgres: version!.version,
      transport:
        'Loopback HTTP, one API process, pg pool maximum 10, warm metadata, synthetic isolated database',
      data: {
        roots: 20,
        leaves: 100,
        scoringUnits: 200,
        objectiveTypes: 6,
        clients: 50,
        publishedJsonBytes: Buffer.byteLength(JSON.stringify(published)),
        answerJsonBytes: Buffer.byteLength(JSON.stringify(f.answers)),
      },
      scope:
        'Local maximum-count legal mixed fixture; no production SLA, physical devices, WAN, sustained/cold-cache or media-transfer claim.',
      results,
    };
    await mkdir('docs/evidence', { recursive: true });
    await writeFile(
      'docs/evidence/multi-type-benchmark.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}
await main();
