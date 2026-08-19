import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfs } from '../src/render/pdfMerge.js';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('mergePdfs', () => {
  it('concatena páginas na ordem', async () => {
    const a = await makePdf(1);
    const b = await makePdf(3);
    const merged = await mergePdfs([a, b]);
    const loaded = await PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(4);
  });

  it('caso trivial: um único PDF passa incólume no total de páginas', async () => {
    const a = await makePdf(2);
    const merged = await mergePdfs([a]);
    const loaded = await PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('rejeita array vazio', async () => {
    await expect(mergePdfs([])).rejects.toThrow();
  });
});
