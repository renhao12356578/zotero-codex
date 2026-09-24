"""Build a self-contained, platform-specific runtime. Run on its target OS/CPU."""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, tempfile, zipfile

root = Path(__file__).resolve().parents[1]
node = json.loads(subprocess.check_output(['node', '-p', 'JSON.stringify({path:process.execPath,platform:process.platform,arch:process.arch,version:process.versions.node})'], text=True))
if int(node['version'].split('.')[0]) < 24:
    raise SystemExit('Build with Node.js 24 LTS or newer')
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
key = f"{node['platform']}-{node['arch']}"
dist = root / 'dist'
dist.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='zotero-runtime-build-') as temporary:
    stage = Path(temporary) / 'runtime'
    stage.mkdir()
    for name in ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(root / name, stage / name)
    # Install only production dependencies and the current platform's native canvas.
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    subprocess.run([npm, 'ci', '--omit=dev', '--ignore-scripts'], cwd=stage, check=True, shell=os.name == 'nt')
    for name in ['mcp', 'runtime', 'vendor/zotero-native-mcp/build']:
        shutil.copytree(root / name, stage / name)
    (stage / 'vendor/zotero-native-mcp').mkdir(exist_ok=True)
    for name in ['package.json', 'LICENSE', 'UPSTREAM.json']:
        shutil.copy2(root / 'vendor/zotero-native-mcp' / name, stage / 'vendor/zotero-native-mcp' / name)
    (stage / 'addon/content').mkdir(parents=True)
    shutil.copy2(root / 'addon/content/mcp-schema.js', stage / 'addon/content/mcp-schema.js')
    binary = stage / ('node.exe' if os.name == 'nt' else 'node')
    shutil.copy2(node['path'], binary)
    # Include Node and its bundled third-party license text, not just our dependencies.
    subprocess.run([str(binary), '-p', 'process.release.lts || process.version'], check=True)
    import urllib.request
    with urllib.request.urlopen(f"https://raw.githubusercontent.com/nodejs/node/v{node['version']}/LICENSE", timeout=60) as response:
        (stage / 'NODE-LICENSE').write_bytes(response.read())
    (stage / 'runtime.json').write_text(json.dumps({'schema':1,'version':version,'platform':key,'node':node['version']}))
    subprocess.run([str(binary), str(stage / 'runtime/verify.mjs')], check=True)
    name = f'zotero-codex-runtime-{version}-{key}.zip'
    target = dist / name
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in sorted(stage.rglob('*')):
            if source.is_file() and not source.is_symlink() and '.bin' not in source.parts:
                archive.write(source, source.relative_to(stage).as_posix())
    digest = hashlib.sha256()
    with target.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    descriptor = {'name':name,'size':target.stat().st_size,'sha256':digest.hexdigest()}
    (dist / f'runtime-{key}.json').write_text(json.dumps({'schema':1,'version':version,'assets':{key:descriptor}},indent=2)+'\n')
    print(json.dumps(descriptor))
