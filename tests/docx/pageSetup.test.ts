import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { extractPageSetup } from '../../src/docx/pageSetup.js';
import { openDocx } from '../../src/docx/unzip.js';

const wrap = (sectPr: string) => `<?xml version="1.0"?>
<w:document xmlns:w="urn:x"><w:body>${sectPr}</w:body></w:document>`;

describe('extractPageSetup', () => {
  it('A4 portrait com margens padrão', () => {
    const xml = wrap(`<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1701" w:right="1134" w:bottom="1417" w:left="1134"/>
    </w:sectPr>`);
    const { page, warnings } = extractPageSetup(xml);
    expect(page.format).toBe('A4');
    expect(page.orientation).toBe('portrait');
    expect(page.margins.top).toBe(30); // 1701 twips ≈ 30mm
    expect(page.margins.left).toBe(20); // 1134 twips ≈ 20mm
    expect(warnings).toEqual([]);
  });

  it('Letter portrait', () => {
    const xml = wrap(`<w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>`);
    const { page } = extractPageSetup(xml);
    expect(page.format).toBe('Letter');
    expect(page.orientation).toBe('portrait');
    expect(page.margins.top).toBe(25);
  });

  it('landscape detectado por width > height', () => {
    const xml = wrap(`<w:sectPr>
      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>`);
    const { page } = extractPageSetup(xml);
    expect(page.format).toBe('A4');
    expect(page.orientation).toBe('landscape');
  });

  it('formato desconhecido → default A4 + warning', () => {
    const xml = wrap(`<w:sectPr>
      <w:pgSz w:w="9999" w:h="9999"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>`);
    const { page, warnings } = extractPageSetup(xml);
    expect(page.format).toBe('A4');
    expect(warnings.some((w) => w.code === 'UNKNOWN_PAGE_SIZE')).toBe(true);
  });

  it('sem sectPr → defaults + warning', () => {
    const xml = wrap('');
    const { page, warnings } = extractPageSetup(xml);
    expect(page.format).toBe('A4');
    expect(warnings.some((w) => w.code === 'UNKNOWN_PAGE_SIZE')).toBe(true);
  });

  it('extrai do docx real sem erro', () => {
    const buf = fs.readFileSync('tests/fixtures/docx/sample-requirements.docx');
    const xml = openDocx(buf).text('word/document.xml')!;
    const { page } = extractPageSetup(xml);
    expect(['A4', 'Letter']).toContain(page.format);
    expect(page.margins.top).toBeGreaterThan(0);
  });
});
