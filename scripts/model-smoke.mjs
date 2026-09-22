// Explicit integration test: one ephemeral Codex turn using synthetic data only.
import { AppServer } from '../bridge/app-server.mjs';
import Core from '../addon/content/core.js';
const app = new AppServer();
let timer;
try {
  await app.start();
  const { thread } = await app.request('thread/start', { ephemeral: true, sandbox: 'read-only', approvalPolicy: 'untrusted', developerInstructions: 'Answer the synthetic reading test from supplied material. Do not run tools.' });
  let answer = '', deltas = 0;
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic model test timed out')), 55000);
    app.on('notification', event => {
      if (event.params?.threadId !== thread.id) return;
      if (event.method === 'item/agentMessage/delta') { deltas++; answer += event.params.delta; }
      if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') answer = event.params.item.text;
      if (event.method === 'turn/completed') event.params.turn.error ? reject(new Error(event.params.turn.error.message)) : resolve(event.params.turn.status);
    });
  });
  // Register a rejection handler immediately, even if turn/start itself fails.
  completed.catch(() => {});
  await app.request('turn/start', { threadId: thread.id, input: Core.buildInput('According to the synthetic excerpt, how many participants were in the study? Reply with the number only.', [{ id: 'synthetic-1', title: 'Synthetic paper', text: 'The study enrolled exactly 37 participants.' }]) });
  const status = await completed;
  console.log(JSON.stringify({ ephemeral: true, usedSyntheticMaterialOnly: true, status, streamedDeltas: deltas, correctAnswer: answer.trim() === '37' }, null, 2));
  if (answer.trim() !== '37') process.exitCode = 1;
} finally { clearTimeout(timer); app.close(); }
