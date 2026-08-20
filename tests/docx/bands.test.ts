import { describe, it, expect } from 'vitest';
import { extractBand } from '../../src/docx/bands.js';
import { parseTheme } from '../../src/docx/theme.js';

const emptyTheme = parseTheme(null);

const textOnly = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x">
  <w:p>
    <w:pPr><w:jc w:val="right"/></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr><w:t>Contrato </w:t></w:r>
    <w:r><w:t>Bionexo</w:t></w:r>
  </w:p>
</w:hdr>`;

const withImage = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x" xmlns:r="urn:y" xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:pic="urn:pic">
  <w:p>
    <w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="1524000" cy="609600"/>
        <a:graphic><a:graphicData>
          <pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r>
  </w:p>
</w:hdr>`;

describe('extractBand', () => {
  it('extrai texto right-aligned com tipografia', () => {
    const b = extractBand(textOnly, {}, emptyTheme);
    expect(b.elements).toHaveLength(1);
    const el = b.elements[0]!;
    expect(el.type).toBe('text');
    if (el.type !== 'text') throw new Error();
    expect(el.value).toBe('Contrato Bionexo');
    expect(el.align).toBe('right');
    expect(el.bold).toBe(true);
    expect(el.fontSizePt).toBe(10);
    expect(el.color).toBe('#555555');
  });

  it('resolve imagem via rels e converte extent EMU → mm', () => {
    const b = extractBand(withImage, { rId5: 'media/image2.png' }, emptyTheme);
    expect(b.elements).toHaveLength(1);
    const el = b.elements[0]!;
    expect(el.type).toBe('image');
    if (el.type !== 'image') throw new Error();
    expect(el.imageDocxPath).toBe('word/media/image2.png');
    // cy 609600 EMU = 16.93mm; clamp para máximo 40
    expect(el.heightMm).toBeCloseTo(16.9, 1);
  });

  it('sem jc → default center', () => {
    const xml = `<?xml version="1.0"?><w:hdr xmlns:w="urn:x">
      <w:p><w:r><w:t>Meio</w:t></w:r></w:p></w:hdr>`;
    const b = extractBand(xml, {}, emptyTheme);
    expect(b.elements[0]!.align).toBe('center');
  });

  it('parágrafo vazio é ignorado', () => {
    const xml = `<?xml version="1.0"?><w:hdr xmlns:w="urn:x">
      <w:p></w:p><w:p><w:r><w:t>Ok</w:t></w:r></w:p></w:hdr>`;
    const b = extractBand(xml, {}, emptyTheme);
    expect(b.elements).toHaveLength(1);
  });
});
