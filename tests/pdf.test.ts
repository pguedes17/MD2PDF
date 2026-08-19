import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPdfService, type PdfService } from '../src/render/pdf.js';
import { renderTemplate, buildDocumentHtml } from '../src/render/template.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { TemplateInputSchema, type TemplateInput } from '../src/domain/template.js';

let pdfService: PdfService;

beforeAll(async () => {
  pdfService = createPdfService();
});

afterAll(async () => {
  await pdfService.close();
});

/** 1x1 png transparente — suficiente para provar que a imagem chega ao PDF. */
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const templateWithBands = (): TemplateInput =>
  TemplateInputSchema.parse({
    name: 'Contrato',
    page: {
      format: 'A4',
      orientation: 'portrait',
      margins: { top: 32, right: 20, bottom: 25, left: 20 },
    },
    header: {
      heightMm: 22,
      zones: {
        left: [{ type: 'image', assetId: 'ast_logo', heightMm: 10 }],
        center: [{ type: 'text', value: 'ACME LOGISTICA' }],
        right: [],
      },
    },
    footer: {
      heightMm: 15,
      zones: {
        left: [{ type: 'text', value: 'Confidencial' }],
        center: [],
        right: [{ type: 'pageNumber', format: 'Pagina {page} de {total}' }],
      },
    },
    body: {},
  });

async function convertMarkdown(markdown: string, template: TemplateInput): Promise<Buffer> {
  const rendered = renderTemplate(template, { assets: { ast_logo: PNG_DATA_URI } });
  return pdfService.convert({
    bodyHtml: renderMarkdown(markdown),
    headerHtml: rendered.headerHtml,
    footerHtml: rendered.footerHtml,
    css: rendered.css,
    pdfOptions: rendered.pdfOptions,
  });
}

describe('pdfService.convert', () => {
  it('produz um PDF válido a partir de markdown simples', async () => {
    const pdf = await convertMarkdown('# Olá\n\nPrimeiro parágrafo.', templateWithBands());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('aplica o header e o footer em TODAS as páginas', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const markdown = [
      '# Contrato',
      'Parágrafo longo. '.repeat(400),
      '<!-- pagebreak -->',
      '# Anexo A',
      'Conteúdo do anexo.',
    ].join('\n\n');

    const pdf = await convertMarkdown(markdown, templateWithBands());
    const parsed = await readPdf(pdf);

    expect(parsed.numPages).toBeGreaterThanOrEqual(3);
    for (const [index, pageText] of parsed.pages.entries()) {
      expect(pageText, `header ausente na página ${index + 1}`).toContain('ACME LOGISTICA');
      expect(pageText, `footer ausente na página ${index + 1}`).toContain('Confidencial');
    }
  });

  it('numera as páginas e fecha o total corretamente', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const markdown = ['Um.', '<!-- pagebreak -->', 'Dois.', '<!-- pagebreak -->', 'Três.'].join('\n\n');

    const parsed = await readPdf(await convertMarkdown(markdown, templateWithBands()));

    expect(parsed.numPages).toBe(3);
    expect(parsed.pages[0]).toContain('Pagina 1 de 3');
    expect(parsed.pages[1]).toContain('Pagina 2 de 3');
    expect(parsed.pages[2]).toContain('Pagina 3 de 3');
  });

  it('respeita o <!-- pagebreak --> movendo o conteúdo para a página seguinte', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const parsed = await readPdf(
      await convertMarkdown('Antes da quebra.\n\n<!-- pagebreak -->\n\nDepois da quebra.', templateWithBands()),
    );

    expect(parsed.numPages).toBe(2);
    expect(parsed.pages[0]).toContain('Antes da quebra');
    expect(parsed.pages[0]).not.toContain('Depois da quebra');
    expect(parsed.pages[1]).toContain('Depois da quebra');
  });

  it('não executa JavaScript embutido no documento', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const rendered = renderTemplate(templateWithBands(), { assets: { ast_logo: PNG_DATA_URI } });
    const pdf = await pdfService.convert({
      // passa ao largo do sanitize de propósito, para provar a segunda barreira
      bodyHtml: '<p id="alvo">original</p><script>document.getElementById("alvo").textContent = "executou"</script>',
      headerHtml: rendered.headerHtml,
      footerHtml: rendered.footerHtml,
      css: rendered.css,
      pdfOptions: rendered.pdfOptions,
    });

    const parsed = await readPdf(pdf);
    expect(parsed.text).toContain('original');
    expect(parsed.text).not.toContain('executou');
  });

  it('bloqueia requisição a recurso externo por padrão', async () => {
    const rendered = renderTemplate(templateWithBands(), { assets: { ast_logo: PNG_DATA_URI } });
    const pdf = await pdfService.convert({
      bodyHtml: '<p>texto</p><img src="http://127.0.0.1:9/naoexiste.png" alt="">',
      headerHtml: rendered.headerHtml,
      footerHtml: rendered.footerHtml,
      css: rendered.css,
      pdfOptions: rendered.pdfOptions,
    });
    // O ponto é não travar esperando a rede: a conversão termina mesmo assim.
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('serializa conversões concorrentes sem derrubar o browser', async () => {
    const template = templateWithBands();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => convertMarkdown(`# Documento ${i}\n\nCorpo.`, template)),
    );
    for (const pdf of results) {
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('aborta conversão que estoura o timeout', async () => {
    const slowService = createPdfService({ timeoutMs: 1 });
    const rendered = renderTemplate(templateWithBands(), { assets: { ast_logo: PNG_DATA_URI } });
    await expect(
      slowService.convert({
        bodyHtml: '<p>x</p>',
        headerHtml: rendered.headerHtml,
        footerHtml: rendered.footerHtml,
        css: rendered.css,
        pdfOptions: rendered.pdfOptions,
      }),
    ).rejects.toThrow();
    await slowService.close();
  });
});
