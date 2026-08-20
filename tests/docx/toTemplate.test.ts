import { describe, it, expect } from 'vitest';
import { toTemplateInput } from '../../src/docx/toTemplate.js';
import type { DocxAnalysis } from '../../src/docx/schema.js';
import { TemplateInputSchema, BAND_MARGIN_SLACK_MM } from '../../src/domain/template.js';

const base: DocxAnalysis = {
  page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
  headers: {
    default: {
      heightMm: 20,
      elements: [
        { type: 'text', value: 'Cabecalho', align: 'left', bold: false, fontSizePt: 9, color: '#444444' },
      ],
    },
  },
  footers: {
    default: {
      heightMm: 15,
      elements: [
        { type: 'text', value: 'Rodape', align: 'right', bold: false, fontSizePt: 9, color: '#444444' },
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
          elements: [{ type: 'image', imageDocxPath: 'word/media/image2.png', align: 'left', heightMm: 12 }],
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

  it('imagem sem asset match é pulada com warning', () => {
    const orphan: DocxAnalysis = {
      ...base,
      headers: {
        default: {
          heightMm: 20,
          elements: [{ type: 'image', imageDocxPath: 'word/media/orphan.png', align: 'left', heightMm: 12 }],
        },
      },
      images: [],
    };
    const { templateInput, warnings } = toTemplateInput(orphan, 'X');
    expect(templateInput.header.elements).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
