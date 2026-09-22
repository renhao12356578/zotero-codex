import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createBridge } from '../bridge/server.mjs';

class FakeApp extends EventEmitter {
  constructor() { super(); this.calls = []; this.counter = 0; }
  async start() { this.ready = true; }
  close() { this.ready = false; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'owned-123' } };
    if (method === 'thread/list') return { data: [{ id: 'desktop-123', preview: 'desktop', status: { type: 'idle' } }] };
    if (method === 'thread/resume') return { thread: { id: params.threadId, status: { type: 'idle' } } };
    if (method === 'turn/start') { await new Promise(r => setTimeout(r, 15)); return { turn: { id: 'turn-' + (++this.counter) } }; }
    return {};
  }
}
async function setup(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'zotero-codex-test-'));
  const app = new FakeApp(), bridge = await createBridge({ app, stateDir, port: 0 });
  t.after(async () => { bridge.close(); await rm(stateDir, { recursive: true, force: true }); });
  const call = (path, body, headers = {}) => fetch(bridge.address + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${bridge.token}`, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { bridge, app, call };
}
test('bridge requires pairing, rejects browser origins and keeps external history read-only', async t => {
  const { bridge, app, call } = await setup(t);
  assert.equal((await fetch(bridge.address + '/status')).status, 401);
  assert.equal((await call('/status', null, { Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.get(bridge.address + '/status', { headers: { Host: 'evil.example', Authorization: `Bearer ${bridge.token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  const list = await (await call('/threads')).json(); assert.equal(list.data[0].writable, false);
  assert.equal((await call('/turn', { threadId: 'desktop-123', requestId: 'request-123', question: 'test' })).status, 409);
  assert.equal(app.calls.filter(c => c.method === 'turn/start').length, 0);
});
test('repeated requests start one turn and a concurrent second question is rejected', async t => {
  const { app, call } = await setup(t);
  await call('/session', { title: 'Synthetic paper' });
  const body = { threadId: 'owned-123', requestId: 'request-123', question: 'What does this mean?', cards: [] };
  const [a, b] = await Promise.all([call('/turn', body), call('/turn', body)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(app.calls.filter(c => c.method === 'turn/start').length, 1);
  assert.equal((await call('/turn', { ...body, requestId: 'request-456' })).status, 409);
  app.emit('notification', { method: 'turn/completed', params: { threadId: 'owned-123', turn: { id: 'turn-1' } } });
  assert.equal((await call('/turn', { ...body, requestId: 'request-789' })).status, 200);
});
test('event cursors exclude another paper thread and replay only unseen events', async t => {
  const { app, call } = await setup(t);
  app.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'a', delta: 'alpha' } });
  app.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'b', delta: 'beta' } });
  const first = await (await call('/events?id=a&since=0')).json();
  assert.equal(first.events.length, 1); assert.equal(first.events[0].params.delta, 'alpha');
  assert.equal((await (await call(`/events?id=a&since=${first.cursor}`)).json()).events.length, 0);
});
