/**
 * Contagem de páginas do PDF já gerado.
 *
 * O pdfjs é carregado sob demanda: só a resposta JSON de /api/convert precisa
 * desse número, e não vale pagar o import no boot do servidor.
 */
export async function countPdfPages(pdf: Buffer): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const doc = await loadingTask.promise;
  const { numPages } = doc;
  await loadingTask.destroy();
  return numPages;
}
