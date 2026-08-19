import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  buildDocumentHtml,
  MissingAssetError,
  elementPosition,
} from '../src/render/template.js';
import {
  TemplateInputSchema,
  makeBlankTemplateInput,
  type TemplateInput,
  type TemplateInputRaw,
} from '../src/domain/template.js';

const DATA_URI = 'data:image/png;base64,AAAB';

function templateWith(over: Partial<TemplateInputRaw> = {}): TemplateInput {
  return TemplateInputSchema.parse({ ...makeBlankTemplateInput('T'), ...over });
}

describe('elementPosition', () => {
  it('align=left aplica left e sem transform', () => {
    expect(elementPosition({ align: 'left', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      left: '0mm',
    });
    expect(elementPosition({ align: 'left', xOffsetMm: 5, yMm: 3 })).toEqual({
      top: '3mm',
      left: '5mm',
    });
  });

  it('align=right aplica right, e offset positivo afasta da borda', () => {
    expect(elementPosition({ align: 'right', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      right: '0mm',
    });
    expect(elementPosition({ align: 'right', xOffsetMm: 5, yMm: 0 })).toEqual({
      top: '0mm',
      right: '5mm',
    });
  });

  it('align=center usa calc(50% + offset) com translateX(-50%)', () => {
    expect(elementPosition({ align: 'center', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      left: 'calc(50% + 0mm)',
      transform: 'translateX(-50%)',
    });
    expect(elementPosition({ align: 'center', xOffsetMm: -4, yMm: 2 })).toEqual({
      top: '2mm',
      left: 'calc(50% + -4mm)',
      transform: 'translateX(-50%)',
    });
  });
});

describe('renderTemplate — header/footer', () => {
  it('todo texto carrega font-size explícito (o Chromium usa 0 por padrão)', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'ACME', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toContain('ACME');
    // nenhum nó de texto pode ficar sem tamanho declarado
    expect(headerHtml).toMatch(/font-size:\s*9pt/);
  });

  it('emite CSS de posição correto para cada âncora', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: 'ESQ', align: 'left', xOffsetMm: 0, yMm: 0 },
          { type: 'text', value: 'MEIO', align: 'center', xOffsetMm: 0, yMm: 0 },
          { type: 'text', value: 'DIR', align: 'right', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t);
    // ordem no HTML segue ordem no array (a posição visual sai do CSS)
    expect(headerHtml.indexOf('ESQ')).toBeLessThan(headerHtml.indexOf('MEIO'));
    expect(headerHtml.indexOf('MEIO')).toBeLessThan(headerHtml.indexOf('DIR'));
    expect(headerHtml).toContain('position: absolute');
    expect(headerHtml).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(headerHtml).toMatch(/right:\s*0mm/);
  });

  it('respeita xOffsetMm e yMm no CSS emitido', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'A', align: 'left', xOffsetMm: 7, yMm: 4 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/top:\s*4mm/);
    expect(headerHtml).toMatch(/left:\s*7mm/);
  });

  it('usa as classes mágicas do Chromium para a paginação', () => {
    const t = templateWith({
      footer: {
        heightMm: 15,
        elements: [
          { type: 'pageNumber', format: 'Página {page} de {total}', align: 'right', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { footerHtml } = renderTemplate(t);
    expect(footerHtml).toContain('<span class="pageNumber"></span>');
    expect(footerHtml).toContain('<span class="totalPages"></span>');
    expect(footerHtml).toContain('Página ');
    expect(footerHtml).toContain(' de ');
  });

  it('embute a imagem como data URI, nunca como URL', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_logo', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { assets: { ast_logo: DATA_URI } });
    expect(headerHtml).toContain(`src="${DATA_URI}"`);
    expect(headerHtml).toMatch(/height:\s*12mm/);
  });

  it('falha explicitamente quando o asset referenciado sumiu', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_sumiu', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    expect(() => renderTemplate(t, { assets: {} })).toThrow(MissingAssetError);
    try {
      renderTemplate(t, { assets: {} });
    } catch (err) {
      expect((err as MissingAssetError).assetId).toBe('ast_sumiu');
      expect((err as MissingAssetError).statusCode).toBe(422);
    }
  });

  it('desenha um espaço reservado quando o editor pede placeholder', () => {
    // Este template é justamente o que NÃO passa na validação: o elemento de
    // imagem já existe mas ainda não tem arquivo. É o estado do editor entre
    // clicar em "+ imagem" e escolher o arquivo, e ele precisa ser desenhável.
    const base = templateWith();
    const t: TemplateInput = {
      ...base,
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: '', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    };
    const { headerHtml } = renderTemplate(t, { assets: {}, missingAsset: 'placeholder' });
    expect(headerHtml).toContain('escolha uma imagem');
    expect(headerHtml).not.toContain('<img');
  });

  it('mesmo em modo placeholder, o servidor continua sendo o padrão que falha', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_x', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    expect(() => renderTemplate(t, { assets: {} })).toThrow(MissingAssetError);
  });

  it('resolve {{variaveis}} nos textos', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: 'Cliente: {{cliente}}', align: 'center', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { variables: { cliente: 'ACME S/A' } });
    expect(headerHtml).toContain('Cliente: ACME S/A');
  });

  it('escapa HTML vindo de texto e de variável', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: '{{x}}', align: 'center', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { variables: { x: '<img src=x onerror=alert(1)>' } });
    expect(headerHtml).not.toContain('<img src=x');
    expect(headerHtml).toContain('&lt;img');
  });

  it('formata a data conforme o template', () => {
    const now = new Date('2026-08-18T15:04:00.000Z');
    const build = (format: 'dd/MM/yyyy' | 'yyyy-MM-dd') =>
      renderTemplate(
        templateWith({
          footer: {
            heightMm: 15,
            elements: [{ type: 'date', format, align: 'left', xOffsetMm: 0, yMm: 0 }],
          },
        }),
        { now, timeZone: 'UTC' },
      ).footerHtml;
    expect(build('dd/MM/yyyy')).toContain('18/08/2026');
    expect(build('yyyy-MM-dd')).toContain('2026-08-18');
  });

  it('mantém o padding lateral alinhado com as margens da página', () => {
    const t = templateWith({
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 25, bottom: 25, left: 18 } },
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/padding:\s*0\s+25mm\s+0\s+18mm/);
  });

  it('emite a faixa com position: relative para servir de contexto absoluto', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/position:\s*relative/);
  });
});

