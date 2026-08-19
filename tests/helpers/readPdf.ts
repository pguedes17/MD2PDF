import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ReadPdf {
  numPages: number;
  /** Texto extraído por página, na ordem. */
  pages: string[];
  /** Todo o texto do documento concatenado. */
  text: string;
}

/** Abre o PDF gerado para conferir de verdade o que saiu — não só que "gerou algo". */
export async function readPdf(buffer: Buffer): Promise<ReadPdf> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Sem worker separado e sem tentar buscar fontes na rede durante o teste.
    disableWorker: true,
    useSystemFonts: false,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(text);
  }
  await loadingTask.destroy();

  return { numPages: doc.numPages, pages, text: pages.join('\n') };
}
