"""Build the XPI from source; no npm dependencies or network needed."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
addon = root / "addon"
manifest = json.loads((addon / "manifest.json").read_text())
assert manifest["applications"]["zotero"].get("update_url"), "Zotero requires applications.zotero.update_url, even for development builds"
target = root / "dist" / f"zotero-codex-{manifest['version']}.xpi"
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for source in sorted(addon.rglob("*")):
        if source.is_file() and not source.name.startswith("."):
            archive.write(source, source.relative_to(addon))
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        archive.write(root / name, name)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert {"manifest.json", "bootstrap.js", "content/plugin.js", "content/core.js"} <= set(archive.namelist())
print(target)
