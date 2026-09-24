var ZoteroMCPRuntime = (() => {
  const Core = ZoteroMCPRuntimeCore;
  const pref = 'extensions.zotero-codex.';
  let version, connection, root, key, task, disposed = false, cancelDownload;
  const processes = new Set();
  let status = {phase:'idle', message:'正在检查运行组件…', ready:false, configured:false};
  const state = () => ({...status, automatic:Zotero.Prefs.get(pref+'autoInstall',true) !== false});
  const notify = patch => { status = {...status,...patch}; };
  const active = () => { if (disposed) throw new Error('安装已取消'); };
  const file = path => Zotero.File.pathToFile(path);
  const nodePath = directory => PathUtils.join(directory,key.startsWith('win32') ? 'node.exe' : 'node');
  function run(node, args) {
    active();
    return new Promise((resolve,reject) => {
      const process = Components.classes['@mozilla.org/process/util;1'].createInstance(Components.interfaces.nsIProcess);
      const win = Zotero.getMainWindow();
      let timer;
      const finish = error => { win.clearTimeout(timer); processes.delete(process); error ? reject(error) : resolve(); };
      try {
        process.init(file(node)); processes.add(process);
        process.runwAsync(args,args.length,{observe(subject,topic) {
          finish(topic === 'process-finished' && process.exitValue === 0 ? null : new Error('运行组件检查失败，请点击重试；若仍失败请查看诊断。'));
        }},false);
        timer = win.setTimeout(()=>{ try { process.kill(); } catch {} finish(new Error('运行组件检查超时，请重试。')); },60000);
      } catch(error) { finish(error); }
    });
  }
  async function hash(path) {
    const stream = Components.classes['@mozilla.org/network/file-input-stream;1'].createInstance(Components.interfaces.nsIFileInputStream);
    stream.init(file(path),0x01,0,0);
    try {
      const crypto = Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
      crypto.init(crypto.SHA256); crypto.updateFromStream(stream,0xffffffff);
      return Array.from(crypto.finish(false),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
    } finally { stream.close(); }
  }
  async function extract(archive, directory) {
    const zip = Components.classes['@mozilla.org/libjar/zip-reader;1'].createInstance(Components.interfaces.nsIZipReader);
    zip.open(file(archive));
    try {
      const names = [], paths = new Set();
      const entries = zip.findEntries(null); let total = 0;
      while (entries.hasMore()) {
        const name = entries.getNext(), parts = Core.entry(name), entry = zip.getEntry(name);
        const normalized = parts.join('/').toLowerCase();
        if (paths.has(normalized)) throw new Error('运行包包含重复路径');
        paths.add(normalized);
        total += entry.realSize;
        if (total > 900*1024*1024 || names.length > 25000) throw new Error('运行包大小异常');
        names.push({name,parts,directory:entry.isDirectory});
      }
      for (let i=0;i<names.length;i++) {
        active();
        const entry = names[i], target = PathUtils.join(directory,...entry.parts);
        await IOUtils.makeDirectory(entry.directory ? target : PathUtils.parent(target),{createAncestors:true,permissions:0o700});
        if (!entry.directory) {
          zip.extract(entry.name,file(target));
          if (file(target).isSymlink()) throw new Error('运行包不能包含符号链接');
          await IOUtils.setPermissions(target,0o600);
        }
        if (i % 100 === 0) await Zotero.Promise.delay(0);
      }
    } finally { zip.close(); }
  }
  async function configure(directory, mode) {
    const resultPath = PathUtils.join(root,'configure-'+Services.uuid.generateUUID().toString().replace(/[{}]/g,'')+'.json');
    try {
      let failure;
      try { await run(nodePath(directory),[PathUtils.join(directory,'runtime','configure.mjs'),'--node',nodePath(directory),'--server',PathUtils.join(directory,'mcp','server.mjs'),'--connection',connection,'--root',root,'--mode',mode,'--result',resultPath]); }
      catch(error) { failure=error; }
      active();
      if (!(await IOUtils.exists(resultPath))) throw failure || new Error('无法配置 Codex');
      const result = JSON.parse(await IOUtils.readUTF8(resultPath));
      if (!result.ok) throw new Error(result.error);
      return result;
    } finally { await IOUtils.remove(resultPath,{ignoreAbsent:true}); }
  }
  async function valid(directory) {
    try {
      const meta = JSON.parse(await IOUtils.readUTF8(PathUtils.join(directory,'runtime.json')));
      if (meta.version !== version || meta.platform !== key) return false;
      for (const path of [nodePath(directory),PathUtils.join(directory,'runtime','verify.mjs'),PathUtils.join(directory,'mcp','server.mjs')]) {
        if (!(await IOUtils.exists(path))) return false;
      }
      await run(nodePath(directory),[PathUtils.join(directory,'runtime','verify.mjs')]);
      return true;
    } catch { return false; }
  }
  async function install() {
    active();
    key = Core.platform(Services.appinfo.OS,Services.appinfo.XPCOMABI);
    const standardDirectory = PathUtils.join(root,`${version}-${key}`);
    const savedDirectory = Zotero.Prefs.get(pref+'managedDirectory',true);
    const directory = typeof savedDirectory === 'string' && PathUtils.parent(savedDirectory) === root &&
      (savedDirectory === standardDirectory || savedDirectory.startsWith(standardDirectory+'-')) ? savedDirectory : standardDirectory;
    notify({phase:'checking',message:'正在检查运行组件…',ready:false});
    await IOUtils.makeDirectory(root,{createAncestors:true,permissions:0o700});
    if (!(await valid(directory))) {
      active();
      notify({phase:'downloading',message:'正在获取运行包信息…'});
      let manifest;
      try {
        const response = await Zotero.HTTP.request('GET',Core.releaseURL(version,'runtime-manifest.json'),{responseType:'json',timeout:30000});
        manifest = response.response;
      } catch { throw new Error('无法获取运行包，请检查网络后重试。若刚更新插件，运行包可能尚未发布。'); }
      active();
      const asset = Core.asset(manifest,version,key);
      const nonce = Services.uuid.generateUUID().toString().replace(/[{}]/g,'');
      const archive = PathUtils.join(root,`.download-${nonce}.zip`), staging = PathUtils.join(root,`.install-${nonce}`);
      try {
        await IOUtils.makeDirectory(staging,{permissions:0o700});
        await Zotero.HTTP.download(asset.url,archive,{
          timeout:60000,errorDelayMax:0,cancellerReceiver:cancel=>{ cancelDownload=cancel; if(disposed) cancel(); },
          onProgress:(bytes)=>{
            if (bytes > asset.size) { cancelDownload?.(); return; }
            notify({message:`正在下载运行组件 ${Math.min(100,Math.floor(bytes/asset.size*100))}%（${Math.ceil(bytes/1048576)} / ${Math.ceil(asset.size/1048576)} MB）`});
          },
        });
        cancelDownload=null; active();
        notify({phase:'verifying',message:'正在校验下载文件…'});
        if ((await IOUtils.stat(archive)).size !== asset.size || await hash(archive) !== asset.sha256) throw new Error('运行包校验失败，未安装。请重新下载。');
        active(); notify({phase:'installing',message:'正在安装运行组件…'});
        await extract(archive,staging);
        await IOUtils.setPermissions(nodePath(staging),0o700);
        if (!(await valid(staging))) throw new Error('运行包无法在此电脑运行，原有安装已保留。请重试或查看安装说明。');
        active();
        // Never overwrite an executable in use. Keep previous installations for
        // existing clients, and use a fresh recovery directory for a damaged version.
        let target = directory;
        if (await IOUtils.exists(target)) target += '-'+nonce;
        await IOUtils.move(staging,target,{noOverwrite:true});
        notify({directory:target});
      } finally {
        cancelDownload=null;
        await IOUtils.remove(archive,{ignoreAbsent:true});
        await IOUtils.remove(staging,{recursive:true,ignoreAbsent:true});
      }
    } else notify({directory});
    active();
    const installed = status.directory;
    // Store only after verification. A failed download cannot replace working paths.
    Zotero.Prefs.set(pref+'managedDirectory',installed,true);
    notify({phase:'ready',ready:true,message:'运行组件已就绪，点击「连接 Codex」完成首次连接。'});
    const result = await configure(installed,'update');
    if (result.configured) {
      notify({configured:true,message:result.changed ? '运行组件已更新，请重启 Codex。' : '运行组件已就绪，Codex 已配置。'});
      Zotero.Prefs.set(pref+'nodePath',nodePath(installed),true);
      Zotero.Prefs.set(pref+'serverPath',PathUtils.join(installed,'mcp','server.mjs'),true);
    }
    return installed;
  }
  function ensure() {
    if (!task) task = install().catch(error=>{
      if (!disposed) notify({phase:'error',message:error.message || '安装失败，请检查网络后重试。'});
      throw error;
    }).finally(()=>{task=null;});
    return task;
  }
  async function connect() {
    const directory = status.ready ? status.directory : await ensure();
    const result = await configure(directory,'connect');
    active();
    if (!result.configured) throw new Error('Codex 配置未完成');
    Zotero.Prefs.set('httpServer.localAPI.enabled',true);
    Zotero.Prefs.set(pref+'nodePath',nodePath(directory),true);
    Zotero.Prefs.set(pref+'serverPath',PathUtils.join(directory,'mcp','server.mjs'),true);
    notify({configured:true,message:'已连接 Codex，并开启 Zotero 本地 API。请重启 Codex 后使用。'});
  }
  function start(options) {
    version=options.version;connection=options.connection;disposed=false;
    root=PathUtils.join(Services.dirsvc.get('ProfD',Components.interfaces.nsIFile).path,'zotero-codex-runtime');
    if(state().automatic) void ensure().catch(()=>{});
    else notify({phase:'idle',message:'自动准备已关闭，点击「准备 / 重试」可安装运行组件。'});
  }
  function setAutomatic(value) {
    Zotero.Prefs.set(pref+'autoInstall',Boolean(value),true);
    if(value) void ensure().catch(()=>{});
  }
  async function stop() {
    disposed=true;cancelDownload?.();
    for (const process of processes) { try { process.kill(); } catch {} }
    await task?.catch(()=>{});
  }
  return {start,stop,state,ensure,connect,setAutomatic};
})();
