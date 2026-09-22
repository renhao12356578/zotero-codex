import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import Core from '../addon/content/core.js';
import contract from '../addon/content/mcp-schema.js';

async function fixture() {
  let markdown = '# Title\n\nFirst **paragraph**.\nLast line.', active = true, mode = true, html = '<h1>Title</h1>', syncStatus;
  let failSync = false;
  const files = new Map(), hash = x => createHash('md5').update(x).digest('hex');
  const note = {id:1,libraryID:1,key:'NOTE0001',version:0,isNote:()=>true,isEditable:()=>true,getNote:()=>html,getNoteTitle:()=> 'Title'};
  const editor = {_item:note};
  const api = {
    editor:{getEditorInstance:()=>active ? editor : null,isMarkdownMode:()=>mode,getMarkdownSource:()=>markdown,
      setMarkdownSource:(e,s)=>{markdown=s;return true;},toggleMarkdownMode:async()=>{mode=!mode;}},
    sync:{isSyncNote:()=>Boolean(syncStatus),getSyncStatus:()=>syncStatus,getMDStatusFromContent:s=>JSON.parse(s),
      getMDFileName:async()=> 'Title-NOTE0001.md',removeSyncNote:()=>{syncStatus=undefined;}},
    $export:{syncMDBatch:async(dir)=>{
      const raw=JSON.stringify({meta:{$version:note.version,$libraryID:1,$itemKey:note.key},content:html});
      files.set(dir+'/Title-NOTE0001.md',raw);
      syncStatus={path:dir,filename:'Title-NOTE0001.md',noteMd5:hash(html),md5:hash(html),lastsync:Date.now()};
    }},
    note:{getLinesInNote:async n=>[n.getNote()],getNoteTreeFlattened:async()=>[{model:{id:0,name:'Title',level:1,lineIndex:0,endIndex:0},parent:{model:{id:-1}}}]},
    relation:{getNoteLinkInboundRelation:async()=>[{fromKey:'OTHER001'}],getNoteLinkOutboundRelation:async()=>[{toKey:'OTHER002'}]},
    convert:{html2md:async s=>s.replace(/<[^>]+>/g,''),md2html:async s=>'<p>'+s+'</p>'}
  };
  const Zotero = {BetterNotes:{api,hooks:{onOpenNote:async()=>{active=true;},onSyncing:async()=>{
    if(failSync)return;
    const md=JSON.parse(files.get('/notes/Title-NOTE0001.md'));
    if(hash(md.content)!==syncStatus.md5)html=md.content;
    await api.$export.syncMDBatch('/notes');
  }}},Items:{getByLibraryAndKey:()=>note},ItemTypes:{getName:()=> 'note'},Libraries:{get:()=>({libraryType:'user'})},Notes:{_editorInstances:[]},
    Utilities:{Internal:{md5:hash}},Prefs:{get:()=>'/connection.json'},Server:{init:async()=>{},Endpoints:{},port:23119},
    getMainWindows:()=>[],ItemPaneManager:{registerSection:()=> 'section',unregisterSection:()=>{}},Reader:{registerEventListener:()=>{},unregisterEventListener:()=>{}}};
  const IOUtils={writeUTF8:async(p,s)=>{files.set(p,s);},setPermissions:async()=>{},remove:async()=>{},exists:async p=>files.has(p),readUTF8:async p=>files.get(p),stat:async p=>({type:p==='/notes'?'directory':'regular',size:files.get(p)?.length||0})};
  const scope=vm.createContext({Zotero,ZoteroCodexCore:Core,ZoteroMCPContract:contract,Services:{uuid:{generateUUID:()=>randomUUID()}},PathUtils:{join:(...s)=>s.join('/')},IOUtils,Components:{utils:{waiveXrays:x=>x}}});
  vm.runInContext(await readFile(new URL('../addon/content/plugin.js',import.meta.url),'utf8'),scope);
  await scope.ZoteroCodex.start();
  const ref={libraryID:1,key:'NOTE0001'};
  return {api,ref,files,note,call:(name,args={})=>Zotero.ZoteroCodex.dispatch('zotero_'+name,args),setMarkdown:s=>{markdown=s;},setHTML:s=>{html=s;},close:()=>{active=false;},failSync:()=>{failSync=true;}};
}

