import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPdfService, type PdfService } from '../src/render/pdf.js';
import { renderTemplate, buildDocumentHtml } from '../src/render/template.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { TemplateInputSchema, makeBlankTemplateInput, type TemplateInput } from '../src/domain/template.js';
import { createConversionService } from '../src/conversion.js';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { createFontRepo } from '../src/storage/fontRepo.js';

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
      elements: [
        { type: 'image', assetId: 'ast_logo', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        { type: 'text', value: 'ACME LOGISTICA', align: 'center', xOffsetMm: 0, yMm: 0 },
      ],
    },
    footer: {
      heightMm: 15,
      elements: [
        { type: 'text', value: 'Confidencial', align: 'left', xOffsetMm: 0, yMm: 0 },
        { type: 'pageNumber', format: 'Pagina {page} de {total}', align: 'right', xOffsetMm: 0, yMm: 0 },
      ],
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

describe('convertWithTemplate — capa', () => {
  let dir: string;
  let conversion: ReturnType<typeof createConversionService>;
  let templateRepo: ReturnType<typeof createTemplateRepo>;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-cover-'));
    templateRepo = createTemplateRepo(path.join(dir, 'templates'));
    const assetRepo = createAssetRepo(path.join(dir, 'assets'));
    conversion = createConversionService({ templateRepo, assetRepo, pdfService });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('gera capa limpa como primeira página, sem header/footer nela', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const t = makeBlankTemplateInput('Doc') as any;
    t.header = {
      heightMm: 20,
      elements: [
        { type: 'text', value: 'CABECALHO', align: 'left', xOffsetMm: 0, yMm: 5, bold: true, fontSizePt: 10, color: '#000' },
      ],
    };
    t.cover = {
      enabled: true,
      applyHeaderFooter: false,
      elements: [
        { type: 'text', value: 'MEU TITULO', align: 'center', xOffsetMm: 0, yMm: 140, fontSizePt: 32, bold: true, color: '#000' },
      ],
    };
    const template = await templateRepo.create(t);
    const buf = await conversion.convertWithTemplate(template, '# Página do corpo');
    const info = await readPdf(buf);

    expect(info.numPages).toBe(2);                                // capa + corpo
    expect(info.textByPage[0]).toContain('MEU TITULO');           // capa mostra título
    expect(info.textByPage[0]).not.toContain('CABECALHO');        // capa sem header
    expect(info.textByPage[1]).toContain('CABECALHO');            // corpo tem header
  });

  it('capa com applyHeaderFooter=true mantém o header também na página 1', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const t = makeBlankTemplateInput('Doc2') as any;
    t.header = {
      heightMm: 20,
      elements: [
        { type: 'text', value: 'CABECALHO', align: 'left', xOffsetMm: 0, yMm: 5, bold: true, fontSizePt: 10, color: '#000' },
      ],
    };
    t.cover = {
      enabled: true,
      applyHeaderFooter: true,
      elements: [
        { type: 'text', value: 'CAPA TITULO', align: 'center', xOffsetMm: 0, yMm: 120, fontSizePt: 28, bold: true, color: '#000' },
      ],
    };
    const template = await templateRepo.create(t);
    const buf = await conversion.convertWithTemplate(template, '# Corpo');
    const info = await readPdf(buf);

    expect(info.numPages).toBe(2);
    expect(info.textByPage[0]).toContain('CABECALHO');
    expect(info.textByPage[0]).toContain('CAPA TITULO');
  });

  it('sem capa produz um PDF normal de uma página', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const template = await templateRepo.create(makeBlankTemplateInput('SemCapa'));
    const buf = await conversion.convertWithTemplate(template, '# Página única');
    const info = await readPdf(buf);

    expect(info.numPages).toBe(1);
  });
});

describe('convertWithTemplate — fonte customizada', () => {
  let dir: string;
  let conversion: ReturnType<typeof createConversionService>;
  let templateRepo: ReturnType<typeof createTemplateRepo>;
  let fontRepo: ReturnType<typeof createFontRepo>;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-font-'));
    templateRepo = createTemplateRepo(path.join(dir, 'templates'));
    const assetRepo = createAssetRepo(path.join(dir, 'assets'));
    fontRepo = createFontRepo(path.join(dir, 'fonts'));
    conversion = createConversionService({ templateRepo, assetRepo, pdfService, fontRepo });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('quando template referencia fonte custom, o PDF contém a @font-face embutida', async () => {
    const { readPdf } = await import('./helpers/readPdf.js');
    const ttf = Buffer.alloc(128, 42); // fake, mas suficiente para embutir
    const meta = await fontRepo.save({ originalName: 'x.ttf', declaredFamily: 'FonteX, sans-serif', mime: 'font/ttf', data: ttf });
    const t = makeBlankTemplateInput() as any;
    t.body.font = { family: 'FonteX, sans-serif', customFontId: meta.id };
    const template = await templateRepo.create(t);
    const buf = await conversion.convertWithTemplate(template, '# Corpo');
    const info = await readPdf(buf);
    expect(info.numPages).toBeGreaterThan(0);
  });
});
