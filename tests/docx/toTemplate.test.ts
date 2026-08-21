import { describe, it, expect } from 'vitest';
import { toTemplateInput, detectPaginationFormat } from '../../src/docx/toTemplate.js';
import type { DocxAnalysis } from '../../src/docx/schema.js';
import { TemplateInputSchema, BAND_MARGIN_SLACK_MM } from '../../src/domain/template.js';

const base: DocxAnalysis = {
  page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
  headers: {
    default: {
      heightMm: 20,
      elements: [
        { type: 'text', value: 'Cabecalho', align: 'left', bold: false, fontSizePt: 9, color: '#444444', yMm: 0 },
      ],
    },
  },
  footers: {
    default: {
      heightMm: 15,
      elements: [
        { type: 'text', value: 'Rodape', align: 'right', bold: false, fontSizePt: 9, color: '#444444', yMm: 0 },
      ],
    },
  },
  styles: {
    body: { family: 'Calibri', fontSizePt: 11, color: '#333333', lineHeight: 1.15 },
    headings: {
      h1: { family: 'Calibri Light', bold: true, fontSizePt: 20, color: '#2E74B5' },
      h2: null,
      h3: null,
    },
  },
  images: [],
  fonts: { detected: ['Calibri'], presetMatches: { Calibri: 'system-ui, sans-serif' }, unmatched: [] },
};

describe('toTemplateInput', () => {
  it('resultado passa por TemplateInputSchema', () => {
    const { templateInput } = toTemplateInput(base, 'Meu template');
    expect(() => TemplateInputSchema.parse(templateInput)).not.toThrow();
    expect(templateInput.name).toBe('Meu template');
  });

  it('mapeia body font via presetMatches', () => {
    const { templateInput } = toTemplateInput(base, 'X');
    expect(templateInput.body?.font?.family).toContain('system-ui');
  });

  it('ajusta margem se faixa não coubesse', () => {
    const tight: DocxAnalysis = { ...base, page: { ...base.page, margins: { ...base.page.margins, top: 5 } } };
    const { templateInput } = toTemplateInput(tight, 'X');
    expect(templateInput.page.margins.top).toBeGreaterThanOrEqual(20 + BAND_MARGIN_SLACK_MM);
  });

  it('resolve image element via analysis.images', () => {
    const withImage: DocxAnalysis = {
      ...base,
      headers: {
        default: {
          heightMm: 20,
          elements: [{ type: 'image', imageDocxPath: 'word/media/image2.png', align: 'left', heightMm: 12, yMm: 0 }],
        },
      },
      images: [{ docxPath: 'word/media/image2.png', assetId: 'ast_abcdefghijkl', mime: 'image/png' }],
    };
    const { templateInput } = toTemplateInput(withImage, 'X');
    const el = templateInput.header.elements[0]!;
    expect(el.type).toBe('image');
    if (el.type !== 'image') throw new Error();
    expect(el.assetId).toBe('ast_abcdefghijkl');
  });

  // A ideia é evitar que "Page 7 of 7" (número gravado pelo Word) vire literal no
  // template e imprima 7/7 em todas as páginas do PDF gerado.
  describe('detecta paginação (pt/en/es) e converte em pageNumber', () => {
    it.each([
      // [entrada, formato esperado] — separador e caixa são preservados fielmente.
      ['Page 7 of 7', 'Page {page} of {total}'],
      ['page 1 OF 12', 'page {page} OF {total}'],
      ['Página 3 de 10', 'Página {page} de {total}'],
      ['PÁGINA 1 DE 5', 'PÁGINA {page} DE {total}'],
      ['Pág. 1 de 5', 'Pág. {page} de {total}'],
      ['Pg 4 of 8', 'Pg {page} of {total}'],
      ['Pág. 3/10', 'Pág. {page}/{total}'],
      ['3 / 10', '{page} / {total}'],
      ['1/5', '{page}/{total}'],
      ['1 de 5', '{page} de {total}'],
      ['  Page 2 of 3  ', 'Page {page} of {total}'],
    ])('%s → %s', (input, expected) => {
      expect(detectPaginationFormat(input)).toBe(expected);
    });

    it.each([
      'Página do documento', // "Página" seguido de texto, sem número
      'Anexo 3', // número sem prefixo/total
      'Page 3', // sem total — ambíguo demais para converter
      'Página 5', // idem
      'Rodapé qualquer',
      '', // vazio
      '3', // só número
    ])('não converte: %s', (input) => {
      expect(detectPaginationFormat(input)).toBeNull();
    });

    it('rodapé com "Page 7 of 7" vira elemento pageNumber + warning PAGE_NUMBER_DETECTED', () => {
      const withPagination: DocxAnalysis = {
        ...base,
        footers: {
          default: {
            heightMm: 15,
            elements: [
              { type: 'text', value: 'Confidencial', align: 'left', bold: false, fontSizePt: 8, color: '#444444', yMm: 0 },
              { type: 'text', value: 'Page 7 of 7', align: 'right', bold: true, fontSizePt: 9, color: '#222222', yMm: 0 },
            ],
          },
        },
      };
      const { templateInput, warnings } = toTemplateInput(withPagination, 'X');

      const footerElements = templateInput.footer.elements;
      expect(footerElements).toHaveLength(2);

      // Primeiro elemento continua texto.
      expect(footerElements[0]!.type).toBe('text');

      // Segundo virou pageNumber preservando tipografia + alinhamento.
      const pageEl = footerElements[1]!;
      expect(pageEl.type).toBe('pageNumber');
      if (pageEl.type !== 'pageNumber') throw new Error();
      expect(pageEl.format).toBe('Page {page} of {total}');
      expect(pageEl.align).toBe('right');
      expect(pageEl.bold).toBe(true);
      expect(pageEl.fontSizePt).toBe(9);
      expect(pageEl.color).toBe('#222222');

      // Warning específico, com código estável.
      const pageWarning = warnings.find((w) => w.code === 'PAGE_NUMBER_DETECTED');
      expect(pageWarning).toBeDefined();
      expect(pageWarning?.message).toContain('Page 7 of 7');
      expect(pageWarning?.message).toContain('Page {page} of {total}');
    });
  });

  it('imagem sem asset match é pulada com warning', () => {
    const orphan: DocxAnalysis = {
      ...base,
      headers: {
        default: {
          heightMm: 20,
          elements: [{ type: 'image', imageDocxPath: 'word/media/orphan.png', align: 'left', heightMm: 12, yMm: 0 }],
        },
      },
      images: [],
    };
    const { templateInput, warnings } = toTemplateInput(orphan, 'X');
    expect(templateInput.header.elements).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
