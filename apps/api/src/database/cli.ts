import 'reflect-metadata';
import { Database } from './database.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { seedShowcase } from './showcase.js';
const db = new Database();
try {
  const command = process.argv[2];
  if (command === 'migrate') await migrate(db);
  else if (command === 'seed') await seed(db);
  else if (command === 'showcase') console.log(JSON.stringify(await seedShowcase(db), null, 2));
  else throw new Error('Usage: cli.ts migrate|seed|showcase');
  console.log(`Database ${command} complete.`);
} finally {
  await db.onModuleDestroy();
}
