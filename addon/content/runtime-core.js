/* Shared validation for the installer; also exercised without a Zotero host. */
var ZoteroMCPRuntimeCore = (() => {
  const repository = 'https://github.com/renhao12356578/zotero-codex';
  const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64'];
  function platform(os, abi) {
    const system = {Darwin:'darwin', WINNT:'win32', Linux:'linux'}[os];
    const cpu = /^(aarch64|arm64)/i.test(abi) ? 'arm64' : /^(x86_64|x64)/i.test(abi) ? 'x64' : '';
    const key = `${system}-${cpu}`;
    if (!supported.includes(key)) throw new Error('暂不支持此系统或处理器，未下载任何组件。');
    return key;
  }
  function releaseURL(version, name) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('无效的运行包版本或文件名');
    return `${repository}/releases/download/v${version}/${name}`;
  }
  function asset(manifest, version, key) {
    const value = manifest?.assets?.[key];
    const name = `zotero-codex-runtime-${version}-${key}.zip`;
    if (manifest?.schema !== 1 || manifest.version !== version || !supported.includes(key) || value?.name !== name ||
        !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > 350 * 1024 * 1024) {
      throw new Error('运行包清单不完整或版本不匹配，请稍后重试。');
    }
    return {...value, url:releaseURL(version, name)};
  }
  function entry(name) {
    // No absolute paths, traversal, NTFS streams, reserved names or Windows aliases.
    const parts = name.replace(/\/$/, '').split('/');
    if (!name || /[\\:\x00-\x1f]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
      throw new Error('运行包包含不安全的文件路径');
    }
    return parts;
  }
  return {repository, supported, platform, releaseURL, asset, entry};
})();
if (typeof module !== 'undefined') module.exports = ZoteroMCPRuntimeCore;