test('Markdown patches keep syntax and blank lines, reject overlapping/out-of-bounds edits',()=>{
  const text='# Heading\n\n**bold**\nlast';
  assert.equal(Core.editMarkdown(text,[{operation:'replace',startLine:3,endLine:3,newText:'- item\n- item2'},{operation:'insert',startLine:5,newText:'tail'}]),'# Heading\n\n- item\n- item2\nlast\ntail');
  assert.equal(Core.editMarkdown(text,[{oldText:'**bold**\nlast',newText:'$x$'}]),'# Heading\n\n$x$');
  assert.equal(Core.editMarkdown('a',[{operation:'delete',startLine:1,endLine:1}]),'');
  for(const edits of [
    [{operation:'replace',startLine:2,endLine:99,newText:'x'}],
    [{operation:'delete',startLine:2,endLine:3},{operation:'insert',startLine:3,newText:'x'}],
    [{operation:'insert',startLine:2,newText:'x'},{oldText:'last',newText:'z'}],
    [{oldText:'missing',newText:'x'}]
  ]) assert.throws(()=>Core.editMarkdown(text,edits));
});
test('live Markdown edit/read roundtrip, replay, conflicts and full source replacement',async()=>{
 const f=await fixture();
 const before=await f.call('read_note',{note:f.ref});
 assert.equal(before.format,'markdown');assert.equal(before.lineCount,4);
 const args={note:f.ref,revision:before.revision,requestID:'edit',edits:[{oldText:'First **paragraph**.\nLast line.',newText:'## Results\n- Finding'}]};
 const result=await f.call('edit_note',args);
 assert.equal(result.snapshot.text,'# Title\n\n## Results\n- Finding');assert.equal(result.persistence,'autosave-scheduled');
 assert.equal((await f.call('edit_note',args)).replayed,true);
 await assert.rejects(f.call('edit_note',{...args,requestID:'stale'}),/变化/);
 const next=await f.call('read_note',{note:f.ref});f.setMarkdown('human edit');
 await assert.rejects(f.call('set_note_markdown',{note:f.ref,revision:next.revision,requestID:'human-conflict',markdown:'wrong'}),/变化/);
 assert.equal((await f.call('read_note',{note:f.ref})).text,'human edit');
 const fresh=await f.call('read_note',{note:f.ref});
 const set={note:f.ref,revision:fresh.revision,requestID:'set',markdown:''};
 assert.equal((await f.call('set_note_markdown',set)).snapshot.text,'');
 assert.equal((await f.call('set_note_markdown',set)).replayed,true);
 await assert.rejects(f.call('set_note_markdown',{...set,markdown:'different'}),/requestID/);
 await assert.rejects(f.call('write_note',{note:f.ref,revision:fresh.revision,requestID:'append',text:'x',mode:'append'}),/Markdown 模式/);
});
test('saved outline, link directions and conversion use Better Notes adapters',async()=>{
 const f=await fixture();
 const structure=await f.call('get_note_structure',{note:f.ref});
 assert.equal(structure.source,'saved-note');assert.equal(structure.outline[0].startLine,1);
 assert.equal((await f.call('get_note_relations',{note:f.ref,direction:'inbound'})).links[0].fromKey,'OTHER001');
 assert.equal((await f.call('get_note_relations',{note:f.ref,direction:'outbound'})).links[0].toKey,'OTHER002');
 assert.equal((await f.call('convert_note_content',{from:'html',content:'<p>hello</p>'})).content,'hello');
});
test('sync enable refuses open editors/existing files, imports MD, detects conflicts, preserves file on disable',async()=>{
 const f=await fixture();
 let status=await f.call('get_note_sync',{note:f.ref});
 await assert.rejects(f.call('sync_note',{note:f.ref,action:'enable',directory:'/notes',syncRevision:status.syncRevision,requestID:'open'}),/关闭/);
 f.close();f.files.set('/notes/Title-NOTE0001.md','existing');
 await assert.rejects(f.call('sync_note',{note:f.ref,action:'enable',directory:'/notes',syncRevision:status.syncRevision,requestID:'exists'}),/存在/);
 f.files.delete('/notes/Title-NOTE0001.md');
 const enabled=await f.call('sync_note',{note:f.ref,action:'enable',directory:'/notes',syncRevision:status.syncRevision,requestID:'enable'});
 assert.equal(enabled.status.enabled,true);assert.equal(enabled.status.conflict,false);
 let md=JSON.parse(f.files.get('/notes/Title-NOTE0001.md'));md.content='external edit';f.files.set('/notes/Title-NOTE0001.md',JSON.stringify(md));
 await assert.rejects(f.call('sync_note',{note:f.ref,action:'sync',syncRevision:enabled.status.syncRevision,requestID:'stale-sync'}),/变化/);
 status=await f.call('get_note_sync',{note:f.ref});assert.equal(status.fileChanged,true);
 const synced=await f.call('sync_note',{note:f.ref,action:'sync',syncRevision:status.syncRevision,requestID:'sync'});
 assert.equal(synced.status.fileChanged,false);assert.equal(f.note.getNote(),'external edit');
 md=JSON.parse(f.files.get('/notes/Title-NOTE0001.md'));md.content='file second edit';f.files.set('/notes/Title-NOTE0001.md',JSON.stringify(md));f.setHTML('note second edit');
 status=await f.call('get_note_sync',{note:f.ref});assert.equal(status.conflict,true);
 await assert.rejects(f.call('sync_note',{note:f.ref,action:'sync',syncRevision:status.syncRevision,requestID:'conflict'}),/冲突/);
 const disabled=await f.call('sync_note',{note:f.ref,action:'disable',syncRevision:status.syncRevision,requestID:'disable'});
 assert.equal(disabled.status.enabled,false);assert.equal(f.files.has('/notes/Title-NOTE0001.md'),true);
});
test('upstream silent sync failure must not report success',async()=>{
 const f=await fixture();f.close();let s=await f.call('get_note_sync',{note:f.ref});
 await f.call('sync_note',{note:f.ref,action:'enable',directory:'/notes',syncRevision:s.syncRevision,requestID:'enable'});
 f.setHTML('new note');f.failSync();s=await f.call('get_note_sync',{note:f.ref});
 await assert.rejects(f.call('sync_note',{note:f.ref,action:'sync',syncRevision:s.syncRevision,requestID:'fail'}),/未完成/);
});
test('new API schemas restrict methods and require write revisions',()=>{
 for(const name of ['set_note_mode','set_note_markdown','sync_note'])assert.throws(()=>contract.validateCall('zotero_'+name,{note:{libraryID:1,key:'NOTE0001'}}));
 assert.throws(()=>contract.validateCall('zotero_convert_note_content',{from:'javascript',content:'code'}));
 assert.equal(contract.tools.length,16);
});
