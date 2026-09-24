import 'reflect-metadata';
import { Database } from './database.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
const db = new Database();
try {
  const command = process.argv[2];
  if (command === 'migrate') await migrate(db);
  else if (command === 'seed') await seed(db);
  else throw new Error('Usage: cli.ts migrate|seed');
  console.log(`Database ${command} complete.`);
} finally {
  await db.onModuleDestroy();
}
