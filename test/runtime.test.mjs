import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32,posix} from 'node:path';
import Core from '../addon/content/runtime-core.js';
import {configureText,configureFile} from '../runtime/configure.mjs';
import {parseForESLint,getStaticTOMLValue} from 'toml-eslint-parser';
const parse = text => getStaticTOMLValue(parseForESLint(text).ast);
const root=join(tmpdir(),'runtime'), connection=join(tmpdir(),'profile','connection.json');
const options={node:join(root,'0.7.0','node'),server:join(root,'0.7.0','mcp','server.mjs'),connection,root};
test('platform matching is explicit, unsupported platforms fail before downloading',()=>{
  assert.equal(Core.platform('Darwin','aarch64-gcc3'),'darwin-arm64');
  assert.equal(Core.platform('WINNT','x86_64-msvc'),'win32-x64');
  assert.throws(()=>Core.platform('WINNT','aarch64-msvc'),/暂不支持/);
});
test('system Node version check matches actual dependency engines',()=>{
  for(const v of ['22.13.0','22.22.0','24.0.0','25.8.1']) assert.equal(Core.compatibleNode(v),true,v);
  for(const v of ['18.20.0','20.19.0','22.12.0','23.5.0','24.0.0-rc.1','not-node','']) assert.equal(Core.compatibleNode(v),false,v);
});
test('GUI discovery covers absolute PATH, Homebrew, Volta and Windows Node installers',()=>{
  const unix=Core.candidates('Darwin',{PATH:'./bin::/custom/bin:/custom/bin',VOLTA_HOME:'/home/a/.volta'},'/home/a',posix.join);
  assert.equal(unix.filter(p=>p==='/custom/bin/node').length,1);assert.ok(unix.includes('/opt/homebrew/bin/node'));assert.ok(unix.includes('/home/a/.volta/bin/node'));assert.ok(unix.every(p=>p.startsWith('/')));
  const windows=Core.candidates('WINNT',{PATH:'bin;"C:\\Node Tools";C:\\Node Tools',ProgramFiles:'C:\\Program Files',NVM_SYMLINK:'C:\\nvm-node'},'C:\\Users\\test',win32.join);
  assert.ok(windows.includes('C:\\Program Files\\nodejs\\node.exe'));assert.ok(windows.includes('C:\\nvm-node\\node.exe'));assert.equal(windows.filter(p=>p==='C:\\Node Tools\\node.exe').length,1);assert.ok(windows.every(win32.isAbsolute));
});
test('service-only assets remain pinned and cannot silently select a full package',()=>{
  const manifest={schema:1,version:'0.8.0',services:{'darwin-arm64':{name:'zotero-codex-service-0.8.0-darwin-arm64.zip',size:10,sha256:'a'.repeat(64)}}};
  assert.match(Core.asset(manifest,'0.8.0','darwin-arm64','service').url,/service-0.8.0/);
  assert.throws(()=>Core.asset(manifest,'0.8.0','darwin-arm64','full'));
});
test('manifest pins version, repository, platform, size and SHA256',()=>{
  const name='zotero-codex-runtime-0.7.0-darwin-arm64.zip';
  const manifest={schema:1,version:'0.7.0',assets:{'darwin-arm64':{name,size:10,sha256:'a'.repeat(64),url:'https://attacker.invalid'}}};
  assert.equal(Core.asset(manifest,'0.7.0','darwin-arm64').url,Core.releaseURL('0.7.0',name));
  assert.throws(()=>Core.asset(manifest,'0.7.1','darwin-arm64'));
  manifest.assets['darwin-arm64'].size=400*1024*1024;assert.throws(()=>Core.asset(manifest,'0.7.0','darwin-arm64'));
});
test('archive paths reject traversal and Windows alternate names',()=>{
  for(const path of ['../outside','/root','foo/../../bar','C:/x','a\\b','a:stream','x/CON.txt','x/.. /foo','a//b','a./file']) assert.throws(()=>Core.entry(path),path);
  assert.deepEqual(Core.entry('node_modules/@napi-rs/canvas/package.json'),['node_modules','@napi-rs','canvas','package.json']);
});
test('first connection creates valid TOML without altering existing clients and models',()=>{
  const before='# keep comment\nmodel="example"\n[mcp_servers.other]\ncommand="other"\n';
  const result=configureText(before,options);
  assert.ok(result.text.startsWith(before));assert.equal(parse(result.text).mcp_servers.other.command,'other');
  assert.equal(parse(result.text).mcp_servers.zotero.command,options.node);
  assert.equal(configureText(result.text,options).changed,false);
});
test('migration preserves env, approval policies, comments and multiline strings',()=>{
  const before=`prompt='''\n[mcp_servers.zotero]\nnot a real table\n'''\n[mcp_servers."zotero"]\ncommand="old-node" # Keep this\nargs=${JSON.stringify([join(tmpdir(),'source','mcp','server.mjs'),'--connection-file',connection])}\ndisabled_tools=["delete"]\n[mcp_servers.zotero.env]\nKEEP="yes"\n[mcp_servers.other]\ncommand="untouched"\n`;
  const result=configureText(before,options), data=parse(result.text);
  assert.match(result.text,/# Keep this/);assert.equal(data.mcp_servers.zotero.env.KEEP,'yes');assert.deepEqual(data.mcp_servers.zotero.disabled_tools,['delete']);
  assert.equal(data.mcp_servers.other.command,'untouched');assert.equal(data.mcp_servers.zotero.enabled,true);
});
test('automatic upgrade touches only this managed profile and preserves disabled state',()=>{
  assert.equal(configureText('',{...options,mode:'update'}).configured,false);
  const old=configureText('',{...options,node:join(root,'old','node'),server:join(root,'old','mcp','server.mjs')}).text.replace('enabled = true','enabled = false');
  const result=configureText(old,{...options,mode:'update'});assert.equal(result.configured,true);assert.equal(parse(result.text).mcp_servers.zotero.enabled,false);
  assert.equal(configureText(old,{...options,connection:join(tmpdir(),'another-profile.json'),mode:'update'}).changed,false);
});
test('managed service remains owned when switching between system and bundled Node',()=>{
  const external=join(tmpdir(),'system-node','node');
  const initial=configureText('',{...options,node:external}).text;
  const fallback=configureText(initial,{...options,mode:'update'});
  assert.equal(fallback.configured,true);assert.equal(parse(fallback.text).mcp_servers.zotero.command,options.node);
  const reuse=configureText(fallback.text,{...options,node:external,mode:'update'});
  assert.equal(reuse.configured,true);assert.equal(parse(reuse.text).mcp_servers.zotero.command,external);
});
test('malformed config, inline tables and unrelated names are left intact',()=>{
  assert.throws(()=>configureText('broken="',options),/格式/);
  assert.throws(()=>configureText('[mcp_servers.zotero]\nurl="http://example.test"',options),/另一个/);
  const inline=`mcp_servers={zotero={command=${JSON.stringify(options.node)},args=${JSON.stringify([options.server,'--connection-file',connection])}}}`;
  assert.throws(()=>configureText(inline,options),/内联/);
});
test('configuration uses an atomic private write and a restorable exact backup',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'zotero-config-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'config.toml'),original='# original\nmodel="kept"\n';await writeFile(path,original);
  await configureFile(path,options);
  const backup=(await readdir(dir)).find(n=>n.endsWith('.bak'));assert.equal(await readFile(join(dir,backup),'utf8'),original);
  assert.equal(parse(await readFile(path,'utf8')).mcp_servers.zotero.command,options.node);
  assert.equal((await readdir(dir)).some(n=>n.endsWith('.lock')||n.endsWith('.tmp')),false);
});
test('automatic preparation leaves absent Codex config alone and active lock prevents writes',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'zotero-lock-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'codex','config.toml');
  assert.deepEqual(await configureFile(path,{...options,mode:'update'}),{configured:false,changed:false});
  assert.deepEqual(await readdir(dir),[]);
  const file=join(dir,'config.toml');await writeFile(file+'.zotero-mcp.lock',String(process.pid));
  await assert.rejects(configureFile(file,options),/另一个配置操作/);
  assert.deepEqual(await readdir(dir),['config.toml.zotero-mcp.lock']);
});
