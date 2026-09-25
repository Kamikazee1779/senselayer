import { createApp } from './server.js';

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, '127.0.0.1', () => {
  console.log(`SenseLayer server: http://127.0.0.1:${port}`);
});
