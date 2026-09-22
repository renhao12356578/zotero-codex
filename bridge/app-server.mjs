import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class AppServer extends EventEmitter {
  constructor({ binary = process.env.CODEX_BIN || 'codex', args = ['app-server', '--stdio'], env = process.env, timeout = 30000 } = {}) {
    super(); Object.assign(this, { binary, args, env, timeout });
    this.pending = new Map(); this.nextId = 1; this.ready = false;
  }
  async start() {
    this.child = spawn(this.binary, this.args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    // Deliberately do not forward Codex diagnostics: they can include provider details.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Codex 连接已关闭 (${code ?? signal})`)));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) {
        if (message.id !== undefined) {
          // v0.1 has no approval UI: never silently authorize a tool operation.
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'This Zotero client does not yet implement interactive tool approvals.' } }) + '\n');
          this.emit('notification', { method: 'bridge/unsupportedRequest', params: { method: message.method, threadId: message.params?.threadId } });
        } else this.emit('notification', message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    const info = await this.request('initialize', { clientInfo: { name: 'zotero_codex', title: 'Zotero Codex', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    this.notify('initialized'); this.ready = true;
    return info;
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 请求超时：${method}。刷新状态后再操作。`)); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params = {}) { this.child.stdin.write(JSON.stringify({ method, params }) + '\n'); }
  fail(error) {
    this.ready = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('disconnect', error.message);
  }
  close() { this.lines?.close(); this.child?.stdin.end(); this.child?.kill(); }
}
