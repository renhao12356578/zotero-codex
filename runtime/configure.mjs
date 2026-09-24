import {parseForESLint, getStaticTOMLValue} from 'toml-eslint-parser';
import {readFile, writeFile, mkdir, rename, unlink, lstat, realpath} from 'node:fs/promises';
import {dirname, join, resolve, isAbsolute, relative, sep} from 'node:path';
import {homedir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

function parse(text) {
  try { const {ast} = parseForESLint(text); return {ast, data:getStaticTOMLValue(ast)}; }
  catch { throw new Error('Codex 配置格式有误，未修改文件。请先修复 Codex 设置。'); }
}
const inside = (root, path) => isAbsolute(path) && !relative(root, path).startsWith('..' + sep) && relative(root, path) !== '..' && !isAbsolute(relative(root, path));

export function configureText(text, {node, server, connection, root, mode = 'connect'}) {
  if (![node, server, connection, root].every(p => typeof p === 'string' && isAbsolute(p) && !/[\r\n\0]/.test(p))) throw new Error('安装路径无效');
  const {ast, data} = parse(text);
  const existing = data.mcp_servers?.zotero;
  const managed = existing && inside(root, existing.command || '') && inside(root, existing.args?.[0] || '') && existing.args?.[1] === '--connection-file' && existing.args?.[2] === connection;
  if (mode === 'update' && !managed) return {text, changed:false, configured:false};
  // Never silently take over a different service using the same name.
  if (existing && !managed && (existing.url || !existing.args?.[0]?.replaceAll('\\', '/').endsWith('/mcp/server.mjs') || existing.args?.[1] !== '--connection-file' || existing.args?.[2] !== connection)) {
    throw new Error('Codex 中已有另一个名为 zotero 的连接。请先在 Codex 中重命名该连接，再重试。');
  }
  const table = ast.body[0].body.find(n => n.type === 'TOMLTable' && n.resolvedKey?.join('.') === 'mcp_servers.zotero');
  if (existing && !table) throw new Error('现有 zotero 配置使用内联或点号写法，暂不能自动修改；原文件已保留。');
  const values = {command:node, args:[server, '--connection-file', connection], ...(mode === 'connect' ? {enabled:true} : {})};
  let output = text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!table) {
    output += `${text.endsWith('\n') || !text ? '' : eol}${eol}[mcp_servers.zotero]${eol}` + Object.entries(values).map(([k,v])=>`${k} = ${JSON.stringify(v)}`).join(eol) + eol;
  } else {
    const edits = [], missing = [];
    for (const [key, value] of Object.entries(values)) {
      const entry = table.body.find(n => n.type === 'TOMLKeyValue' && n.key.keys.length === 1 && (n.key.keys[0].name ?? n.key.keys[0].value) === key);
      if (entry) edits.push({start:entry.value.range[0], end:entry.value.range[1], text:JSON.stringify(value)});
      else missing.push(`${key} = ${JSON.stringify(value)}`);
    }
    // Append before the next table, preserving comments, env and tool policies.
    if (missing.length) {
      const end = text.indexOf('\n', table.range[1]);
      const position = end < 0 ? text.length : end + 1;
      edits.push({start:position,end:position,text:(position && text[position-1] !== '\n' ? eol : '')+missing.join(eol)+eol});
    }
    for (const edit of edits.sort((a,b)=>b.start-a.start)) output = output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  }
  const expected = structuredClone(data);
  expected.mcp_servers ??= {};
  expected.mcp_servers.zotero = {...existing, ...values};
  if (!isDeepStrictEqual(parse(output).data, expected)) throw new Error('无法安全合并 Codex 配置，原文件已保留。');
  return {text:output, changed:output !== text, configured:true};
}

export async function configureFile(file, options) {
  if (options.mode === 'update') {
    try { await lstat(file); } catch(error) { if(error.code === 'ENOENT') return {configured:false,changed:false}; throw error; }
  }
  await mkdir(dirname(file), {recursive:true, mode:0o700});
  const lock = file + '.zotero-mcp.lock';
  try { await writeFile(lock, String(process.pid), {flag:'wx',mode:0o600}); }
  catch(error) {
    if (error.code !== 'EEXIST') throw error;
    // A killed installer can leave a lock. Recover only when its owner is gone.
    const previous = await readFile(lock,'utf8');
    const pid = Number(previous); let stale = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid,0); } catch(error) { stale = error.code === 'ESRCH'; }
    } else stale = Date.now() - (await lstat(lock)).mtimeMs > 120000;
    if (!stale || await readFile(lock,'utf8') !== previous) throw new Error('另一个配置操作尚未完成，请稍后重试。');
    await unlink(lock);
    await writeFile(lock, String(process.pid), {flag:'wx',mode:0o600});
  }
  let temp;
  try {
    let original = '', exists = false;
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Codex 配置不是普通文件，未自动修改。');
      original = await readFile(file,'utf8'); exists = true;
    } catch(error) { if (error.code !== 'ENOENT') throw error; }
    const result = configureText(original, options);
    if (!result.changed) return {configured:result.configured,changed:false};
    if (exists) await writeFile(file + '.before-zotero-' + Date.now() + '.bak', original, {flag:'wx',mode:0o600});
    temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, result.text, {flag:'wx',mode:0o600});
    let current = null;
    try { current = await readFile(file,'utf8'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
    if (current !== (exists ? original : null)) throw new Error('配置文件刚被其他程序修改，请重试。');
    await rename(temp, file); temp = null;
    return {configured:true,changed:true};
  } finally {
    if (temp) await unlink(temp).catch(()=>{});
    await unlink(lock).catch(()=>{});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  const arg = name => process.argv[process.argv.indexOf(name)+1];
  let result;
  try {
    // An explicit target is used by isolated host tests, never supplied by normal UI.
    const file = process.argv.includes('--config') ? arg('--config') : join(process.env.CODEX_HOME || join(homedir(),'.codex'), 'config.toml');
    result = {ok:true,...await configureFile(file,{node:arg('--node'),server:arg('--server'),connection:arg('--connection'),root:arg('--root'),mode:arg('--mode')})};
  } catch(error) { result = {ok:false,error:error.message}; process.exitCode=1; }
  await writeFile(arg('--result'),JSON.stringify(result),{mode:0o600});
}
