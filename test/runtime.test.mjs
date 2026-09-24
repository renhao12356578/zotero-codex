import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
