// Runs only against the synthetic library created by prepare-host-smoke.py.
(async () => {
 const result={version:'0.5.0',stage:'better-notes-api',checks:[]};
 const record=(name,pass)=>{result.checks.push({name,pass:Boolean(pass)});if(!pass)throw new Error('Failed: '+name);};
 try {
  if(Zotero.DataDirectory.dir!==PathUtils.join(base,'data'))throw new Error('Not an isolated library');
  const plugin=Zotero.ZoteroCodex,call=(name,args)=>plugin.dispatch('zotero_'+name,args);
  for(let i=0;i<50&&!Zotero.BetterNotes?.api;i++)await Zotero.Promise.delay(100);
  const api=Zotero.BetterNotes.api;
  const note=new Zotero.Item('note');note.setNote('<div data-schema-version="9"><h1>API fixture</h1><p>Original <strong>bold</strong> paragraph.</p><p>Last paragraph.</p></div>');await note.saveTx();
  const ref={libraryID:note.libraryID,key:note.key};
  let before=await call('read_note',{note:ref,openEditor:true});
  record('richtext-read',before.format==='richtext');
  let change=await call('set_note_mode',{note:ref,revision:before.revision,requestID:'mode-md',mode:'markdown'});
  record('switch-to-markdown',change.snapshot.format==='markdown'&&change.snapshot.text.includes('bold'));
  const source='# MCP Markdown\n\n**Bold** and [link](https://example.org).\n\n- one\n- two\n\n$x^2$';
  const set={note:ref,revision:change.snapshot.revision,requestID:'source-set',markdown:source};
  change=await call('set_note_markdown',set);
  record('set-source-readback',change.snapshot.text===source);
  record('set-source-dedup',(await call('set_note_markdown',set)).replayed);
  for(let i=0;i<80&&!note.getNote().includes('MCP Markdown');i++)await Zotero.Promise.delay(100);
  record('markdown-autosaves-to-note',note.getNote().includes('MCP Markdown')&&note.getNote().includes('<strong>Bold</strong>'));
  before=await call('read_note',{note:ref});
  const edits={note:ref,revision:before.revision,requestID:'source-patch',edits:[{operation:'replace',startLine:5,endLine:6,newText:'- revised one\n- revised two'}]};
  change=await call('edit_note',edits);
  record('markdown-line-patch',change.snapshot.text.includes('- revised one\n- revised two'));
  record('markdown-patch-replay',(await call('edit_note',edits)).replayed);
  before=await call('read_note',{note:ref});
  api.editor.setMarkdownSource(api.editor.getEditorInstance(note.id),change.snapshot.text+'\nHuman edit.');
  let rejected=false;try{await call('set_note_markdown',{note:ref,revision:before.revision,requestID:'stale',markdown:'wrong'});}catch{rejected=true;}
  record('unsaved-human-edit-conflict',rejected);
  before=await call('read_note',{note:ref});
  change=await call('set_note_mode',{note:ref,revision:before.revision,requestID:'mode-rich',mode:'richtext'});
  record('switch-back-richtext',change.snapshot.format==='richtext'&&change.snapshot.text.includes('Human edit.'));
  const structure=await call('get_note_structure',{note:ref});
  record('saved-outline',structure.outline.some(n=>n.title==='MCP Markdown')&&structure.lines.length>0);
  const markdown=await call('convert_note_content',{from:'html',content:'<h2>Convert</h2><p><strong>Bold</strong></p>'});
  record('html-to-markdown',markdown.content.includes('## Convert')&&markdown.content.includes('**Bold**'));
  const html=await call('convert_note_content',{from:'markdown',content:'## Convert\n\n**Bold**'});
  record('markdown-to-html',html.content.includes('<h2>Convert</h2>')&&html.content.includes('<strong>Bold</strong>'));
  for(const direction of ['inbound','outbound'])record('relations-'+direction,Array.isArray((await call('get_note_relations',{note:ref,direction})).links));
  // Separate unopened fixture for file sync; no active editor can be overwritten.
  const syncNote=new Zotero.Item('note');syncNote.setNote('<div data-schema-version="9"><h1>Sync fixture</h1><p>File original.</p></div>');await syncNote.saveTx();
  const syncRef={libraryID:syncNote.libraryID,key:syncNote.key};
  const paper=new Zotero.Item('journalArticle');paper.setField('title','Sync selection fixture');await paper.saveTx();
  await Zotero.getMainWindow().ZoteroPane.selectItem(note.id);
  for(let i=0;i<80&&api.editor.getEditorInstance(syncNote.id);i++)await Zotero.Promise.delay(100);

  let status=await call('get_note_sync',{note:syncRef});
  let sync=await call('sync_note',{note:syncRef,syncRevision:status.syncRevision,requestID:'enable-sync',action:'enable',directory:PathUtils.join(base,'notes')});
  record('enable-file-sync',sync.status.enabled&&sync.status.fileExists&&!sync.status.conflict);
  const file=sync.status.filePath;
  let raw=await IOUtils.readUTF8(file);await IOUtils.writeUTF8(file,raw.replace('File original.','File edited by MCP.'));
  status=await call('get_note_sync',{note:syncRef});
  record('detect-md-change',status.fileChanged&&!status.noteChanged&&!status.conflict);
  sync=await call('sync_note',{note:syncRef,syncRevision:status.syncRevision,requestID:'import-sync',action:'sync'});
  record('md-file-to-zotero',syncNote.getNote().includes('File edited by MCP.')&&!sync.status.fileChanged);
  syncNote.setNote(syncNote.getNote().replace('File edited by MCP.','Note edited by MCP.'));await syncNote.saveTx();
  status=await call('get_note_sync',{note:syncRef});
  await call('sync_note',{note:syncRef,syncRevision:status.syncRevision,requestID:'export-sync',action:'sync'});
  record('zotero-to-md-file',(await IOUtils.readUTF8(file)).includes('Note edited by MCP.'));
  raw=await IOUtils.readUTF8(file);await IOUtils.writeUTF8(file,raw.replace('Note edited by MCP.','File concurrent change.'));
  syncNote.setNote(syncNote.getNote().replace('Note edited by MCP.','Note concurrent change.'));await syncNote.saveTx({skipNotifier:true});
  status=await call('get_note_sync',{note:syncRef});
  rejected=false;try{await call('sync_note',{note:syncRef,syncRevision:status.syncRevision,requestID:'conflict-sync',action:'sync'});}catch{rejected=true;}
  record('reject-two-sided-conflict',status.conflict&&rejected&&syncNote.getNote().includes('Note concurrent change.'));
  sync=await call('sync_note',{note:syncRef,syncRevision:status.syncRevision,requestID:'disable-sync',action:'disable'});
  record('disable-keeps-md-file',!sync.status.enabled&&await IOUtils.exists(file));
  await IOUtils.writeUTF8(PathUtils.join(base,'bn-fixtures.json'),JSON.stringify({note:ref,syncNote:syncRef}));
 }catch(error){result.error=String(error);result.stack=error.stack;}
 await IOUtils.writeUTF8(PathUtils.join(base,'result.json'),JSON.stringify(result,null,2));
})();
