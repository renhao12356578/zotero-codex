// Read-only handshake/history verification. Never prints account info or messages.
import { AppServer } from '../bridge/app-server.mjs';
const app = new AppServer();
try {
  const init = await app.start();
  const list = await app.request('thread/list', { limit: 5, modelProviders: [] });
  let history = false;
  if (list.data.length) {
    const result = await app.request('thread/read', { threadId: list.data[0].id, includeTurns: true });
    history = Array.isArray(result.thread.turns);
  }
  console.log(JSON.stringify({ initialized: true, historyListCount: list.data.length, historyReadable: history, createdThreads: 0, generatedTurns: 0, desktopRealtimeSync: 'not-verified' }, null, 2));
} finally { app.close(); }
