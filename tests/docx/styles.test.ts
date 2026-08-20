import { describe, it, expect } from 'vitest';
import { extractStyles } from '../../src/docx/styles.js';
import { parseTheme } from '../../src/docx/theme.js';

const theme = parseTheme(`<?xml version="1.0"?>
<a:theme xmlns:a="urn:z"><a:themeElements>
  <a:fontScheme>
    <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme>
</a:themeElements></a:theme>`);

const stylesXml = `<?xml version="1.0"?>
<w:styles xmlns:w="urn:x">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri"/>
      <w:sz w:val="22"/>
      <w:color w:val="333333"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:rPr>
      <w:rFonts w:asciiTheme="majorHAnsi"/>
      <w:b/>
      <w:sz w:val="40"/>
      <w:color w:val="2E74B5"/>
    </w:rPr>
  </w:style>
</w:styles>`;

describe('extractStyles', () => {
  it('lê o Normal', () => {
    const r = extractStyles(stylesXml, theme);
    expect(r.body.family).toBe('Calibri');
    expect(r.body.fontSizePt).toBe(11);
    expect(r.body.color).toBe('#333333');
    expect(r.body.lineHeight).toBeCloseTo(1.5, 2);
  });

  it('lê Heading1 e resolve majorHAnsi via theme', () => {
    const r = extractStyles(stylesXml, theme);
    expect(r.headings.h1).toBeTruthy();
    expect(r.headings.h1!.bold).toBe(true);
    expect(r.headings.h1!.fontSizePt).toBe(20);
    expect(r.headings.h1!.color).toBe('#2E74B5');
    expect(r.headings.h1!.family).toBe('Calibri Light');
  });

  it('sem Heading2/3 → nulls', () => {
    const r = extractStyles(stylesXml, theme);
    expect(r.headings.h2).toBeNull();
    expect(r.headings.h3).toBeNull();
  });

  it('aceita Ttulo1 (nome PT-BR do Word 365)', () => {
    const xml = stylesXml.replace('w:styleId="Heading1"', 'w:styleId="Ttulo1"');
    const r = extractStyles(xml, theme);
    expect(r.headings.h1).toBeTruthy();
  });
});
