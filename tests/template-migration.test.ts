import { describe, it, expect } from 'vitest';
import { migrateTemplateJson } from '../src/domain/templateMigration.js';

const legacy = () => ({
  id: 'tpl_x',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  name: 'T',
  page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
  header: {
    heightMm: 20,
    zones: {
      left: [{ type: 'image', assetId: 'ast_logo', heightMm: 12 }],
      center: [{ type: 'text', value: 'MEIO', bold: false, fontSizePt: 9, color: '#444' }],
      right: [{ type: 'date', format: 'dd/MM/yyyy', bold: false, fontSizePt: 9, color: '#444' }],
    },
  },
  footer: {
    heightMm: 15,
    zones: { left: [], center: [], right: [] },
  },
  body: {
    fontFamily: 'system-ui',
    fontSizePt: 11,
    color: '#111111',
    lineHeight: 1.5,
  },
});

describe('migrateTemplateJson', () => {
  it('achata zones em elements na ordem left → center → right', () => {
    const { data, changed } = migrateTemplateJson(legacy());
    expect(changed).toBe(true);
    const t = data as any;
    expect(t.header.zones).toBeUndefined();
    expect(t.header.elements).toHaveLength(3);
    expect(t.header.elements[0]).toMatchObject({ type: 'image', align: 'left', xOffsetMm: 0, yMm: 0 });
    expect(t.header.elements[1]).toMatchObject({ type: 'text', align: 'center', xOffsetMm: 0, yMm: 0 });
    expect(t.header.elements[2]).toMatchObject({ type: 'date', align: 'right', xOffsetMm: 0, yMm: 0 });
  });

  it('trata footer com zones vazias', () => {
    const { data } = migrateTemplateJson(legacy());
    const t = data as any;
    expect(t.footer.zones).toBeUndefined();
    expect(t.footer.elements).toEqual([]);
  });

  it('preserva id, timestamps, name, page, body (fontSizePt)', () => {
    const { data } = migrateTemplateJson(legacy());
    const t = data as any;
    expect(t.id).toBe('tpl_x');
    expect(t.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(t.name).toBe('T');
    expect(t.page.margins.top).toBe(30);
    expect(t.body.fontSizePt).toBe(11);
  });

  it('é idempotente: JSON já no formato v2 passa direto', () => {
    const modern = {
      id: 'tpl_y',
      version: 2,
      name: 'M',
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
      header: { heightMm: 20, elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }] },
      footer: { heightMm: 0, elements: [] },
      body: { font: { family: 'system-ui' }, fontSizePt: 11, color: '#111111', lineHeight: 1.5 },
      cover: { enabled: false, applyHeaderFooter: false, elements: [] },
      headings: {
        h1: { color: '#111111', bold: true, fontSizePt: 20 },
        h2: { color: '#111111', bold: true, fontSizePt: 16 },
        h3: { color: '#111111', bold: true, fontSizePt: 13 },
      },
    };
    const { data, changed } = migrateTemplateJson(modern);
    expect(changed).toBe(false);
    expect(data).toBe(modern); // mesma referência
  });

  it('não altera entrada não-objeto', () => {
    expect(migrateTemplateJson(null)).toEqual({ data: null, changed: false });
    expect(migrateTemplateJson('string')).toEqual({ data: 'string', changed: false });
  });

  it('migra apenas uma faixa se só ela tem zones', () => {
    const partial = {
      version: 2,
      name: 'P',
      header: { heightMm: 20, zones: { left: [], center: [], right: [{ type: 'text', value: 'D' }] } },
      footer: { heightMm: 0, elements: [] },
      body: { font: { family: 'system-ui' } },
      cover: { enabled: false, applyHeaderFooter: false, elements: [] },
      headings: {
        h1: { color: '#111111', bold: true, fontSizePt: 20 },
        h2: { color: '#111111', bold: true, fontSizePt: 16 },
        h3: { color: '#111111', bold: true, fontSizePt: 13 },
      },
    };
    const { data, changed } = migrateTemplateJson(partial);
    expect(changed).toBe(true);
    const t = data as any;
    expect(t.header.elements[0]).toMatchObject({ type: 'text', align: 'right' });
    expect(t.footer.elements).toEqual([]);
  });

  it('migra template v1 (com body.fontFamily) para v2 (body.font + cover + headings)', () => {
    const v1 = {
      id: 'tpl_abcdefghij12',
      version: 1,
      name: 'Legado',
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
      header: { heightMm: 20, elements: [] },
      footer: { heightMm: 15, elements: [] },
      body: {
        fontFamily: "Arial, sans-serif",
        fontSizePt: 11,
        color: '#111111',
        lineHeight: 1.5,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const { data, changed } = migrateTemplateJson(v1);
    expect(changed).toBe(true);
    const t = data as any;
    expect(t.version).toBe(2);
    expect(t.body.font.family).toBe("Arial, sans-serif");
    expect(t.body).not.toHaveProperty('fontFamily');
    expect(t.cover).toEqual({ enabled: false, applyHeaderFooter: false, elements: [] });
    expect(t.headings.h1).toEqual({ color: '#111111', bold: true, fontSizePt: 20 });
  });

  it('template já v2 passa incólume', () => {
    const v2 = {
      version: 2, name: 'X',
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
      header: { heightMm: 20, elements: [] }, footer: { heightMm: 15, elements: [] },
      body: { font: { family: 'X' }, fontSizePt: 11, color: '#111', lineHeight: 1.5 },
      cover: { enabled: false, applyHeaderFooter: false, elements: [] },
      headings: {
        h1: { color: '#111', bold: true, fontSizePt: 20 },
        h2: { color: '#111', bold: true, fontSizePt: 16 },
        h3: { color: '#111', bold: true, fontSizePt: 13 },
      },
    };
    const { changed } = migrateTemplateJson(v2);
    expect(changed).toBe(false);
  });
});
