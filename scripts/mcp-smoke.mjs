// Read-only by default. Optional isolated-fixture flag tests a real write end to end.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const file=process.argv[2];
if(!file) throw new Error('Usage: node scripts/mcp-smoke.mjs <connection.json> [isolated-base]');
const client=new Client({name:'zotero-mcp-smoke',version:'0.5.0'});
const base=process.argv[3];
if(base && (!base.includes('/zotero-codex-host-')||file!==base+'/connection.json'))throw new Error('Writes require isolated fixture');
const env=base ? {ZOTERO_LOCAL_BASE_URL:new URL(JSON.parse(await readFile(file,'utf8')).url).origin,ZOTERO_LOCAL_KEY_STORE:base+'/native-keys.json'} : undefined;
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url)),'--connection-file',file],stderr:'pipe',env});
const checks=[],toolsCalled=new Set();
const call=async(name,args={})=>{toolsCalled.add('zotero_'+name);const r=await client.callTool({name:'zotero_'+name,arguments:args});if(r.isError)throw new Error(r.content[0].text);return r;};
const data=r=>JSON.parse(r.content[0].text);
try {
 await client.connect(transport);
 checks.push({name:'stdio-tools-list',pass:(await client.listTools()).tools.length===43});
 checks.push({name:'real-host-status',pass:data(await call('status')).ready});
 const catalog=(await client.listTools()).tools;
 checks.push({name:'catalog-has-only-canonical-tools',pass:new Set(catalog.map(t=>t.name)).size===43 && !catalog.some(t=>t.name.startsWith('zotero_library_')||t.name==='zotero_get_fulltext')});
 const state=data(await call('get_context'));checks.push({name:'real-host-context',pass:'openedNotes' in state});
 if(base){
  if(!base.includes('/zotero-codex-host-')||file!==base+'/connection.json')throw new Error('Writes require isolated fixture');
  const fixtures=JSON.parse(await readFile(base+'/fixtures.json','utf8'));
  checks.push({name:'stdio-search',pass:data(await call('search_items',{q:'MCP synthetic fixture'})).items.some(i=>i.key===fixtures.paper.key)});
  checks.push({name:'stdio-item',pass:data(await call('get_item',{itemKey:fixtures.paper.key,includeChildren:true})).children.some(i=>i.key===fixtures.note.key)});
  checks.push({name:'stdio-fulltext',pass:data(await call('get_item_fulltext',{itemKey:fixtures.attachment.key})).content.length>0});
  const full=data(await call('get_item_fulltext',{itemKey:fixtures.attachment.key,maxCharacters:500000}));
  let offset=0,joined='';
  do {
    const part=data(await call('get_item_fulltext',{itemKey:full.attachmentKey,offset,maxCharacters:1000,expectedRevision:full.revision}));
    joined+=part.content;offset=part.nextOffset;
  } while(offset!==null);
  checks.push({name:'native-fulltext-pagination-exact-reassembly',pass:!full.truncated && joined===full.content});
  const eof=data(await call('get_item_fulltext',{itemKey:full.attachmentKey,offset:full.totalCharacters,expectedRevision:full.revision}));
  checks.push({name:'native-fulltext-eof',pass:eof.content==='' && eof.nextOffset===null});
  checks.push({name:'stdio-annotations',pass:data(await call('get_annotations',{attachment:fixtures.attachment})).annotations.length===1});
  const selection=await call('get_selection',{readerID:fixtures.readerID});checks.push({name:'stdio-image-content',pass:selection.content.some(c=>c.type==='image')});
  const before=data(await call('read_note',{note:fixtures.note}));
  const args={note:fixtures.note,revision:before.revision,requestID:randomUUID(),text:'End-to-end MCP stdio answer '+randomUUID()+'.',mode:'append'};
  await call('write_note',args);await call('write_note',args);
  const after=data(await call('read_note',{note:fixtures.note}));checks.push({name:'stdio-note-write-and-deduplication',pass:after.text.split(args.text).length===2});
  checks.push({name:'upstream-native-file-path',pass:data(await call('get_attachment_path',{itemKey:fixtures.attachment.key})).attachments[0].path.endsWith('.pdf')});
  const pdf=await call('read_pdf',{itemKey:fixtures.attachment.key,startPage:1,pageCount:1,includeImage:true});
  checks.push({name:'actual-pdf-text-and-page-image',pass:data(pdf).pages[0].text.includes('Gutenberg') && pdf.content.some(c=>c.type==='image')});
  const item=data(await call('get_item',{itemKey:fixtures.paper.key}));
  const updated=data(await call('update_item',{itemKey:fixtures.paper.key,expectedVersion:item.item.version,fields:{abstractNote:'Updated by reused upstream handler.'}}));
  checks.push({name:'upstream-native-update-item',pass:updated.updated});
  const creation=data(await call('create_items',{items:[{itemType:'note',parentItem:fixtures.paper.key,note:'<div data-schema-version="9"><p>Native created paragraph.</p></div>'}]}));
  const key=creation.created[0]?.key;
  checks.push({name:'upstream-native-create-note',pass:Boolean(key)&&creation.failures.length===0});
  const resolved=data(await call('resolve_item',{itemKey:key}));
  const note={libraryID:resolved.item.libraryID,key};
  const live=data(await call('read_note',{note,openEditor:true}));
  const edit={note,revision:live.revision,requestID:randomUUID(),edits:[{oldText:'Native created paragraph.',newText:'Edited via live Zotero document.'}]};
  await call('edit_note',edit);const replay=data(await call('edit_note',edit));
  const edited=data(await call('read_note',{note}));
  checks.push({name:'native-note-to-live-edit-and-deduplication',pass:edited.text.includes('Edited via live Zotero document.')&&replay.replayed});
  await writeFile(base+'/mcp-result.json',JSON.stringify({checks,toolsCalled:[...toolsCalled].sort()},null,2));
 }
 console.log(JSON.stringify({checks,toolsCalled:[...toolsCalled].sort()},null,2));
 if(checks.some(c=>!c.pass))process.exitCode=1;
} finally {await client.close();}
