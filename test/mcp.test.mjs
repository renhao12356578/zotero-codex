import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, resultContent, callHost } from '../mcp/server.mjs';
import contract from '../addon/content/mcp-schema.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

test('SDK handshake, tool catalog and schema failures without calling host', async () => {
  let called = 0;
  const server = createServer(async () => { called++; return {ok:true}; });
  const client = new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const tools=(await client.listTools()).tools;
    assert.equal(tools.length,contract.tools.length);
    assert.equal(tools.find(t=>t.name==='zotero_write_note').annotations.readOnlyHint,false);
    const bad=await client.callTool({name:'zotero_write_note',arguments:{note:{libraryID:1,key:'AAAAAAAA'},text:'bad'}});
    assert.equal(bad.isError,true);assert.equal(called,0);
    const ok=await client.callTool({name:'zotero_status',arguments:{}});
    assert.equal(ok.isError,undefined);assert.equal(called,1);
  } finally {await client.close();await server.close();}
});
test('invalid refs, unknown arguments and oversized output text rejected at shared boundary', () => {
  assert.throws(()=>contract.validateCall('zotero_read_note',{note:{libraryID:1,key:'../../x'}}));
  assert.throws(()=>contract.validateCall('zotero_read_note',{note:{libraryID:1,key:'AAAAAAAA'},limit:30001}));
  assert.throws(()=>contract.validateCall('zotero_status',{execute:'danger'}));
});
test('note edits accept code-style line patches and reject ambiguous shapes', () => {
  const base = { note:{libraryID:1,key:'AAAAAAAA'}, revision:'r', requestID:'q' };
  for (const edit of [
    {operation:'replace',startLine:2,endLine:4,newText:'rewritten\nsection'},
    {operation:'delete',startLine:5,endLine:6},
    {operation:'insert',startLine:3,newText:'new paragraph'}
  ]) contract.validateCall('zotero_edit_note', {...base, edits:[edit]});
  contract.validateCall('zotero_edit_note', {...base, edits:[{oldText:'before',newText:'after'}]});
  assert.throws(() => contract.validateCall('zotero_edit_note', {...base, edits:[{operation:'insert',startLine:3}]}));
  assert.throws(() => contract.validateCall('zotero_edit_note', {...base, edits:[{operation:'replace',startLine:3,endLine:4,newText:'x',oldText:'y'}]}));
});
test('regions become MCP image content instead of base64 text', () => {
  const result=resultContent({selection:{text:'figure',image:'data:image/png;base64,YWJj'}});
  assert.equal(result.content[1].type,'image');
  assert.equal(result.content[1].mimeType,'image/png');
  assert.equal(JSON.parse(result.content[0].text).selection.imageIndex,1);
  assert.ok(!result.content[0].text.includes('YWJj'));
  assert.throws(()=>resultContent({image:'https://example.com/figure.png'}));
});
test('loopback authentication, token rotation and rejected remote discovery', async () => {
  const dir=await mkdtemp(join(tmpdir(),'zotero-mcp-unit-')),file=join(dir,'connection.json');
  let expected='a'.repeat(64);
  const host=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+expected);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});
  await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
  const config=()=>({url:`http://127.0.0.1:${host.address().port}/zotero-codex/mcp`,token:expected});
  try {
    await writeFile(file,JSON.stringify(config()),{mode:0o600});
    assert.equal((await callHost(file,'zotero_status',{})).ok,true);
    expected='b'.repeat(64);await writeFile(file,JSON.stringify(config()));
    assert.equal((await callHost(file,'zotero_status',{})).ok,true);
    await writeFile(file,JSON.stringify({...config(),url:'http://example.com:23119/zotero-codex/mcp'}));
    await assert.rejects(callHost(file,'zotero_status',{}),/Invalid local/);
  } finally {await new Promise(r=>host.close(r));await rm(dir,{recursive:true,force:true});}
});

test('catalog rejects accidental collisions instead of running a second implementation', () => {
  assert.throws(()=>createServer(async()=>({}),{tools:[{name:'zotero_read_note'}]}),/Duplicate/);
});

test('unified status reports both transports and preserves partial failures', async () => {
  for (const [apiOK, pluginOK] of [[true,true],[true,false],[false,true],[false,false]]) {
    const native={tools:[{name:'zotero_status'}],call:async()=>apiOK ? {content:[{type:'text',text:JSON.stringify({connected:true,writeAccess:false})}]} : {isError:true,content:[{type:'text',text:'API disabled'}]},close:async()=>{}};
    const server=createServer(async()=>{if(!pluginOK)throw new Error('Plugin missing');return {connected:true,betterNotes:true};},native);
    const client=new Client({name:'status-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
    await server.connect(a);await client.connect(b);
    try{
      assert.equal((await client.listTools()).tools.filter(t=>t.name==='zotero_status').length,1);
      const status=JSON.parse((await client.callTool({name:'zotero_status',arguments:{}})).content[0].text);
      assert.equal(status.ready,apiOK&&pluginOK);assert.equal(status.nativeAPI.connected,apiOK);assert.equal(status.plugin.connected,pluginOK);
      if(!apiOK)assert.equal(status.nativeAPI.error,'API disabled');
      if(!pluginOK)assert.equal(status.plugin.error,'Plugin missing');
    }finally{await client.close();await server.close();}
  }
});
