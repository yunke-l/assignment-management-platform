import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import supertest from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { Database } from '../apps/api/src/database/database.js';
import { migrate } from '../apps/api/src/database/migrate.js';
import { seed, ids } from '../apps/api/src/database/seed.js';
const url = process.env.BENCH_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_bench'))
  throw new Error(
    'Set BENCH_DATABASE_URL to a fresh disposable database whose name ends in _bench.',
  );
process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'postgres';
process.env.DATABASE_URL = url;
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'BenchmarkOnly123!';
async function main() {
  const app = await createApp(true);
  const db = app.get(Database);
  try {
    const [existing] = await db.query("SELECT to_regclass('public.users') AS name");
    if (existing?.name)
      throw new Error('Benchmark requires an empty database; no existing data is modified.');
    await migrate(db);
    await seed(db);
    await db.transaction(async (tx) => {
      await tx.exec("SET LOCAL statement_timeout='120s'");
      await tx.exec(`
      -- Deterministic RFC-variant UUID v8 fixtures; raw MD5 casts can have invalid
      -- version/variant bits and do not satisfy the public UUID input contract.
      CREATE FUNCTION pg_temp.fixture_uuid(value text) RETURNS uuid
      LANGUAGE sql IMMUTABLE AS $$
        SELECT (substr(md5(value),1,12)||'8'||substr(md5(value),14,3)||'8'||substr(md5(value),18,15))::uuid
      $$;
      INSERT INTO classrooms(id,name,teacher_id) SELECT pg_temp.fixture_uuid('bench-class-'||g),'Benchmark class '||g,'${ids.teacher}' FROM generate_series(1,20) g;
      INSERT INTO users(id,email,name,password_hash,role)
      SELECT pg_temp.fixture_uuid('bench-student-'||g),'bench-'||g||'@example.test','Learner '||lpad(g::text,4,'0'),u.password_hash,'STUDENT' FROM generate_series(1,2000) g CROSS JOIN users u WHERE u.id='${ids.student}';
      INSERT INTO class_memberships(class_id,student_id) SELECT pg_temp.fixture_uuid('bench-class-'||((g-1)/100+1)),pg_temp.fixture_uuid('bench-student-'||g) FROM generate_series(1,2000) g;
      INSERT INTO assignments(id,class_id,title,status,due_at,published_at)
      SELECT pg_temp.fixture_uuid('bench-assignment-'||g),pg_temp.fixture_uuid('bench-class-'||((g-1)/100+1)),'Benchmark assignment '||g,'PUBLISHED',now()+interval '1 day',now() FROM generate_series(1,2000) g;
      INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points)
      SELECT pg_temp.fixture_uuid('bench-question-'||g),pg_temp.fixture_uuid('bench-assignment-'||g),0,'Select A','["A","B"]',0,100 FROM generate_series(1,2000) g;
      INSERT INTO assignment_recipients(assignment_id,student_id) SELECT a.id,m.student_id FROM assignments a JOIN class_memberships m ON m.class_id=a.class_id;
      INSERT INTO submissions(id,assignment_id,student_id,request_id,request_hash,answers,score,max_score)
      SELECT pg_temp.fixture_uuid(a.id::text||u.id::text),a.id,u.id,pg_temp.fixture_uuid('request-'||a.id::text||u.id::text),'benchmark-fixture',
        jsonb_build_array(jsonb_build_object('questionId',q.id,'selectedIndex',0)),100,100
      FROM assignments a JOIN assignment_recipients r ON r.assignment_id=a.id JOIN users u ON u.id=r.student_id JOIN questions q ON q.assignment_id=a.id
      WHERE NULLIF(split_part(split_part(u.email,'@',1),'-',2),'')::integer % 2=0;
      ANALYZE;`);
    });
    await app.listen(0, '127.0.0.1');
    const http = supertest(await app.getUrl());
    const login = await http
      .post('/api/auth/login')
      .send({ email: 'teacher@example.test', password: process.env.DEMO_PASSWORD })
      .expect(201);
    const auth = `Bearer ${login.body.token}`;
    const [a] = await db.query('SELECT id,class_id FROM assignments ORDER BY id LIMIT 1');
    const paths = [
      '/api/assignments?page=1&pageSize=20',
      `/api/assignments/${a!.id}/submissions?page=1&pageSize=20`,
    ];
    const results = [];
    for (const path of paths) {
      for (let i = 0; i < 5; i++) await http.get(path).set('Authorization', auth).expect(200);
      const elapsed = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const start = performance.now();
          await http.get(path).set('Authorization', auth).expect(200);
          return performance.now() - start;
        }),
      );
      elapsed.sort((a, b) => a - b);
      results.push({
        path: path.replace(String(a!.id), ':id'),
        clients: 50,
        requests: 50,
        p50Ms: elapsed[24],
        p95Ms: elapsed[47],
        maxMs: elapsed[49],
      });
    }
    const plans = {} as Record<string, unknown>;
    plans.list = await db.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT a.id,a.title FROM assignments a JOIN classrooms c ON c.id=a.class_id WHERE c.teacher_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 20`,
      [ids.teacher],
    );
    plans.report = await db.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT u.id,u.name,s.score FROM assignment_recipients r JOIN users u ON u.id=r.student_id LEFT JOIN submissions s ON s.assignment_id=r.assignment_id AND s.student_id=r.student_id WHERE r.assignment_id=$1 ORDER BY u.name,u.id LIMIT 20`,
      [a!.id],
    );
    const [version] = await db.query('SELECT version() AS version');
    const output = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      os: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      postgres: version!.version,
      data: {
        classes: 20,
        students: 2000,
        assignments: 2000,
        recipients: 200000,
        submissions: 100000,
      },
      scope:
        'Single local API process with pg pool max=10; 5 warm-ups then one 50-request wave per route. Synthetic data; not production capacity.',
      results,
      plans,
    };
    await mkdir('docs/evidence', { recursive: true });
    await writeFile('docs/evidence/benchmark.json', JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ results, data: output.data }));
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
