import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createNativeBridge } from '../mcp/native.mjs';
import { createServer } from '../mcp/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

async function fixture(content, run) {
 const state={content,requests:[],attachment:'PDF00001'};
 const host=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');state.requests.push(url.pathname);
  res.setHeader('Content-Type','application/json');res.setHeader('Zotero-Server-ID','FULLTEXTTEST');
  if(url.pathname.endsWith('/PAPER001/fulltext')){res.statusCode=404;res.end('"Not indexed"');return;}
  if(url.pathname.endsWith('/PAPER001/children')){res.end(JSON.stringify([{key:state.attachment,data:{itemType:'attachment'}}]));return;}
  res.end(JSON.stringify({content:state.content,indexedPages:120,totalPages:121}));
 });
 await new Promise(r=>host.listen(0,'127.0.0.1',r));
 const native=await createNativeBridge({baseUrl:`http://127.0.0.1:${host.address().port}`});
 const server=createServer(async()=>{throw new Error('Must not call plugin');},native);
 const client=new Client({name:'fulltext-pagination-tests',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 const call=(args)=>client.callTool({name:'zotero_get_item_fulltext',arguments:{itemKey:'PDF00001',...args}});
 try{await run(call,state,client);}finally{await client.close();await server.close();await native.close();await new Promise(r=>host.close(r));}
}
const data=result=>{assert.ok(!result.isError,result.content?.[0]?.text);return result.structuredContent;};

test('full text over 500000 units reconstructs exactly using the single public tool',async()=>{
 const text='中英Abé🙂\n'.repeat(70001);
 assert.ok(text.length>500000);
 await fixture(text,async(call,state,client)=>{
  const catalog=(await client.listTools()).tools;assert.equal(catalog.length,43);
  const schema=catalog.find(t=>t.name==='zotero_get_item_fulltext');assert.ok(schema.inputSchema.properties.offset);assert.ok(schema.outputSchema.properties.nextOffset);
  let offset=0,revision,joined='',chunks=0;
  do{
   const part=data(await call({offset,maxCharacters:50000,...(revision?{expectedRevision:revision}:{})}));
   assert.equal(part.offset,offset);assert.equal(part.returnedCharacters,part.content.length);assert.equal(part.totalCharacters,text.length);
   assert.equal(part.indexedPages,120);assert.equal(part.totalPages,121);assert.ok(part.content.isWellFormed());
   assert.equal(part.hasMore,part.nextOffset!==null);joined+=part.content;revision=part.revision;chunks++;
   if(part.nextOffset!==null)assert.equal(part.nextOffset,offset+part.content.length);
   offset=part.nextOffset;
  }while(offset!==null);
  assert.ok(chunks>10);assert.equal(joined,text);
  assert.ok(state.requests.every(p=>p==='/api/users/0/items/PDF00001/fulltext'));
 });
});

test('chunk boundary does not split Unicode; EOF, empty text and invalid offsets are explicit',async()=>{
 await fixture('a'.repeat(99)+'🙂END',async(call,state)=>{
  const first=data(await call({maxCharacters:100}));assert.equal(first.content,'a'.repeat(99));assert.equal(first.nextOffset,99);
  const last=data(await call({offset:99,maxCharacters:100,expectedRevision:first.revision}));assert.equal(last.content,'🙂END');assert.equal(last.nextOffset,null);assert.equal(last.hasMore,false);
  const eof=data(await call({offset:state.content.length}));assert.equal(eof.content,'');assert.equal(eof.nextOffset,null);
  assert.equal((await call({offset:100})).isError,true); // middle of the pair
  assert.equal((await call({offset:state.content.length+1})).isError,true);
  const count=state.requests.length;
  for(const offset of [-1,0.1,Number.MAX_SAFE_INTEGER+1])assert.equal((await call({offset})).isError,true);
  assert.equal(state.requests.length,count); // schema validation before HTTP
  state.content='';const empty=data(await call({}));assert.equal(empty.totalCharacters,0);assert.equal(empty.content,'');assert.equal(empty.nextOffset,null);assert.equal(empty.truncated,false);
 });
});

test('parent/group lookup retained and changed text or attachment is rejected with revision',async()=>{
 await fixture('x'.repeat(201),async(call,state)=>{
  const first=data(await call({itemKey:'PAPER001',groupId:42,maxCharacters:100}));assert.equal(first.attachmentKey,'PDF00001');assert.equal(first.nextOffset,100);
  assert.ok(state.requests.includes('/api/groups/42/items/PAPER001/children'));
  const next=data(await call({itemKey:first.attachmentKey,groupId:42,offset:first.nextOffset,maxCharacters:100,expectedRevision:first.revision}));assert.equal(next.content,'x'.repeat(100));
  state.content='y'+state.content.slice(1);
  const changed=await call({groupId:42,offset:100,expectedRevision:first.revision});assert.equal(changed.isError,true);assert.match(changed.content[0].text,/changed/);
  state.content='x'.repeat(201);state.attachment='PDF00002';
  assert.equal((await call({itemKey:'PAPER001',groupId:42,offset:100,expectedRevision:first.revision})).isError,true);
 });
});

test('existing calls without offset retain prefix behavior and default chunk size',async()=>{
 await fixture('x'.repeat(50010),async(call)=>{
  const first=data(await call({}));assert.equal(first.content.length,50000);assert.equal(first.offset,0);assert.equal(first.truncated,true);assert.equal(first.nextOffset,50000);
  const complete=data(await call({maxCharacters:500000}));assert.equal(complete.content.length,50010);assert.equal(complete.truncated,false);assert.equal(complete.nextOffset,null);
 });
});
