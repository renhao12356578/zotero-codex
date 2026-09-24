// Run before activating a downloaded runtime. Exercises its actual native binary,
// PDF dependencies and compiled upstream bridge without touching a Zotero library.
import {createCanvas} from '@napi-rs/canvas';
import '../mcp/server.mjs';
import {createNativeBridge} from '../mcp/native.mjs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile} from 'node:fs/promises';
const meta = JSON.parse(await readFile(new URL('../runtime.json',import.meta.url),'utf8'));
if (meta.platform !== `${process.platform}-${process.arch}` || Number(process.versions.node.split('.')[0]) < 24) throw new Error('Runtime platform mismatch');
if (!createCanvas(8,8).toBuffer('image/png').length || typeof getDocument !== 'function') throw new Error('PDF runtime unavailable');
const native = await createNativeBridge();
if (native.tools.length < 20) throw new Error('Native bridge tools unavailable');
await native.close();
