import { createApp } from './app.js';
const app = await createApp();
await app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');
