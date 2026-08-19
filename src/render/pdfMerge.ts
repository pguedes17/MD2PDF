import { PDFDocument } from 'pdf-lib';

/**
 * Concatena PDFs preservando a ordem. Puro: não toca em fs, Playwright ou Fastify.
 * A capa (PDF 1) e o corpo (PDF 2) são fundidos aqui para produzir o documento
 * final quando a capa não herda header/footer.
 */
export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('mergePdfs: nenhum PDF para juntar');
  }
  if (buffers.length === 1) return buffers[0]!;

  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return Buffer.from(bytes);
}
