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
 let observer,unregistered=false,listener,registeredPane,removedPane;
 const prefs=new Map(),files=new Map();
 prefs.set('extensions.zotero-codex.mcpConnectionFile','/private/profile/connection.json');
 prefs.set('httpServer.localAPI.enabled',true);
 for(const id of [1,2])items.set(id,{id,key:'PDF0000'+id,libraryID:1,isAttachment:()=>true,getField:()=> 'Fixture'});
 const Zotero={Items:{get:id=>items.get(Number(id)),getByLibraryAndKeyAsync:async(lib,key)=>[...items.values()].find(i=>i.key===key)},
  Libraries:{get:()=>({libraryType:'user'})},Annotations:{toJSON:async item=>({key:item.key,type:'image',pageLabel:'1',position:{pageIndex:0,rects:[[0,0,20,20]]},image:item.image})},
  Reader:{_readers:readers,getByTabID:id=>readers.find(r=>r.tabID===id),registerEventListener:(name,fn)=>{listener=fn;},unregisterEventListener:()=>{}},
  Notifier:{registerObserver:o=>{observer=o;return 7;},unregisterObserver:id=>{assert.equal(id,7);unregistered=true;}},
  Promise:{delay:()=>new Promise(resolve=>pending.push(resolve))},Fulltext:{getItemCacheFile:()=>({path:'/none'})},
  Prefs:{get:key=>prefs.get(key),set:(key,value)=>prefs.set(key,value)},Server:{init:async()=>{},Endpoints:{},port:23119},
  PreferencePanes:{register:async options=>{registeredPane=options;return options.id;},unregister:id=>{removedPane=id;}},
  HTTP:{request:async(method,url)=>({status:method==='POST'?200:prefs.get('httpServer.localAPI.enabled')?200:403})},getMainWindows:()=>[],getMainWindow:()=>({Zotero_Tabs:{selectedID:'one'}}),
  ItemPaneManager:{registerSection:()=> 'panel',unregisterSection:()=>{}},logError:error=>{throw error;}};
 const scope=vm.createContext({ZoteroMCPRuntime:{start(){},stop(){},state(){return {};}},Zotero,ZoteroCodexCore:Core,ZoteroMCPContract:contract,Services:{uuid:{generateUUID:()=>randomUUID()},wm:{getMostRecentWindow:()=>null}},IOUtils:{writeUTF8:async(p,s)=>files.set(p,s),setPermissions:async()=>{},remove:async p=>files.delete(p),exists:async p=>files.has(p),stat:async()=>({type:'regular'})},PathUtils:{join:(...s)=>s.join('/'),isAbsolute:p=>p.startsWith('/')}});
 vm.runInContext(await readFile(new URL('../addon/content/plugin.js',import.meta.url),'utf8'),scope);
 await scope.ZoteroCodex.start();
 t.after(async()=>{await scope.ZoteroCodex.stop();pending.splice(0).forEach(resolve=>resolve());});
 const add=(id,{reader=readers[0],ready=true,local=true,type='image'}={})=>{
  const item={id,key:'REG'+String(id).padStart(5,'0'),parentID:reader.itemID,libraryID:1,isAnnotation:()=>true,annotationType:type,image:ready?image:undefined};items.set(id,item);
  const returned=observer.notify('add','item',[id],local?{[id]:{instanceID:reader._instanceID}}:{});
  assert.equal(returned,undefined,'notifier must not await screenshot readiness');return item;
 };
 const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));pending.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));};
 const popup=()=>{
   const button={textContent:'',events:{},addEventListener:(name,fn)=>{button.events[name]=fn;}};
   listener({reader:readers[0],params:{annotation:{text:'selected text',pageLabel:'1',position:{pageIndex:0}}},doc:{createElementNS:()=>button},append:()=>{}});
   return button;
 };
 const request=(data,authorized=true)=>new Zotero.Server.Endpoints['/zotero-codex/mcp']().init({headers:{authorization:authorized?'Bearer '+JSON.parse(files.get('/private/profile/connection.json')).token:'invalid'},data});
 return {prefs,files,popup,request,settings:Zotero.ZoteroCodex.settings,registeredPane:()=>registeredPane,removedPane:()=>removedPane,restart:()=>scope.ZoteroCodex.start(),add,tick,readers,items,read:(readerID='one')=>Zotero.ZoteroCodex.dispatch('zotero_get_selection',{readerID}),capture:(annotation)=>Zotero.ZoteroCodex.capture(readers[0],annotation),stop:()=>scope.ZoteroCodex.stop(),unregistered:()=>unregistered};
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
test('capture preferences persist, clear disabled automatic snapshots, and preserve manual capture',async t=>{
 const f=await fixture(t);
 assert.equal(f.settings.state().autoText,true);assert.equal(f.settings.state().autoRegion,true);
 assert.equal(f.registeredPane().label,'Zotero MCP');
 f.add(10);await f.read();f.settings.setCapturePreference('autoRegion',false);
 await assert.rejects(f.read(),/没有选区/);f.add(11);await assert.rejects(f.read(),/没有选区/);
 f.settings.setCapturePreference('autoText',false);const button=f.popup();await f.tick();await assert.rejects(f.read(),/没有选区/);
 assert.equal(button.textContent,'添加到 MCP');button.events.click();await f.tick();assert.equal((await f.read()).selection.text,'selected text');
 f.settings.setCapturePreference('autoText',false);assert.equal((await f.read()).selection.text,'selected text');
 f.settings.clearContext();await assert.rejects(f.read(),/没有选区/);
 await f.stop();assert.equal(f.removedPane(),'zotero-codex-preferences');await f.restart();
 assert.equal(f.settings.state().autoRegion,false);assert.equal(f.settings.state().autoText,false);
 f.settings.setCapturePreference('autoText',true);f.popup();await f.tick();assert.equal((await f.read()).selection.text,'selected text');
 f.settings.setCapturePreference('autoText',false);await assert.rejects(f.read(),/没有选区/);
});
test('disable and clear cancel pending regions even when a selection read is in progress',async t=>{
 const f=await fixture(t),item=f.add(10,{ready:false});
 const result=assert.rejects(f.read(),/没有选区/);await new Promise(r=>setImmediate(r));
 f.settings.setCapturePreference('autoRegion',false);item.image=image;await f.tick();await result;
 f.settings.setCapturePreference('autoRegion',true);const second=f.add(11,{ready:false});
 f.settings.clearContext();second.image=image;await f.tick();await assert.rejects(f.read(),/没有选区/);
});
test('settings distinguish authenticated client activity, redact diagnostics and copy usable configuration',async t=>{
 const f=await fixture(t),settings=f.settings;
 assert.equal(settings.state().lastRequestAt,null);
 await f.request({name:'zotero_status',arguments:{}},false);assert.equal(settings.state().lastRequestAt,null);
 await f.request({name:'zotero_status',arguments:{},source:'preferences-diagnostic'});assert.equal(settings.state().lastRequestAt,null);
 const client={version:'0.6.1',nodePath:'/private/node',serverPath:'/private/project/mcp/server.mjs'};
 await f.request({name:'zotero_status',arguments:{},client});
 assert.ok(settings.state().lastRequestAt);assert.equal(settings.state().serverVersion,'0.6.1');
 const at=settings.state().lastRequestAt;f.files.set(client.nodePath,'node');f.files.set(client.serverPath,'server');
 const config=JSON.parse(await settings.connectionConfig());assert.equal(config.mcpServers.zotero.command,client.nodePath);
 assert.deepEqual(config.mcpServers.zotero.args,[client.serverPath,'--connection-file','/private/profile/connection.json']);
 assert.ok(!JSON.stringify(config).includes('token'));
 f.prefs.set('httpServer.localAPI.enabled',false);
 const report=await settings.diagnose();assert.equal(report.nativeAPI.status,403);assert.equal(report.bridge.ok,true);
 assert.equal(settings.state().lastRequestAt,at);
 const encoded=JSON.stringify(report);assert.ok(!encoded.includes('/private'));assert.ok(!encoded.includes('token'));
 assert.ok(!encoded.includes(JSON.parse(f.files.get('/private/profile/connection.json')).token));
 await assert.rejects(settings.connectionConfig({nodePath:'node',serverPath:'/missing/server.mjs'}),/完整路径/);
 const originalPrefs=[...f.prefs];
 f.files.set('/custom/server.mjs','// custom service');
 const custom=JSON.parse(await settings.connectionConfig({nodePath:'node',serverPath:'/custom/server.mjs'}));
 assert.equal(custom.mcpServers.zotero.args[0],'/custom/server.mjs');
 assert.deepEqual([...f.prefs],originalPrefs,'exporting custom paths does not change managed preferences');
 assert.equal(JSON.parse(await settings.connectionConfig()).mcpServers.zotero.args[0],client.serverPath);
});
