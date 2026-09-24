import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeBridge } from '../mcp/native.mjs';
import { readPDF, readZoteroPDF } from '../mcp/pdf.mjs';
import { startMockZotero } from '../vendor/zotero-native-mcp/test-utils/mock-zotero.mjs';

test('vendored sources match the pinned baseline plus declared pagination patch', async () => {
 const base=new URL('../vendor/zotero-native-mcp/',import.meta.url);
 const provenance=JSON.parse(await readFile(new URL('UPSTREAM.json',base)));
 for(const [file,hash] of Object.entries({...provenance.sourceSHA256,...provenance.modifiedSourceSHA256})) assert.equal(createHash('sha256').update(await readFile(new URL(file,base))).digest('hex'),hash,file);
});
test('all 28 original tools run through their SDK; default inputs and guarded note edits', async () => {
 const mock=await startMockZotero(),dir=await mkdtemp(join(tmpdir(),'native-reuse-test-'));
 const native=await createNativeBridge({baseUrl:mock.baseUrl,keyStorePath:join(dir,'keys.json')});
 try{
  assert.equal(native.tools.length,28);assert.equal(new Set(native.tools.map(t=>t.name)).size,28);
  const result=await native.call('zotero_search_items',{});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.items[0].title,'Dune');
  const created=await native.call('zotero_create_items',{items:[{itemType:'note',note:'<p>new note</p>'}]});
  assert.equal(created.isError,undefined);assert.equal(mock.authorizeCount(),1);
  const before=mock.writes().length;
  const rejected=await native.call('zotero_update_item',{itemKey:'ABCD1234',fields:{note:'<p>overwrite</p>'},expectedVersion:1});
  assert.equal(rejected.isError,true);assert.match(rejected.content[0].text,/zotero_edit_note/);assert.equal(mock.writes().length,before);
  const updated=await native.call('zotero_update_item',{itemKey:'ABCD1234',fields:{title:'New title'},expectedVersion:1});
  assert.equal(updated.isError,undefined);assert.equal(mock.writes().length,before+1);
 }finally{await native.close();await mock.close();await rm(dir,{recursive:true,force:true});}
});
test('native connection rejects a remote API URL before any request', async()=>{
 await assert.rejects(createNativeBridge({baseUrl:'https://api.zotero.org'}),/loopback/);
});
test('PDF.js reads real PDF pages and emits a PNG with bounded dimensions', async()=>{
 const path=new URL('./fixtures/alice.pdf',import.meta.url);
 const result=await readPDF(path,{startPage:1,pageCount:1,includeImage:true});
 assert.equal(result.totalPages,29);assert.match(result.pages[0].text,/Gutenberg/);assert.equal(result.nextPage,2);
 const bytes=Buffer.from(result.pages[0].image.split(',')[1],'base64');
 assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.readUInt32BE(16)<=1800);assert.ok(bytes.readUInt32BE(20)<=1800);
 await assert.rejects(readPDF(path,{startPage:30,pageCount:1}),/超出范围/);
});
test('PDF reading uses upstream resolved attachment identity and rejects ambiguity', async()=>{
 const path=fileURLToPath(new URL('./fixtures/alice.pdf',import.meta.url));
 let count=1;
 const native={call:async(name,args)=>{
  assert.equal(name,'zotero_get_attachment_path');assert.equal(args.itemKey,'ABCD1234');
  return {structuredContent:{attachments:Array.from({length:count},()=>({attachmentKey:'EFGH5678',contentType:'application/pdf',path}))}};
 }};
 const result=await readZoteroPDF(native,{itemKey:'ABCD1234',groupId:123,pageCount:1});
 assert.equal(result.pages[0].sourceURI,'zotero://open-pdf/groups/123/items/EFGH5678?page=1');
 count=2;await assert.rejects(readZoteroPDF(native,{itemKey:'ABCD1234'}),/多个 PDF/);
});

test('one public implementation routes rich search, item children and fulltext through native API', async()=>{
 const {createServer: httpServer}=await import('node:http');
 const {createServer}=await import('../mcp/server.mjs');
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
 const requests=[];
 const http=httpServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url);
  res.setHeader('Content-Type','application/json');res.setHeader('Zotero-Server-ID','TESTSERVER01');res.setHeader('Total-Results','3');
  const item={key:'ABCD1234',version:2,data:{itemType:'journalArticle',title:'Native item'}};
  const body=url.pathname.endsWith('/fulltext') ? {content:'x'.repeat(150),indexedPages:1,totalPages:1} : url.pathname.endsWith('/items/ABCD1234') ? item : [item];
  res.end(JSON.stringify(body));
 });
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 const native=await createNativeBridge({baseUrl:`http://127.0.0.1:${http.address().port}`});
 let hostCalls=0;
 const server=createServer(async()=>{hostCalls++;throw new Error('Plugin unavailable');},native);
 const client=new Client({name:'merge-regression',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);
 try{
  const catalog=(await client.listTools()).tools;
  assert.equal(catalog.length,43);assert.equal(new Set(catalog.map(t=>t.name)).size,43);
  assert.ok(!catalog.some(t=>t.name.startsWith('zotero_library_')||t.name==='zotero_get_fulltext'));
  const call=(name,args)=>client.callTool({name,arguments:args});
  const search=await call('zotero_search_items',{q:'paper',qmode:'everything',groupId:123,collectionKey:'COLL0001',tag:'read',sort:'title',start:2,limit:1});
  assert.ok(!search.isError);assert.equal(search.structuredContent.nextStart,null);
  const url=requests.at(-1);assert.equal(url.pathname,'/api/groups/123/collections/COLL0001/items/top');
  for(const [key,value] of Object.entries({q:'paper',qmode:'everything',tag:'read',sort:'title',start:'2',limit:'1'}))assert.equal(url.searchParams.get(key),value);
  const item=await call('zotero_get_item',{itemKey:'ABCD1234',groupId:123,includeChildren:true});
  assert.equal(item.structuredContent.item.title,'Native item');assert.equal(item.structuredContent.children.length,1);
  assert.equal(requests.at(-1).pathname,'/api/groups/123/items/ABCD1234/children');
  const full=await call('zotero_get_item_fulltext',{itemKey:'ABCD1234',groupId:123,maxCharacters:100});
  assert.equal(full.structuredContent.content.length,100);assert.equal(full.structuredContent.truncated,true);assert.equal(full.structuredContent.totalCharacters,150);
  const count=requests.length;
  for(const name of ['zotero_library_search_items','zotero_get_fulltext'])assert.equal((await call(name,{})).isError,true);
  assert.equal(requests.length,count);assert.equal(hostCalls,0);
 }finally{await client.close();await server.close();await native.close();await new Promise(r=>http.close(r));}
});
