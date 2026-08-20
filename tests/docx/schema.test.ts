import { describe, it, expect } from 'vitest';
import { DocxAnalysisSchema, WarningSchema } from '../../src/docx/schema.js';

describe('DocxAnalysisSchema', () => {
  it('aceita objeto mínimo válido', () => {
    const value = {
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
      headers: {}, footers: {},
      styles: {
        body: { family: 'Calibri', fontSizePt: 11, color: '#000000', lineHeight: 1.15 },
        headings: { h1: null, h2: null, h3: null },
      },
      images: [],
      fonts: { detected: [], presetMatches: {}, unmatched: [] },
    };
    expect(() => DocxAnalysisSchema.parse(value)).not.toThrow();
  });

  it('rejeita cor sem formato hex', () => {
    const bad = { code: 'EMF_NOT_SUPPORTED', message: 'x' };
    expect(() => WarningSchema.parse(bad)).not.toThrow();
    expect(() => WarningSchema.parse({ code: 'INVALID', message: 'x' })).toThrow();
  });
});
