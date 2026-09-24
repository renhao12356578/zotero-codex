"""Prepare an isolated Zotero profile. Does not edit the user's live profile."""
from pathlib import Path
import json, os, shutil, tempfile, zipfile, socket

root = Path(__file__).resolve().parents[1]
base = Path(tempfile.mkdtemp(prefix="zotero-codex-host-"))
profile = base / "profile"
(profile / "extensions").mkdir(parents=True)
(base / "data").mkdir()
sample = root / 'test/fixtures/alice.pdf'
if sample.exists(): shutil.copy2(sample, base / 'sample.pdf')
with socket.socket() as port_socket:
    port_socket.bind(("127.0.0.1", 0))
    test_port = port_socket.getsockname()[1]
prefs = {
    "extensions.zotero-codex.autoInstall": False,
    "extensions.zotero-codex.mcpConnectionFile": str(base / 'connection.json'),
    "extensions.zotero.useDataDir": True,
    "extensions.zotero.dataDir": str(base / "data"),
    "extensions.zotero.firstRun2": False,
    "extensions.zotero.sync.autoSync": False,
    "extensions.zotero.httpServer.enabled": True,
    "extensions.zotero.httpServer.localAPI.enabled": True,
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 15,
    "extensions.update.enabled": False,
    "extensions.logging.enabled": True,
    "extensions.zotero.httpServer.port": test_port,
    "extensions.zotero.Knowledge4Zotero.syncPeriodSeconds": -1,
    "extensions.zotero.automaticScraperUpdates": False,
    "app.update.auto": False,
}
(profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()))
# Select only an explicit XPI or an unambiguous local installation.
bn_override = os.environ.get("ZOTERO_BETTER_NOTES_XPI")
if bn_override:
    bn = Path(bn_override).expanduser().resolve()
else:
    profile_roots = [Path.home() / "Library/Application Support/Zotero/Profiles",
                     Path.home() / ".zotero/zotero"]
    if os.environ.get("APPDATA"):
        profile_roots.append(Path(os.environ["APPDATA"]) / "Zotero/Zotero/Profiles")
    candidates = sorted({p for directory in profile_roots for p in directory.glob(
        "*/extensions/Knowledge4Zotero@windingwind.com.xpi")})
    if len(candidates) != 1:
        raise SystemExit("Set ZOTERO_BETTER_NOTES_XPI to the Better Notes .xpi path")
    bn = candidates[0]
if not bn.is_file():
    raise SystemExit("ZOTERO_BETTER_NOTES_XPI must point to an existing .xpi")
if bn.exists(): shutil.copy2(bn, profile / "extensions" / bn.name)
with zipfile.ZipFile(profile / "extensions/zotero-codex@local.xpi", "w", zipfile.ZIP_DEFLATED) as archive:
    for source in (root / "addon").rglob("*"):
        if not source.is_file(): continue
        data = source.read_bytes()
        if source.name == "bootstrap.js":
            extra = f"""
const originalStartupForSmoke = startup;
startup = async function(data, reason) {{
  try {{
    await originalStartupForSmoke(data, reason);
    Services.scriptloader.loadSubScript(data.rootURI + 'content/host-smoke.js', {{ Zotero, IOUtils, Services, PathUtils, Components, base: {json.dumps(str(base))} }});
  }} catch (error) {{
    await IOUtils.writeUTF8({json.dumps(str(base / 'result.json'))}, JSON.stringify({{stage:'startup', error:String(error), stack:error.stack}}));
  }}
}};
"""
            data += extra.encode()
        archive.writestr(str(source.relative_to(root / "addon")), data)
    archive.write(root / "scripts" / os.environ.get("ZOTERO_SMOKE_SCRIPT", "host-smoke.js"), "content/host-smoke.js")
shutil.copy2(profile / "extensions/zotero-codex@local.xpi", base / "candidate.xpi")
if bn.exists() and os.environ.get("ZOTERO_SMOKE_INSTALL_DIAGNOSTICS"):
    with zipfile.ZipFile(bn) as source, zipfile.ZipFile(profile / "extensions" / bn.name, "w", zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry.filename)
            if entry.filename == "bootstrap.js":
                data += f"""
const originalBetterNotesStartupForSmoke = startup;
startup = async function(data, reason) {{
 await originalBetterNotesStartupForSmoke(data, reason);
 try {{
  const {{ AddonManager }} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const file = Components.classes['@mozilla.org/file/local;1'].createInstance(Components.interfaces.nsIFile);
  file.initWithPath({json.dumps(str(base / 'candidate.xpi'))});
  await AddonManager.installTemporaryAddon(file);
 }} catch(error) {{
  await IOUtils.writeUTF8({json.dumps(str(base / 'install-error.json'))}, JSON.stringify({{error:String(error), additionalErrors:error.additionalErrors, stack:error.stack}}));
 }}
}};
""".encode()
            target.writestr(entry, data)
(root / ".runtime").mkdir(exist_ok=True)
(root / ".runtime/host-profile.json").write_text(json.dumps({"base": str(base), "profile": str(profile)}))
print(json.dumps({"base": str(base), "profile": str(profile)}))
