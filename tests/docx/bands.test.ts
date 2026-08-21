import { describe, it, expect } from 'vitest';
import { extractBand } from '../../src/docx/bands.js';
import { parseTheme } from '../../src/docx/theme.js';

const emptyTheme = parseTheme(null);

const textOnly = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x">
  <w:p>
    <w:pPr><w:jc w:val="right"/></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr><w:t>Contrato </w:t></w:r>
    <w:r><w:t>Exemplo</w:t></w:r>
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
    expect(el.value).toBe('Contrato Exemplo');
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

  it('tabela 1x3: célula sem w:jc cai no default por índice (left/center/right)', () => {
    // Todas as células sem jc → default derivado do índice: 0→left, 1→center, 2→right
    const xml = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x" xmlns:r="urn:y" xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:pic="urn:pic">
  <w:tbl>
    <w:tr>
      <w:tc>
        <w:p>
          <w:r><w:drawing>
            <wp:inline>
              <wp:extent cx="1524000" cy="609600"/>
              <a:graphic><a:graphicData>
                <pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>
              </a:graphicData></a:graphic>
            </wp:inline>
          </w:drawing></w:r>
        </w:p>
      </w:tc>
      <w:tc><w:p><w:r><w:t>Meio</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Fim</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
</w:hdr>`;
    const b = extractBand(xml, { rId1: 'media/logo.png' }, emptyTheme);
    expect(b.elements).toHaveLength(3);
    expect(b.elements[0]!.align).toBe('left');
    expect(b.elements[1]!.align).toBe('center');
    expect(b.elements[2]!.align).toBe('right');
  });

  it('w:jc do parágrafo tem prioridade sobre o default da célula', () => {
    // 2 células: default seria left/right. Ambas as células têm parágrafo com jc=right —
    // as duas devem cair em right, empilhando via yMm (não sobreposição).
    const xml = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x">
  <w:tbl>
    <w:tr>
      <w:tc>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Um</w:t></w:r></w:p>
      </w:tc>
      <w:tc>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Dois</w:t></w:r></w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:hdr>`;
    const b = extractBand(xml, {}, emptyTheme);
    expect(b.elements).toHaveLength(2);
    expect(b.elements[0]!.align).toBe('right');
    expect(b.elements[1]!.align).toBe('right');
    expect(b.elements[0]!.yMm).toBe(0);
    // Segundo elemento na mesma zona → yMm > 0 (empilhado)
    expect(b.elements[1]!.yMm).toBeGreaterThan(0);
  });

  it('empilha múltiplos parágrafos da mesma célula por yMm crescente', () => {
    // 3 parágrafos numa única célula, todos jc=right → mesmo align, y crescente
    const xml = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x">
  <w:tbl>
    <w:tr>
      <w:tc>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Linha 1</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Linha 2</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Linha 3</w:t></w:r></w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:hdr>`;
    const b = extractBand(xml, {}, emptyTheme);
    expect(b.elements).toHaveLength(3);
    expect(b.elements[0]!.yMm).toBe(0);
    expect(b.elements[1]!.yMm).toBeGreaterThan(b.elements[0]!.yMm);
    expect(b.elements[2]!.yMm).toBeGreaterThan(b.elements[1]!.yMm);
  });

  it('elementos em zonas diferentes não interferem no cursor um do outro', () => {
    // 2 elementos left + 1 center → o center começa em yMm=0 (cursor independente)
    const xml = `<?xml version="1.0"?>
<w:hdr xmlns:w="urn:x">
  <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>L1</w:t></w:r></w:p>
  <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>L2</w:t></w:r></w:p>
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>C1</w:t></w:r></w:p>
</w:hdr>`;
    const b = extractBand(xml, {}, emptyTheme);
    expect(b.elements).toHaveLength(3);
    expect(b.elements[0]!.align).toBe('left');
    expect(b.elements[0]!.yMm).toBe(0);
    expect(b.elements[1]!.align).toBe('left');
    expect(b.elements[1]!.yMm).toBeGreaterThan(0);
    expect(b.elements[2]!.align).toBe('center');
    expect(b.elements[2]!.yMm).toBe(0);
  });
});
