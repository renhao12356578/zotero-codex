# Third-party source used directly

## zotero-native-mcp

- Author: David Sosa
- Repository: https://github.com/dvdsosa/zotero-native-mcp
- Commit: `4bd9972e93e2336db99320c935d9ea2cbb1615a4`
- License: MIT, retained verbatim at `vendor/zotero-native-mcp/LICENSE`.
- The repository snapshot, TypeScript source, tests, and documentation are included in `vendor/zotero-native-mcp`. `UPSTREAM.json` records SHA-256 hashes of the original source. One local extension in src/tools/items.ts adds offset pagination, optional revision checks and Unicode-safe boundaries. The diff is in patches/fulltext-pagination.patch; original hashes remain in sourceSHA256 and modified-file hashes in modifiedSourceSHA256. Other TypeScript source remains unchanged.
- `npm run build:native` compiles this source. `mcp/native.mjs` imports and executes the original HTTP client and all five tool-registration modules. It preserves the original `zotero_*` namespace through a standard in-memory MCP connection. The outer server merges native and plugin status into a single tool; duplicate host search, metadata, and fulltext handlers have been removed. It restricts configuration to local URLs and directs existing-note text updates to the live editor adapter. Upstream metadata updates and new-note creation are executed by the original handlers.

## PDF.js and Canvas

PDF page extraction and rendering directly use Mozilla PDF.js (`pdfjs-dist`, Apache-2.0) and `@napi-rs/canvas` (MIT), installed from npm with exact versions in `package-lock.json`. Their package license files are retained by npm.

The Zotero XPI's Reader and Better Notes integration uses host APIs; it does not bundle Zotero or Better Notes source. Runtime dependencies are declared in `package.json`; transitive licenses are supplied in their installed packages.

## Managed runtime packages

Platform-specific runtime ZIPs bundle an unmodified Node.js executable. The matching Node.js license and bundled third-party notices are included as `NODE-LICENSE`. Production npm dependencies, including `toml-eslint-parser` (MIT), retain their package license files. The vendored Zotero native MCP license is also included in every runtime ZIP. No Zotero or Better Notes executable is redistributed.
