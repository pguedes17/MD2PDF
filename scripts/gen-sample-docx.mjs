// Gera tests/fixtures/docx/sample-requirements.docx — um DOCX sintético
// (sem conteúdo proprietário) usado como fixture nos testes de import.
//
// Rodar: node scripts/gen-sample-docx.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import PizZip from 'pizzip';

// ---------- PNG mínimo (sem depender de bibliotecas) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG RGB pintado por `paint(x, y) → [r,g,b]`. */
function paintPng(w, h, paint) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const rowLen = w * 3;
  const raw = Buffer.alloc(h * (1 + rowLen));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + rowLen);
    raw[off] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      raw[off + 1 + x * 3 + 0] = r;
      raw[off + 1 + x * 3 + 1] = g;
      raw[off + 1 + x * 3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Logo "SAMPLE" abstrato: quadrado azul-escuro à esquerda, faixa diagonal
 * ciano cruzando, fundo branco. Sem tentar renderizar texto (sem font engine),
 * mas visualmente identificável como marca. 240×72 px.
 */
function sampleLogo() {
  const W = 240, H = 72;
  const NAVY = [0x1f, 0x3a, 0x5f];
  const CYAN = [0x4a, 0x9d, 0xd6];
  const GOLD = [0xf5, 0xb6, 0x30];
  const WHITE = [0xff, 0xff, 0xff];
  return paintPng(W, H, (x, y) => {
    // Quadrado à esquerda (marca)
    if (x < H) {
      // Faixa diagonal ciano dentro do quadrado
      if (Math.abs(x - y) < 10) return CYAN;
      // Barra dourada horizontal na base
      if (y >= H - 8) return GOLD;
      return NAVY;
    }
    // Separador vertical fino
    if (x >= H && x < H + 3) return NAVY;
    // Área de "texto" — três barras horizontais empilhadas simulando linhas de texto
    const textLeft = H + 12;
    if (x >= textLeft && x < W - 8) {
      // Linha 1: barra grossa "SAMPLE" (topo)
      if (y >= 14 && y <= 28) return NAVY;
      // Linha 2: barra fina "Product Requirements" (meio)
      if (y >= 38 && y <= 46 && x < W - 40) return [0x55, 0x55, 0x55];
      // Linha 3: barra fina "Confidential" (baixo)
      if (y >= 54 && y <= 60 && x < W - 80) return [0x99, 0x99, 0x99];
    }
    return WHITE;
  });
}

// ---------- Partes XML do DOCX ----------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const HEADER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>
</Relationships>`;

// A4 (11906×16838 twips) com margens padrão + header/footer references
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Product Requirements Document</w:t></w:r></w:p>
    <w:p><w:r><w:t>This is a synthetic fixture used to exercise the docx-to-template import pipeline. It has no proprietary content.</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1. Overview</w:t></w:r></w:p>
    <w:p><w:r><w:t>Describe the goal of the product and the primary user personas. This paragraph exists only to provide realistic body text for the importer.</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>2. Functional Requirements</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>2.1 Authentication</w:t></w:r></w:p>
    <w:p><w:r><w:t>The system SHALL allow users to authenticate via email and password.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>2.2 Authorization</w:t></w:r></w:p>
    <w:p><w:r><w:t>Access to sensitive resources SHALL be restricted by role.</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>3. Non-Functional Requirements</w:t></w:r></w:p>
    <w:p><w:r><w:t>Availability, latency and observability targets are captured in the SLO document.</w:t></w:r></w:p>

    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:footerReference w:type="default" r:id="rId4"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1701" w:right="1134" w:bottom="1417" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

// Header: tabela 1×2 — logo à esquerda, título/metadata à direita (3 linhas empilhadas).
// wp:extent cx=1440000 cy=432000 EMU ≈ 40mm × 12mm (aspecto 3.33:1 = 240×72 do PNG).
const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:tbl>
    <w:tblPr><w:tblW w:w="9638" w:type="dxa"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid>
    <w:tr>
      <w:tc>
        <w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="left"/></w:pPr>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="1440000" cy="432000"/>
                <wp:docPr id="1" name="Logo"/>
                <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic>
                      <pic:nvPicPr>
                        <pic:cNvPr id="1" name="Logo"/>
                        <pic:cNvPicPr/>
                      </pic:nvPicPr>
                      <pic:blipFill>
                        <a:blip r:embed="rId1"/>
                        <a:stretch><a:fillRect/></a:stretch>
                      </pic:blipFill>
                      <pic:spPr>
                        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1440000" cy="432000"/></a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="1F3A5F"/></w:rPr><w:t>Product Requirements Document</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="555555"/></w:rPr><w:t>Ref: PRD-2026-001 • v1.0</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="777777"/></w:rPr><w:t>Owner: Product Team • 2026-08-21</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:hdr>`;

// Footer: tabela 1×3 — esquerda (nome/depto), centro (paginação), direita (classificação).
const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:tbl>
    <w:tblPr><w:tblW w:w="9638" w:type="dxa"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="3213"/><w:gridCol w:w="3212"/><w:gridCol w:w="3213"/></w:tblGrid>
    <w:tr>
      <w:tc>
        <w:tcPr><w:tcW w:w="3213" w:type="dxa"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="left"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1F3A5F"/></w:rPr><w:t>SAMPLE Corp</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="left"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="14"/><w:color w:val="777777"/></w:rPr><w:t>Product Engineering</w:t></w:r>
        </w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:tcW w:w="3212" w:type="dxa"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="555555"/></w:rPr><w:t>Page 1 of 1</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="14"/><w:color w:val="999999"/></w:rPr><w:t>PRD-2026-001</w:t></w:r>
        </w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:tcW w:w="3213" w:type="dxa"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="C00000"/></w:rPr><w:t>CONFIDENTIAL</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="14"/><w:color w:val="777777"/></w:rPr><w:t>Internal Use Only</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:ftr>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="222222"/></w:rPr>
    <w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="40"/><w:color w:val="1F3A5F"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="32"/><w:color w:val="2E5C8A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="26"/><w:color w:val="4A7BB0"/></w:rPr>
  </w:style>
</w:styles>`;

// Tema mínimo — o parser aceita qualquer coisa; só precisamos das entradas de fonte majoritária/minoritária.
const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sample">
  <a:themeElements>
    <a:clrScheme name="Sample">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F3A5F"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="2E5C8A"/></a:accent1>
      <a:accent2><a:srgbClr val="4A7BB0"/></a:accent2>
      <a:accent3><a:srgbClr val="70AD47"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="C00000"/></a:accent5>
      <a:accent6><a:srgbClr val="7030A0"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Sample">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`;

// ---------- Monta o zip ----------

const zip = new PizZip();
zip.file('[Content_Types].xml', CONTENT_TYPES);
zip.file('_rels/.rels', ROOT_RELS);
zip.file('word/document.xml', DOCUMENT_XML);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS);
zip.file('word/styles.xml', STYLES_XML);
zip.file('word/theme/theme1.xml', THEME_XML);
zip.file('word/header1.xml', HEADER_XML);
zip.file('word/_rels/header1.xml.rels', HEADER_RELS);
zip.file('word/footer1.xml', FOOTER_XML);
zip.file('word/media/image2.png', sampleLogo());

const outPath = path.resolve('tests/fixtures/docx/sample-requirements.docx');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
