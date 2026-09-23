// This harness is packaged only in an isolated test XPI.
(async () => {
  const result = { stage: 'host-mcp', checks: [] };
  const record = (name, pass) => result.checks.push({ name, pass: Boolean(pass) });
  try {
    if (Zotero.DataDirectory.dir !== PathUtils.join(base, 'data')) throw new Error('Refusing writes outside isolated library');
    const win = Zotero.getMainWindow(), plugin = Zotero.ZoteroCodex;
    // Only this isolated fixture grants its own native API client test consent.
    Zotero.Server.LocalAPI._promptForAuthorization = async appName => ({allow:appName === 'Zotero Codex MCP',remember:true});
    record('plugin-started', plugin?.version === '0.6.0');
    for (let i = 0; i < 40 && !Zotero.BetterNotes?.api; i++) await Zotero.Promise.delay(250);
    record('better-notes-loaded', Boolean(Zotero.BetterNotes?.api));
    const paper = new Zotero.Item('journalArticle'); paper.setField('title', 'MCP synthetic fixture'); await paper.saveTx();
    const note = new Zotero.Item('note'); note.parentID = paper.id; note.setNote('<div data-schema-version="9"><p>Original <strong>synthetic</strong> paragraph.</p><p><a href="https://example.org">Keep this link.</a></p></div>'); await note.saveTx();
    const ref = item => ({ libraryID: item.libraryID, key: item.key });
    const search = new Zotero.Search(); search.libraryID=paper.libraryID; search.name='MCP fixture saved search'; search.addCondition('title','contains','MCP synthetic fixture'); await search.saveTx();
    const attachment = await Zotero.Attachments.importFromFile({file:PathUtils.join(base,'sample.pdf'),parentItemID:paper.id});
    await IOUtils.writeUTF8(Zotero.Fulltext.getItemCacheFile(attachment).path, 'Synthetic fulltext. The trial enrolled 37 participants. Final paragraph.');
    let before = await plugin.dispatch('zotero_read_note', {note:ref(note)});
    record('persisted-note-read', before.text.includes('Original synthetic'));
    const write = {note:ref(note),revision:before.revision,requestID:'host-append',text:'First MCP answer.',mode:'append',sources:[{title:'Fixture',sourceURI:`zotero://open-pdf/library/items/${attachment.key}?page=1`}]};
    await plugin.dispatch('zotero_write_note',write);
    record('persisted-note-write', note.getNote().includes('First MCP answer.') && note.getNote().includes(attachment.key));
    const replay = await plugin.dispatch('zotero_write_note',write);
    record('duplicate-write-deduplicated', replay.replayed && note.getNote().split('First MCP answer.').length === 2);
    let rejected = false;
    try {await plugin.dispatch('zotero_write_note',{...write,requestID:'stale-write'});} catch {rejected=true;}
    record('stale-revision-rejected', rejected);
    before = await plugin.dispatch('zotero_read_note',{note:ref(note),openEditor:true});
    record('live-editor-read', before.live);
    await plugin.dispatch('zotero_write_note',{...write,revision:before.revision,requestID:'live-append',text:'Live MCP insertion.'});
    record('live-editor-append', (await plugin.dispatch('zotero_read_note',{note:ref(note)})).text.includes('Live MCP insertion.'));
    before = await plugin.dispatch('zotero_read_note',{note:ref(note)});
    await plugin.dispatch('zotero_write_note',{...write,revision:before.revision,requestID:'cursor-insert',mode:'cursor',text:'Cursor MCP insertion.'});
    record('live-cursor-insert', (await plugin.dispatch('zotero_read_note',{note:ref(note)})).text.includes('Cursor MCP insertion.'));
    before = await plugin.dispatch('zotero_read_note',{note:ref(note)});
    const editArgs={note:ref(note),revision:before.revision,requestID:'host-edit',edits:[{oldText:'synthetic',newText:'revised'}]};
    await plugin.dispatch('zotero_edit_note',editArgs);
    const editor=Zotero.BetterNotes.api.editor.getEditorInstance(note.id);
    const editorDoc=()=>editor._iframeWindow.wrappedJSObject._currentEditorInstance._editorCore.view.state.doc;
    let strong=false,link=false;
    editorDoc().descendants(node=>{node=Components.utils.waiveXrays(node);if(node.isText&&node.text==='revised')strong=node.marks.some(m=>m.type.name==='strong');if(node.isText&&node.text==='Keep this link.')link=node.marks.some(m=>m.type.name==='link');});
    record('direct-edit-preserves-bold-and-link',strong&&link);
    record('edit-request-deduplication',(await plugin.dispatch('zotero_edit_note',editArgs)).replayed);
    before=await plugin.dispatch('zotero_read_note',{note:ref(note)});
    let failed=false;
    try {await plugin.dispatch('zotero_edit_note',{note:ref(note),revision:before.revision,requestID:'atomic-fail',edits:[{oldText:'revised',newText:'should-not-appear'},{oldText:'absent-text',newText:'x'}]});}catch{failed=true;}
    record('multi-edit-failure-is-atomic',failed&&(await plugin.dispatch('zotero_read_note',{note:ref(note)})).text===before.text);
    let stale=false;
    Zotero.BetterNotes.api.editor.insert(editor,'<p>Concurrent human edit.</p>','end');
    try {await plugin.dispatch('zotero_edit_note',{note:ref(note),revision:before.revision,requestID:'stale-edit',edits:[{oldText:'revised',newText:'wrong'}]});}catch{stale=true;}
    record('edit-rejects-unsaved-human-changes',stale);
    before=await plugin.dispatch('zotero_read_note',{note:ref(note)});
    await plugin.dispatch('zotero_edit_note',{note:ref(note),revision:before.revision,requestID:'delete-text',edits:[{oldText:'Concurrent human edit.',newText:''}]});
    record('delete-matched-text',!(await plugin.dispatch('zotero_read_note',{note:ref(note)})).text.includes('Concurrent human edit.'));
    const reader = await Zotero.Reader.open(attachment.id);
    await Zotero.Promise.delay(800);
    const annotation = {text:'The trial enrolled 37 participants.',pageLabel:'1',type:'highlight',position:{pageIndex:0,rects:[[10,10,60,25]]}};
    let popupButton;
    Zotero.Reader._dispatchEvent({type:'renderTextSelectionPopup',reader,doc:win.document,params:{annotation},append:b=>{popupButton=b;}});
    await Zotero.Promise.delay(300);
    const selected = await plugin.dispatch('zotero_get_selection',{});
    record('reader-event-auto-snapshot', selected.selection.text === annotation.text && popupButton.textContent === 'MCP 已记录选区');
    record('selection-nearby-fulltext', selected.selection.surroundingText.includes('Synthetic fulltext'));
    const second = await Zotero.Attachments.importFromFile({file:PathUtils.join(base,'sample.pdf'),parentItemID:paper.id});
    await Zotero.Reader.open(second.id);
    let isolated = false;
    try {await plugin.dispatch('zotero_get_selection',{});} catch {isolated=true;}
    record('selection-isolated-between-readers', isolated);
    await Zotero.Reader.open(attachment.id);
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=';
    await plugin.capture(reader,{...annotation,type:'image',image});
    record('region-image-retained', (await plugin.dispatch('zotero_get_selection',{})).selection.image === image);
    const saved = new Zotero.Item('annotation');saved.libraryID=attachment.libraryID;saved.parentID=attachment.id;saved.annotationType='highlight';saved.annotationText=annotation.text;saved.annotationComment='Synthetic annotation';saved.annotationColor='#ffd400';saved.annotationPageLabel='1';saved.annotationSortIndex='00000|000000|00000';saved.annotationPosition=JSON.stringify(annotation.position);await saved.saveTx();
    record('saved-annotations-read', (await plugin.dispatch('zotero_get_annotations',{attachment:ref(attachment)})).annotations.length===1);
    const sections=[...win.document.querySelectorAll('[data-pane$="zotero-codex-mcp"]')];
    const section=sections.find(s=>s.item?.id===attachment.id) || sections[0];
    if(section){section.querySelector('collapsible-section').open=true;section.skipRender=false;await section._forceRenderAll();}
    record('mcp-sidebar-rendered', Boolean(section?.querySelector('.zc-mcp')));
    await IOUtils.writeUTF8(PathUtils.join(base,'fixtures.json'),JSON.stringify({paper:ref(paper),note:ref(note),attachment:ref(attachment),readerID:selected.readerID,searchKey:search.key}));
  } catch(error){ result.error=String(error);result.stack=error.stack; }
  await IOUtils.writeUTF8(PathUtils.join(base,'result.json'),JSON.stringify(result,null,2));
})();
