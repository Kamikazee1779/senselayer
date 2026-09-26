import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createApp } from './server.js';
import { InMemoryStore } from './state.js';
import { engineConfig } from './config.js';

const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3001);
const { provider, user } = engineConfig();
createApp(new InMemoryStore(undefined, provider, user)).listen(port, '127.0.0.1', () => {
  console.log(`SenseLayer server: http://127.0.0.1:${port}`);
});
