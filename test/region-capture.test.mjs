import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Core from '../addon/content/core.js';
import contract from '../addon/content/mcp-schema.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=';
async function fixture(t) {
 const items=new Map(),readers=[{itemID:1,tabID:'one',_instanceID:'instance-one'},{itemID:2,tabID:'two',_instanceID:'instance-two'}],pending=[];
 let observer,unregistered=false;
 for(const id of [1,2])items.set(id,{id,key:'PDF0000'+id,libraryID:1,isAttachment:()=>true,getField:()=> 'Fixture'});
 const Zotero={Items:{get:id=>items.get(Number(id)),getByLibraryAndKeyAsync:async(lib,key)=>[...items.values()].find(i=>i.key===key)},
  Libraries:{get:()=>({libraryType:'user'})},Annotations:{toJSON:async item=>({key:item.key,type:'image',pageLabel:'1',position:{pageIndex:0,rects:[[0,0,20,20]]},image:item.image})},
  Reader:{_readers:readers,getByTabID:id=>readers.find(r=>r.tabID===id),registerEventListener:()=>{},unregisterEventListener:()=>{}},
  Notifier:{registerObserver:o=>{observer=o;return 7;},unregisterObserver:id=>{assert.equal(id,7);unregistered=true;}},
  Promise:{delay:()=>new Promise(resolve=>pending.push(resolve))},Fulltext:{getItemCacheFile:()=>({path:'/none'})},
  Prefs:{get:()=>'/connection'},Server:{init:async()=>{},Endpoints:{}},getMainWindows:()=>[],getMainWindow:()=>({Zotero_Tabs:{selectedID:'one'}}),
  ItemPaneManager:{registerSection:()=> 'panel',unregisterSection:()=>{}},logError:error=>{throw error;}};
 const scope=vm.createContext({Zotero,ZoteroCodexCore:Core,ZoteroMCPContract:contract,Services:{uuid:{generateUUID:()=>randomUUID()},wm:{getMostRecentWindow:()=>null}},IOUtils:{writeUTF8:async()=>{},setPermissions:async()=>{},remove:async()=>{},exists:async()=>false},PathUtils:{join:(...s)=>s.join('/')}});
 vm.runInContext(await readFile(new URL('../addon/content/plugin.js',import.meta.url),'utf8'),scope);
 await scope.ZoteroCodex.start();
 t.after(async()=>{await scope.ZoteroCodex.stop();pending.splice(0).forEach(resolve=>resolve());});
 const add=(id,{reader=readers[0],ready=true,local=true,type='image'}={})=>{
  const item={id,key:'REG'+String(id).padStart(5,'0'),parentID:reader.itemID,libraryID:1,isAnnotation:()=>true,annotationType:type,image:ready?image:undefined};items.set(id,item);
  const returned=observer.notify('add','item',[id],local?{[id]:{instanceID:reader._instanceID}}:{});
  assert.equal(returned,undefined,'notifier must not await screenshot readiness');return item;
 };
 const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));pending.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));};
 return {add,tick,readers,items,read:(readerID='one')=>Zotero.ZoteroCodex.dispatch('zotero_get_selection',{readerID}),capture:(annotation)=>Zotero.ZoteroCodex.capture(readers[0],annotation),stop:()=>scope.ZoteroCodex.stop(),unregistered:()=>unregistered};
}
test('reader-created region captures screenshot and source automatically, without dragging',async t=>{
 const f=await fixture(t),item=f.add(10);const r=await f.read();
 assert.equal(r.selection.image,image);assert.equal(r.selection.kind,'pdf-region');assert.match(r.selection.sourceURI,new RegExp('annotation='+item.key));
});
test('delayed older image cannot replace a newer region, including an in-flight read',async t=>{
 const f=await fixture(t),older=f.add(10,{ready:false});const read=f.read();await new Promise(r=>setImmediate(r));
 const latest=f.add(11);older.image=image;await f.tick();
 assert.match((await read).selection.sourceURI,new RegExp(latest.key));assert.match((await f.read()).selection.sourceURI,new RegExp(latest.key));
});
test('latest text selection wins over pending image and background imports are ignored',async t=>{
 const f=await fixture(t);f.add(10,{ready:false});await f.capture({text:'latest text',pageLabel:'1',position:{pageIndex:0}});
 f.add(11,{local:false});f.add(12,{type:'highlight'});await f.tick();assert.equal((await f.read()).selection.text,'latest text');
});
test('captures remain isolated by source reader and wait for generated image',async t=>{
 const f=await fixture(t),item=f.add(10,{reader:f.readers[1],ready:false});
 await assert.rejects(f.read(),/没有选区/);let done=false;const read=f.read('two').then(r=>{done=true;return r;});
 await f.tick();assert.equal(done,false);item.image=image;await f.tick();assert.equal((await read).selection.attachmentKey,'PDF00002');
});
test('missing image times out clearly; shutdown unregisters and cancels pending capture',async t=>{
 const f=await fixture(t);f.add(10,{ready:false});const failure=assert.rejects(f.read(),/截图仍在生成/);
 for(let i=0;i<41;i++)await f.tick();await failure;
 f.add(11,{ready:false});await f.stop();await f.tick();assert.equal(f.unregistered(),true);
});