describe('renderTemplate — pdfOptions', () => {
  it('traduz formato, orientação e margens', () => {
    const t = templateWith({
      page: { format: 'Letter', orientation: 'landscape', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
    });
    const { pdfOptions } = renderTemplate(t);
    expect(pdfOptions.format).toBe('Letter');
    expect(pdfOptions.landscape).toBe(true);
    expect(pdfOptions.margin).toEqual({ top: '30mm', right: '20mm', bottom: '25mm', left: '20mm' });
    expect(pdfOptions.printBackground).toBe(true);
  });

  it('desliga header/footer quando as duas faixas estão vazias', () => {
    const t = templateWith({
      header: { heightMm: 0, elements: [] },
      footer: { heightMm: 0, elements: [] },
      page: { format: 'A4', orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 } },
    });
    expect(renderTemplate(t).pdfOptions.displayHeaderFooter).toBe(false);
  });

  it('liga header/footer quando há qualquer elemento', () => {
    expect(renderTemplate(templateWith()).pdfOptions.displayHeaderFooter).toBe(true);
  });
});

describe('renderTemplate — css', () => {
  it('declara as regras de quebra de página', () => {
    const { css } = renderTemplate(templateWith());
    expect(css).toMatch(/\.page-break\s*\{[^}]*break-after:\s*page/);
    expect(css).toMatch(/break-after:\s*avoid/);   // títulos órfãos
    expect(css).toMatch(/break-inside:\s*avoid/);  // tabelas/imagens partidas
    expect(css).toMatch(/thead\s*\{[^}]*table-header-group/);
  });

  it('aplica a tipografia do corpo', () => {
    const { css } = renderTemplate(templateWith({ body: { font: { family: 'Georgia' }, fontSizePt: 13, color: '#222222', lineHeight: 1.7 } }));
    expect(css).toContain('Georgia');
    expect(css).toContain('13pt');
    expect(css).toContain('#222222');
    expect(css).toContain('1.7');
  });
});

describe('renderTemplate — headings css', () => {
  it('emite regras CSS por nível de heading configurado', () => {
    const t = makeBlankTemplateInput();
    t.headings.h1 = { color: '#ff0000', bold: false, fontSizePt: 22 };
    t.headings.h2 = { color: '#0000ff', bold: true, fontSizePt: 15 };
    const { css } = renderTemplate(t);
    expect(css).toContain('h1 { color: #ff0000; font-weight: 400; font-size: 22pt; }');
    expect(css).toContain('h2 { color: #0000ff; font-weight: 700; font-size: 15pt; }');
    // h3-h6 compartilham a regra do h3:
    expect(css).toMatch(/h3, h4, h5, h6 \{ color: #111111; font-weight: 700; font-size: 13pt; \}/);
  });
});

describe('buildDocumentHtml', () => {
  it('monta um documento completo com o css e o corpo', () => {
    const { css } = renderTemplate(templateWith());
    const html = buildDocumentHtml({ css, bodyHtml: '<h1>Oi</h1>' });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<h1>Oi</h1>');
    expect(html).toContain(css);
  });
});

describe('renderTemplate — cover', () => {
  it('não emite cover quando desabilitada', () => {
    const t = makeBlankTemplateInput();
    const r = renderTemplate(t);
    expect(r.cover).toBeUndefined();
    expect(r.coverInlineHtml).toBeUndefined();
  });

  it('emite cover como documento separado quando applyHeaderFooter=false', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: false,
      elements: [{ type: 'text', value: 'Título', align: 'center', xOffsetMm: 0, yMm: 130, fontSizePt: 28, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t);
    expect(r.cover).toBeDefined();
    expect(r.cover!.html).toContain('Título');
    expect(r.cover!.html.trim().startsWith('<!doctype html>')).toBe(true);
    expect(r.cover!.pdfOptions.displayHeaderFooter).toBe(false);
    expect(r.cover!.pdfOptions.margin).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' });
    expect(r.coverInlineHtml).toBeUndefined();
  });

  it('emite coverInlineHtml quando applyHeaderFooter=true', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: true,
      elements: [{ type: 'text', value: 'Título', align: 'center', xOffsetMm: 0, yMm: 100, fontSizePt: 24, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t);
    expect(r.cover).toBeUndefined();
    expect(r.coverInlineHtml).toBeDefined();
    expect(r.coverInlineHtml).toContain('Título');
    expect(r.coverInlineHtml).toContain('page-break');
  });

  it('resolve variáveis nos textos da capa', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: false,
      elements: [{ type: 'text', value: 'Contrato {{numero}}', align: 'center', xOffsetMm: 0, yMm: 100, fontSizePt: 22, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t, { variables: { numero: '2026/0413' } });
    expect(r.cover!.html).toContain('Contrato 2026/0413');
  });
});
