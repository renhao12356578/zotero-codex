// Uses the real Reader annotation manager and PDF renderer in an isolated library.
(async()=>{
 const result={stage:'automatic-region-capture',checks:[]};
 const stage=async value=>IOUtils.writeUTF8(PathUtils.join(base,'stage.json'),JSON.stringify({stage:value}));
 const check=(name,pass)=>{result.checks.push({name,pass:Boolean(pass)});if(!pass)throw new Error(name);};
 try{
  if(Zotero.DataDirectory.dir!==PathUtils.join(base,'data'))throw new Error('isolated profile required');
  await Zotero.Promise.delay(2000);
  const paper=new Zotero.Item('journalArticle');paper.setField('title','Automatic region fixture');await paper.saveTx();
  await stage('import-pdf');
  const attachment=await Zotero.Attachments.importFromFile({file:PathUtils.join(base,'sample.pdf'),parentItemID:paper.id});
  await stage('open-reader');
  const reader=await Zotero.Reader.open(attachment.id);await stage('wait-reader');await reader._initPromise;await reader._internalReader._primaryView.initializedPromise;
  const internal=reader._internalReader;
  const add=rect=>internal._annotationManager.addAnnotation(Components.utils.cloneInto({type:'image',color:'#ffd400',pageLabel:'1',sortIndex:'00000|000000|00000',position:{pageIndex:0,rects:[rect]}},reader._iframeWindow));
  await stage('create-region');
  const annotation=add([60,400,300,650]);
  await stage('wait-auto-capture');
  let selected;
  for(let i=0;i<100;i++){
   try{selected=await Zotero.ZoteroCodex.dispatch('zotero_get_selection',{readerID:String(reader.tabID)});if(selected.selection.sourceURI.includes(annotation.id))break;}catch{}
   await Zotero.Promise.delay(100);
  }
  check('reader-region-auto-captured-without-drop',selected?.selection.sourceURI.includes(annotation.id));
  check('real-pdf-region-image',selected.selection.image?.startsWith('data:image/png;base64,')&&selected.selection.image.length>1000);
  check('region-page-and-source',selected.selection.pageLabel==='1'&&selected.selection.position.pageIndex===0&&selected.selection.attachmentKey===attachment.key);
  const firstImage=selected.selection.image;
  const second=add([70,410,180,540]);
  for(let i=0;i<100;i++){
   selected=await Zotero.ZoteroCodex.dispatch('zotero_get_selection',{readerID:String(reader.tabID)});
   if(selected.selection.sourceURI.includes(second.id))break;
   await Zotero.Promise.delay(100);
  }
  check('new-region-replaces-previous',selected.selection.sourceURI.includes(second.id));
  check('different-region-different-image',selected.selection.image?.length>1000&&selected.selection.image!==firstImage);
  await IOUtils.writeUTF8(PathUtils.join(base,'region-fixtures.json'),JSON.stringify({readerID:String(reader.tabID),annotationKey:second.id}));
 }catch(error){result.error=String(error);result.stack=error.stack;}
 await IOUtils.writeUTF8(PathUtils.join(base,'result.json'),JSON.stringify(result,null,2));
})();
