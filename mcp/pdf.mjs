import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
let parser;
export async function readPDF(path, { startPage = 1, pageCount = 3, includeImage = false } = {}) {
  if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5) throw new Error('Invalid PDF page range');
  if (includeImage && pageCount !== 1) throw new Error('带图片时请一次读取一页（pageCount=1）');
  const info = await stat(path);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('PDF 不存在或超过 100 MB');
  parser ||= import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, VerbosityLevel } = await parser;
  const task = getDocument({ data: new Uint8Array(await readFile(path)), verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts') + sep,
    cMapUrl: join(pdfRoot, 'cmaps') + sep, cMapPacked: true,
    wasmUrl: join(pdfRoot, 'wasm') + sep,
  });
  try {
    const doc = await task.promise;
    if (startPage > doc.numPages) throw new Error(`PDF 共 ${doc.numPages} 页，起始页超出范围`);
    const pages = [];
    for (let n = startPage; n <= Math.min(doc.numPages, startPage + pageCount - 1); n++) {
      const page = await doc.getPage(n), content = await page.getTextContent();
      const raw = content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
      const output = { pageNumber: n, text: raw.slice(0, 30000), truncated: raw.length > 30000 };
      if (includeImage) {
        const normal = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(normal.width, normal.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const bytes = canvas.toBuffer('image/png');
        if (bytes.length > 5 * 1024 * 1024) throw new Error('页面图片超过 5 MB，请仅提取文字或读取 Zotero 区域批注');
        output.image = 'data:image/png;base64,' + bytes.toString('base64');
      }
      pages.push(output); page.cleanup();
    }
    return { totalPages: doc.numPages, pages, nextPage: startPage + pages.length <= doc.numPages ? startPage + pages.length : null, ocr: false };
  } finally { await task.destroy(); }
}

export async function readZoteroPDF(native, args) {
  const resolved = await native.call('zotero_get_attachment_path', { itemKey: args.itemKey, ...(args.groupId ? { groupId: args.groupId } : {}) });
  if (resolved.isError) throw new Error(resolved.content[0].text);
  const data = resolved.structuredContent || JSON.parse(resolved.content.find(c => c.type === 'text').text);
  const attachments = data.attachments.filter(a => a.path && a.contentType === 'application/pdf');
  if (attachments.length !== 1) throw new Error(attachments.length ? '存在多个 PDF，请用 zotero_get_attachment_path 选择明确的附件 key' : '该条目没有本地 PDF 文件');
  const attachment = attachments[0];
  const result = await readPDF(attachment.path, args);
  const library = args.groupId ? `groups/${args.groupId}` : 'library';
  for (const page of result.pages) page.sourceURI = `zotero://open-pdf/${library}/items/${attachment.attachmentKey}?page=${page.pageNumber}`;
  return { attachmentKey: attachment.attachmentKey, ...result };
}
