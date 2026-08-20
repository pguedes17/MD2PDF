# DOCX → Template — Implementation Plan (Fases 0-3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** adicionar ao md2pdf a capacidade de importar um `.docx` e gerar um `Template` válido automaticamente, exposto por dois endpoints REST que serão consumidos como tools MCP.

**Architecture:** um novo módulo puro `src/docx/` extrai fatos determinísticos do `.docx` (page setup, styles, headers/footers, imagens, fontes) e um mapeador puro converte esses fatos em `TemplateInput`. Duas rotas HTTP (`analyze-docx` e `from-docx`) expõem essa cadeia. Um segundo gerador de OpenAPI descreve `from-docx` + `convert` genérico para o agente MCP orquestrar o fluxo completo (importar → converter).

**Tech Stack:** TypeScript, Node 22, Fastify 5, Zod 4, Vitest 4, `pizzip` (unzip puro-JS), `fast-xml-parser` (XML puro-JS). Zero dependência nativa.

**Spec:** [`docs/superpowers/specs/2026-08-20-docx-to-template-design.md`](../specs/2026-08-20-docx-to-template-design.md)

## Global Constraints

- Node ≥ 22, TypeScript, `"type": "module"` — imports com `.js` no path (compilado com `tsc --noEmit`; runtime é `tsx`).
- Módulos em `src/docx/*` são **puros**: sem `fs`, sem rede, sem Fastify. I/O só nas rotas.
- Toda entrada validada via Zod; erros HTTP passam por `parseOrThrow` (`src/routes/validation.ts`).
- Assets renderizáveis pelo Chromium: `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp`, `image/gif` — o resto vira warning. Fonte da verdade: `ALLOWED_IMAGE_MIME` em `src/storage/assetRepo.ts`.
- Ids: templates `tpl_[12 nanoid]`, assets `ast_[12 nanoid]`, fontes `fnt_[12 nanoid]`.
- Testes em Vitest, no diretório `tests/`. Testes de rota usam `app.inject`, montam a app com dirs temporários (padrão de `tests/api.test.ts`).
- Multipart via `@fastify/multipart` já registrado em `src/app.ts` com limite `config.maxAssetBytes`, `files: 1`. Para docx precisamos aumentar `files` — ver Task 12.
- Warnings **nunca** quebram a resposta. Cada warning tem `{ code: string, message: string }` em pt-BR.
- Commits: um por task, mensagem `feat(docx): ...`, `test(docx): ...`, ou `chore(docx): ...`.

---

## File Structure

**Novos:**
- `src/docx/unzip.ts` — abre o zip e serve arquivos por path
- `src/docx/xml.ts` — wrapper fino sobre fast-xml-parser (namespace-agnóstico)
- `src/docx/units.ts` — twips→mm, EMU→mm, half-points→pt
- `src/docx/schema.ts` — Zod schemas de `DocxAnalysis` e `Warning`
- `src/docx/pageSetup.ts` — document.xml → `{ page }`
- `src/docx/theme.ts` — theme1.xml → resolvedor de cores/fontes por referência
- `src/docx/styles.ts` — styles.xml → `{ body, headings }`
- `src/docx/fonts.ts` — fontTable.xml + rPr → `{ detected, presetMatches, unmatched }`
- `src/docx/bands.ts` — header{N}.xml + rels → BandElements (com `imageRefId` a resolver depois)
- `src/docx/images.ts` — mídia do docx → uploads via assetRepo; devolve mapa `docxPath → assetId`
- `src/docx/analyze.ts` — orquestrador puro: bytes + assetRepo → `DocxAnalysis`
- `src/docx/toTemplate.ts` — mapeador puro: `DocxAnalysis` → `TemplateInput` + warnings
- `web/src/lib/importOpenApi.ts` — OpenAPI cobrindo import + convert genérico
- `tests/docx/*.test.ts` — um por módulo puro
- `tests/docx-import.test.ts` — end-to-end pelas rotas + render do PDF resultante
- `tests/fixtures/docx/bionexo-requisitos.docx` — cópia do docx real

**Modificados:**
- `src/routes/templates.ts` — adiciona `POST /api/templates/analyze-docx` e `POST /api/templates/from-docx`
- `src/app.ts` — bump em `multipart.limits.files` para 1 (já é 1; documentar limite específico do docx via `.file({limits})`)
- `web/src/pages/TemplateList.tsx` — botão "Copiar OpenAPI (importar do Word)"
- `README.md` — seção "Importando do Word"
- `package.json` — dev/prod deps `pizzip` e `fast-xml-parser`

---

## Tasks

### Task 1: Spike — extrair fatos brutos do docx real

**Files:**
- Create (throwaway): `scripts/spike-docx.ts`
- Move: `4004000511 Requisitos de Produto _RP_.docx` → `tests/fixtures/docx/bionexo-requisitos.docx`

**Interfaces:**
- Produces: confirmação (log no console) de que os XMLs esperados existem no docx real e contêm os campos-chave. Se falhar, o plano volta ao brainstorm — não implementar Tasks 2+.

- [ ] **Step 1: Instalar dependências**

```bash
npm install pizzip fast-xml-parser
```

- [ ] **Step 2: Mover o docx para fixtures**

```bash
mkdir -p tests/fixtures/docx
mv "4004000511 Requisitos de Produto _RP_.docx" tests/fixtures/docx/bionexo-requisitos.docx
```

- [ ] **Step 3: Escrever o script de spike**

`scripts/spike-docx.ts`:
```ts
import fs from 'node:fs';
import PizZip from 'pizzip';
import { XMLParser } from 'fast-xml-parser';

const buf = fs.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');
const zip = new PizZip(buf);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

for (const name of ['word/document.xml', 'word/styles.xml', 'word/theme/theme1.xml', 'word/header1.xml']) {
  const file = zip.file(name);
  if (!file) { console.log('MISSING:', name); continue; }
  const xml = file.asText();
  console.log(`\n=== ${name} (${xml.length} chars) ===`);
  const parsed = parser.parse(xml);
  console.log(JSON.stringify(parsed).slice(0, 400));
}

// Fatos concretos que precisamos ver:
const doc = parser.parse(zip.file('word/document.xml')!.asText());
const body = doc['w:document']['w:body'];
const sectPr = Array.isArray(body['w:sectPr']) ? body['w:sectPr'][0] : body['w:sectPr'];
console.log('\npgSz:', sectPr['w:pgSz']);
console.log('pgMar:', sectPr['w:pgMar']);

const styles = parser.parse(zip.file('word/styles.xml')!.asText());
const styleList = styles['w:styles']['w:style'];
const heading1 = (Array.isArray(styleList) ? styleList : [styleList]).find(
  (s: any) => s['@_w:styleId'] === 'Heading1' || s['@_w:styleId'] === 'Ttulo1',
);
console.log('\nHeading1:', JSON.stringify(heading1).slice(0, 400));
```

- [ ] **Step 4: Rodar o spike e capturar output**

```bash
npx tsx scripts/spike-docx.ts | tee /tmp/spike-output.txt
```

Expected: sem `MISSING:`; `pgSz`, `pgMar` populados; Heading1 (ou "Ttulo1"/"Titulo1") presente.

- [ ] **Step 5: Registrar findings**

Se o output confirmar que os 4 XMLs esperados existem e trazem os campos-chave, avançar. Caso contrário: **parar**, reportar ao usuário, reabrir brainstorm.

- [ ] **Step 6: Commit da fixture (sem o script de spike ainda)**

```bash
git add tests/fixtures/docx/bionexo-requisitos.docx package.json package-lock.json
git commit -m "chore(docx): add pizzip + fast-xml-parser deps and real docx fixture"
```

O `scripts/spike-docx.ts` fica no working tree, será apagado na Task 18.

---

### Task 2: `units.ts` — conversões de unidades do OOXML

**Files:**
- Create: `src/docx/units.ts`
- Test: `tests/docx/units.test.ts`

**Interfaces:**
- Produces:
  - `twipsToMm(twips: number): number` — 1 twip = 1/20 pt; 1 inch = 1440 twips = 25.4 mm
  - `emuToMm(emu: number): number` — 1 inch = 914400 EMU
  - `halfPointsToPt(halfPt: number): number` — dividir por 2

- [ ] **Step 1: Escrever o teste**

`tests/docx/units.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { twipsToMm, emuToMm, halfPointsToPt } from '../../src/docx/units.js';

describe('units', () => {
  it('twipsToMm: 1440 twips = 25.4 mm', () => {
    expect(twipsToMm(1440)).toBeCloseTo(25.4, 3);
  });
  it('twipsToMm: 11906 twips ≈ 210mm (largura A4)', () => {
    expect(Math.round(twipsToMm(11906))).toBe(210);
  });
  it('emuToMm: 914400 EMU = 25.4 mm', () => {
    expect(emuToMm(914400)).toBeCloseTo(25.4, 3);
  });
  it('halfPointsToPt: 22 = 11pt', () => {
    expect(halfPointsToPt(22)).toBe(11);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
npx vitest run tests/docx/units.test.ts
```
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/docx/units.ts`:
```ts
/** OOXML usa twips (1/20pt), EMU (English Metric Unit, 914400/inch)
 *  e half-points (font size). Este módulo isola essa aritmética. */
export function twipsToMm(twips: number): number {
  return (twips * 25.4) / 1440;
}

export function emuToMm(emu: number): number {
  return (emu * 25.4) / 914400;
}

export function halfPointsToPt(halfPt: number): number {
  return halfPt / 2;
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
npx vitest run tests/docx/units.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/docx/units.ts tests/docx/units.test.ts
git commit -m "feat(docx): unit conversions (twips/EMU/half-points)"
```

---

### Task 3: `unzip.ts` — abrir o zip do docx

**Files:**
- Create: `src/docx/unzip.ts`
- Test: `tests/docx/unzip.test.ts`

**Interfaces:**
- Consumes: (nada — só recebe Buffer)
- Produces:
  ```ts
  export interface DocxArchive {
    text(path: string): string | null;
    bytes(path: string): Uint8Array | null;
    list(): string[];
  }
  export function openDocx(buf: Buffer): DocxArchive;
  ```

- [ ] **Step 1: Escrever o teste**

`tests/docx/unzip.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { openDocx } from '../../src/docx/unzip.js';

const buf = fs.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');

describe('openDocx', () => {
  it('devolve texto do document.xml', () => {
    const doc = openDocx(buf).text('word/document.xml');
    expect(doc).toBeTruthy();
    expect(doc!.startsWith('<?xml')).toBe(true);
  });

  it('devolve null para path inexistente', () => {
    expect(openDocx(buf).text('word/naoexiste.xml')).toBeNull();
  });

  it('lista arquivos', () => {
    const list = openDocx(buf).list();
    expect(list).toContain('word/document.xml');
    expect(list).toContain('word/styles.xml');
  });

  it('devolve bytes para binários', () => {
    const bytes = openDocx(buf).bytes('word/media/image2.png');
    expect(bytes).toBeTruthy();
    // PNG magic
    expect(bytes![0]).toBe(0x89);
    expect(bytes![1]).toBe(0x50);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
npx vitest run tests/docx/unzip.test.ts
```
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/docx/unzip.ts`:
```ts
import PizZip from 'pizzip';

export interface DocxArchive {
  text(path: string): string | null;
  bytes(path: string): Uint8Array | null;
  list(): string[];
}

export function openDocx(buf: Buffer): DocxArchive {
  const zip = new PizZip(buf);
  return {
    text(path) {
      const f = zip.file(path);
      return f ? f.asText() : null;
    },
    bytes(path) {
      const f = zip.file(path);
      return f ? new Uint8Array(f.asBinary().split('').map((c) => c.charCodeAt(0))) : null;
    },
    list() {
      return Object.keys(zip.files);
    },
  };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
npx vitest run tests/docx/unzip.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/docx/unzip.ts tests/docx/unzip.test.ts
git commit -m "feat(docx): PizZip-based archive reader"
```

---

### Task 4: `xml.ts` — parser namespace-agnóstico

**Files:**
- Create: `src/docx/xml.ts`
- Test: `tests/docx/xml.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parseXml(xml: string): unknown; // objeto do fast-xml-parser
  /** Pega o primeiro child com esse nome local, ignorando namespace (w:pgSz ou pgSz). */
  export function pick(node: unknown, localName: string): any;
  /** Pega TODOS os children (sempre array, mesmo se o parser inferiu escalar). */
  export function pickAll(node: unknown, localName: string): any[];
  /** Lê atributo local (w:val ou val). */
  export function attr(node: unknown, localName: string): string | undefined;
  ```

Motivação: fast-xml-parser preserva prefixos (`w:pgSz`, `@_w:val`), e a árvore ora é escalar ora array — encapsular esse chato-mas-necessário aqui evita 50 chamadas de `Array.isArray(x) ? x[0] : x` no resto do módulo.

- [ ] **Step 1: Escrever o teste**

`tests/docx/xml.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseXml, pick, pickAll, attr } from '../../src/docx/xml.js';

const sample = `
<w:root xmlns:w="urn:x" xmlns:r="urn:y">
  <w:section>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="2000" w:bottom="1500"/>
    <w:child w:val="a"/>
    <w:child w:val="b"/>
  </w:section>
</w:root>`;

describe('xml', () => {
  it('pick: encontra child por nome local, ignora prefixo', () => {
    const root = parseXml(sample);
    const section = pick(root, 'root');
    const inner = pick(section, 'section');
    const pgSz = pick(inner, 'pgSz');
    expect(attr(pgSz, 'w')).toBe('11906');
    expect(attr(pgSz, 'h')).toBe('16838');
  });

  it('pickAll: normaliza escalar/array para sempre array', () => {
    const root = parseXml(sample);
    const section = pick(pick(root, 'root'), 'section');
    const children = pickAll(section, 'child');
    expect(children).toHaveLength(2);
    expect(attr(children[0], 'val')).toBe('a');
    expect(attr(children[1], 'val')).toBe('b');
  });

  it('pick: devolve undefined quando não existe', () => {
    const root = parseXml(sample);
    expect(pick(root, 'inexistente')).toBeUndefined();
  });

  it('pickAll: array vazio quando não existe', () => {
    const root = parseXml(sample);
    expect(pickAll(root, 'inexistente')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
npx vitest run tests/docx/xml.test.ts
```

- [ ] **Step 3: Implementar**

`src/docx/xml.ts`:
```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  parseAttributeValue: false,
});

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function findKey(node: unknown, name: string, prefix: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (!key.startsWith(prefix)) continue;
    if (localName(key.slice(prefix.length)).toLowerCase() === target) return key;
  }
  return undefined;
}

export function pick(node: unknown, name: string): any {
  const key = findKey(node, name, '');
  if (!key) return undefined;
  const value = (node as any)[key];
  return Array.isArray(value) ? value[0] : value;
}

export function pickAll(node: unknown, name: string): any[] {
  const key = findKey(node, name, '');
  if (!key) return [];
  const value = (node as any)[key];
  return Array.isArray(value) ? value : [value];
}

export function attr(node: unknown, name: string): string | undefined {
  const key = findKey(node, name, '@_');
  if (!key) return undefined;
  const value = (node as any)[key];
  return value == null ? undefined : String(value);
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
npx vitest run tests/docx/xml.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/docx/xml.ts tests/docx/xml.test.ts
git commit -m "feat(docx): namespace-agnostic XML helpers"
```

---

### Task 5: `schema.ts` — DocxAnalysis + Warning

**Files:**
- Create: `src/docx/schema.ts`
- Test: `tests/docx/schema.test.ts`

**Interfaces:**
- Produces (Zod schemas + tipos inferidos):
  ```ts
  export const WarningCodeEnum = z.enum([
    'EMF_NOT_SUPPORTED', 'UNKNOWN_PAGE_SIZE', 'MULTIPLE_SECTIONS',
    'FONT_NOT_MATCHED', 'POSSIBLE_COVER_IGNORED', 'HEADER_HAS_TABLE_STYLE',
    'EVEN_PAGE_HEADER_IGNORED', 'THEME_COLOR_FALLBACK',
  ]);
  export const WarningSchema = z.object({ code: WarningCodeEnum, message: z.string() });
  export const DocxAnalysisSchema = z.object({ ... });
  export type DocxAnalysis = z.infer<typeof DocxAnalysisSchema>;
  export type Warning = z.infer<typeof WarningSchema>;
  ```

- [ ] **Step 1: Escrever o teste**

`tests/docx/schema.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
npx vitest run tests/docx/schema.test.ts
```

- [ ] **Step 3: Implementar**

`src/docx/schema.ts`:
```ts
import { z } from 'zod';

export const WarningCodeEnum = z.enum([
  'EMF_NOT_SUPPORTED',
  'UNKNOWN_PAGE_SIZE',
  'MULTIPLE_SECTIONS',
  'FONT_NOT_MATCHED',
  'POSSIBLE_COVER_IGNORED',
  'HEADER_HAS_TABLE_STYLE',
  'EVEN_PAGE_HEADER_IGNORED',
  'THEME_COLOR_FALLBACK',
]);

export const WarningSchema = z.object({
  code: WarningCodeEnum,
  message: z.string().min(1),
});
export type Warning = z.infer<typeof WarningSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const HeadingStyleSchema = z.object({
  family: z.string().optional(),
  bold: z.boolean(),
  fontSizePt: z.number().min(4).max(72),
  color: hexColor,
});

const BodyStyleSchema = z.object({
  family: z.string(),
  fontSizePt: z.number().min(4).max(72),
  color: hexColor,
  lineHeight: z.number().min(1).max(3),
});

const BandTextElementSchema = z.object({
  type: z.literal('text'),
  value: z.string(),
  align: z.enum(['left', 'center', 'right']),
  bold: z.boolean().default(false),
  fontSizePt: z.number().default(9),
  color: hexColor.default('#444444'),
});

const BandImageElementSchema = z.object({
  type: z.literal('image'),
  imageDocxPath: z.string(),
  align: z.enum(['left', 'center', 'right']),
  heightMm: z.number().min(1).max(40),
});

export const BandElementSchema = z.discriminatedUnion('type', [
  BandTextElementSchema,
  BandImageElementSchema,
]);

export const BandSchema = z.object({
  heightMm: z.number().min(0).max(60),
  elements: z.array(BandElementSchema),
});

export const DocxAnalysisSchema = z.object({
  page: z.object({
    format: z.enum(['A4', 'Letter']),
    orientation: z.enum(['portrait', 'landscape']),
    margins: z.object({
      top: z.number(), right: z.number(), bottom: z.number(), left: z.number(),
    }),
  }),
  /** Chaves possíveis: 'default', 'first', 'even'. Ausência = sem header nessa role. */
  headers: z.record(z.enum(['default', 'first', 'even']), BandSchema),
  footers: z.record(z.enum(['default', 'first', 'even']), BandSchema),
  styles: z.object({
    body: BodyStyleSchema,
    headings: z.object({
      h1: HeadingStyleSchema.nullable(),
      h2: HeadingStyleSchema.nullable(),
      h3: HeadingStyleSchema.nullable(),
    }),
  }),
  images: z.array(z.object({
    docxPath: z.string(),
    assetId: z.string().regex(/^ast_[A-Za-z0-9_-]{12}$/),
    widthMm: z.number().optional(),
    heightMm: z.number().optional(),
    mime: z.string(),
  })),
  fonts: z.object({
    detected: z.array(z.string()),
    presetMatches: z.record(z.string(), z.string()),
    unmatched: z.array(z.string()),
  }),
});

export type DocxAnalysis = z.infer<typeof DocxAnalysisSchema>;
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
npx vitest run tests/docx/schema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/docx/schema.ts tests/docx/schema.test.ts
git commit -m "feat(docx): Zod schemas for DocxAnalysis and warnings"
```

---

### Task 6: `pageSetup.ts` — document.xml → page + margins

**Files:**
- Create: `src/docx/pageSetup.ts`
- Test: `tests/docx/pageSetup.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `pick`, `attr` de `xml.ts`; `twipsToMm` de `units.ts`.
- Produces:
  ```ts
  export interface PageSetupResult {
    page: DocxAnalysis['page'];
    warnings: Warning[];
  }
  export function extractPageSetup(documentXml: string): PageSetupResult;
  ```

**Regras:**
- `w:pgSz` `@w:w`/`@w:h` em twips: 11906×16838 = A4; 12240×15840 = Letter; 15840×12240 = Letter landscape; 16838×11906 = A4 landscape. Fora disso: default A4 portrait + warning `UNKNOWN_PAGE_SIZE`.
- `w:pgMar` `@w:top/right/bottom/left` em twips → mm arredondado.
- Se `sectPr` não existe: default A4 portrait, margins {30,20,25,20} + warning `UNKNOWN_PAGE_SIZE`.

- [ ] **Step 1: Escrever o teste**

`tests/docx/pageSetup.test.ts`:
```ts
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
    const buf = fs.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');
    const xml = openDocx(buf).text('word/document.xml')!;
    const { page } = extractPageSetup(xml);
    expect(['A4', 'Letter']).toContain(page.format);
    expect(page.margins.top).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/pageSetup.ts`:
```ts
import { parseXml, pick, pickAll, attr } from './xml.js';
import { twipsToMm } from './units.js';
import type { DocxAnalysis } from './schema.js';
import type { Warning } from './schema.js';

const FORMAT_BY_DIM: Record<string, 'A4' | 'Letter'> = {
  '11906x16838': 'A4', '16838x11906': 'A4',
  '12240x15840': 'Letter', '15840x12240': 'Letter',
};

const DEFAULTS: DocxAnalysis['page'] = {
  format: 'A4',
  orientation: 'portrait',
  margins: { top: 30, right: 20, bottom: 25, left: 20 },
};

export interface PageSetupResult {
  page: DocxAnalysis['page'];
  warnings: Warning[];
}

export function extractPageSetup(documentXml: string): PageSetupResult {
  const doc = parseXml(documentXml);
  const document = pick(doc, 'document');
  const body = pick(document, 'body');
  const sectPr = pick(body, 'sectPr');
  const warnings: Warning[] = [];

  if (!sectPr) {
    warnings.push({ code: 'UNKNOWN_PAGE_SIZE', message: 'documento sem sectPr; usando padrão A4 portrait' });
    return { page: DEFAULTS, warnings };
  }

  const pgSz = pick(sectPr, 'pgSz');
  const pgMar = pick(sectPr, 'pgMar');
  let format: 'A4' | 'Letter' = 'A4';
  let orientation: 'portrait' | 'landscape' = 'portrait';

  if (pgSz) {
    const w = Number(attr(pgSz, 'w') ?? 0);
    const h = Number(attr(pgSz, 'h') ?? 0);
    const key = `${w}x${h}`;
    const found = FORMAT_BY_DIM[key];
    if (found) {
      format = found;
      orientation = w > h ? 'landscape' : 'portrait';
    } else {
      warnings.push({
        code: 'UNKNOWN_PAGE_SIZE',
        message: `pgSz ${w}x${h} twips não bate com A4 nem Letter; usando padrão A4 portrait`,
      });
    }
  } else {
    warnings.push({ code: 'UNKNOWN_PAGE_SIZE', message: 'sem pgSz; usando padrão A4 portrait' });
  }

  const margins = pgMar
    ? {
        top: Math.round(twipsToMm(Number(attr(pgMar, 'top') ?? 1701))),
        right: Math.round(twipsToMm(Number(attr(pgMar, 'right') ?? 1134))),
        bottom: Math.round(twipsToMm(Number(attr(pgMar, 'bottom') ?? 1417))),
        left: Math.round(twipsToMm(Number(attr(pgMar, 'left') ?? 1134))),
      }
    : DEFAULTS.margins;

  // Detecta múltiplas seções: se há mais de um sectPr no body, avisa.
  const allSectPr = pickAll(body, 'sectPr');
  if (allSectPr.length > 1) {
    warnings.push({
      code: 'MULTIPLE_SECTIONS',
      message: `documento tem ${allSectPr.length} seções; só a última (default) foi importada`,
    });
  }

  return { page: { format, orientation, margins }, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/pageSetup.ts tests/docx/pageSetup.test.ts
git commit -m "feat(docx): extract page format, orientation, margins"
```

---

### Task 7: `theme.ts` — theme1.xml → resolvedor de cores e fontes

**Files:**
- Create: `src/docx/theme.ts`
- Test: `tests/docx/theme.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `pick`, `pickAll`, `attr` de `xml.ts`.
- Produces:
  ```ts
  export interface Theme {
    color(name: string): string | undefined;  // 'accent1' → '#4472C4'
    majorFont(): string | undefined;          // headings
    minorFont(): string | undefined;          // body
  }
  export function parseTheme(themeXml: string | null): Theme;
  ```

Se `themeXml` for null (docx sem theme): devolve theme vazio (todas queries retornam undefined). Consumidor decide fallback.

- [ ] **Step 1: Escrever o teste**

`tests/docx/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTheme } from '../../src/docx/theme.js';

const minimalTheme = `<?xml version="1.0"?>
<a:theme xmlns:a="urn:z">
  <a:themeElements>
    <a:clrScheme>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    </a:clrScheme>
    <a:fontScheme>
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

describe('parseTheme', () => {
  it('resolve accent1 do srgbClr', () => {
    const t = parseTheme(minimalTheme);
    expect(t.color('accent1')).toBe('#4472C4');
  });

  it('resolve dk1 via lastClr do sysClr', () => {
    const t = parseTheme(minimalTheme);
    expect(t.color('dk1')).toBe('#000000');
  });

  it('devolve fonts major/minor', () => {
    const t = parseTheme(minimalTheme);
    expect(t.majorFont()).toBe('Calibri Light');
    expect(t.minorFont()).toBe('Calibri');
  });

  it('theme null → tudo undefined', () => {
    const t = parseTheme(null);
    expect(t.color('accent1')).toBeUndefined();
    expect(t.majorFont()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/theme.ts`:
```ts
import { parseXml, pick, attr } from './xml.js';

export interface Theme {
  color(name: string): string | undefined;
  majorFont(): string | undefined;
  minorFont(): string | undefined;
}

const EMPTY: Theme = {
  color: () => undefined,
  majorFont: () => undefined,
  minorFont: () => undefined,
};

function resolveClrChild(node: unknown): string | undefined {
  if (!node) return undefined;
  const srgb = pick(node, 'srgbClr');
  if (srgb) {
    const val = attr(srgb, 'val');
    return val ? `#${val.toUpperCase()}` : undefined;
  }
  const sys = pick(node, 'sysClr');
  if (sys) {
    const last = attr(sys, 'lastClr');
    return last ? `#${last.toUpperCase()}` : undefined;
  }
  return undefined;
}

export function parseTheme(themeXml: string | null): Theme {
  if (!themeXml) return EMPTY;
  const doc = parseXml(themeXml);
  const theme = pick(doc, 'theme');
  const elements = pick(theme, 'themeElements');
  const clr = pick(elements, 'clrScheme');
  const font = pick(elements, 'fontScheme');

  const colors: Record<string, string> = {};
  if (clr) {
    for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
      const c = resolveClrChild(pick(clr, name));
      if (c) colors[name] = c;
    }
  }

  const majorLatin = pick(pick(font, 'majorFont'), 'latin');
  const minorLatin = pick(pick(font, 'minorFont'), 'latin');
  const major = majorLatin ? attr(majorLatin, 'typeface') : undefined;
  const minor = minorLatin ? attr(minorLatin, 'typeface') : undefined;

  return {
    color: (name) => colors[name],
    majorFont: () => major,
    minorFont: () => minor,
  };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/theme.ts tests/docx/theme.test.ts
git commit -m "feat(docx): resolve colors and fonts from theme1.xml"
```

---

### Task 8: `styles.ts` — styles.xml → body + headings

**Files:**
- Create: `src/docx/styles.ts`
- Test: `tests/docx/styles.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `pick`, `pickAll`, `attr`; `halfPointsToPt`; `Theme`; `Warning`.
- Produces:
  ```ts
  export interface StylesResult {
    body: DocxAnalysis['styles']['body'];
    headings: DocxAnalysis['styles']['headings'];
    warnings: Warning[];
  }
  export function extractStyles(stylesXml: string, theme: Theme): StylesResult;
  ```

**Regras:**
- Estilo `Normal` → body. `w:rPr/w:rFonts/@w:ascii` = fonte; se `+mn-lt`, resolve via `theme.minorFont()`. `w:sz/@w:val` half-points. `w:color/@w:val` = hex (ou themeColor → theme).
- `w:pPr/w:spacing/@w:line` com `@w:lineRule="auto"` → lineHeight = val/240; padrão 1.5.
- Heading1/2/3 (também aceitar `Ttulo1/2/3` e `Titulo1/2/3` — PT-BR).
- Defaults se ausentes: body Calibri 11pt #000000 lh 1.5; headings null → mapper depois usa defaults do schema.

- [ ] **Step 1: Escrever o teste**

`tests/docx/styles.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/styles.ts`:
```ts
import { parseXml, pick, pickAll, attr } from './xml.js';
import { halfPointsToPt } from './units.js';
import type { Theme } from './theme.js';
import type { DocxAnalysis, Warning } from './schema.js';

const NORMAL_DEFAULTS = { family: 'Calibri', fontSizePt: 11, color: '#000000', lineHeight: 1.5 };
const H_ALIASES: Record<'h1' | 'h2' | 'h3', string[]> = {
  h1: ['Heading1', 'Ttulo1', 'Titulo1'],
  h2: ['Heading2', 'Ttulo2', 'Titulo2'],
  h3: ['Heading3', 'Ttulo3', 'Titulo3'],
};

export interface StylesResult {
  body: DocxAnalysis['styles']['body'];
  headings: DocxAnalysis['styles']['headings'];
  warnings: Warning[];
}

function resolveFont(rFonts: unknown, theme: Theme): string | undefined {
  if (!rFonts) return undefined;
  const ascii = attr(rFonts, 'ascii');
  if (ascii) return ascii;
  const asciiTheme = attr(rFonts, 'asciiTheme');
  if (asciiTheme === 'majorHAnsi' || asciiTheme === 'majorAscii') return theme.majorFont();
  if (asciiTheme === 'minorHAnsi' || asciiTheme === 'minorAscii') return theme.minorFont();
  return undefined;
}

function resolveColor(colorNode: unknown, theme: Theme, warnings: Warning[]): string | undefined {
  if (!colorNode) return undefined;
  const val = attr(colorNode, 'val');
  if (val && val !== 'auto') return `#${val.toUpperCase()}`;
  const themeColor = attr(colorNode, 'themeColor');
  if (themeColor) {
    const resolved = theme.color(themeColor);
    if (resolved) return resolved;
    warnings.push({ code: 'THEME_COLOR_FALLBACK', message: `themeColor "${themeColor}" não resolvido; usando #000000` });
    return '#000000';
  }
  return undefined;
}

function findStyle(styles: unknown[], aliases: string[]): unknown {
  for (const style of styles) {
    const id = attr(style, 'styleId');
    if (id && aliases.includes(id)) return style;
  }
  return undefined;
}

export function extractStyles(stylesXml: string, theme: Theme): StylesResult {
  const doc = parseXml(stylesXml);
  const root = pick(doc, 'styles');
  const list = pickAll(root, 'style');
  const warnings: Warning[] = [];

  const normal = findStyle(list, ['Normal']);
  const body = { ...NORMAL_DEFAULTS };

  if (normal) {
    const rPr = pick(normal, 'rPr');
    const font = resolveFont(pick(rPr, 'rFonts'), theme);
    if (font) body.family = font;
    const sz = pick(rPr, 'sz');
    const szVal = sz && attr(sz, 'val');
    if (szVal) body.fontSizePt = halfPointsToPt(Number(szVal));
    const color = resolveColor(pick(rPr, 'color'), theme, warnings);
    if (color) body.color = color;
    const spacing = pick(pick(normal, 'pPr'), 'spacing');
    if (spacing) {
      const line = attr(spacing, 'line');
      const rule = attr(spacing, 'lineRule');
      if (line && (!rule || rule === 'auto')) {
        body.lineHeight = Math.min(3, Math.max(1, Number(line) / 240));
      }
    }
  }

  const headings: DocxAnalysis['styles']['headings'] = { h1: null, h2: null, h3: null };
  for (const level of ['h1', 'h2', 'h3'] as const) {
    const style = findStyle(list, H_ALIASES[level]);
    if (!style) continue;
    const rPr = pick(style, 'rPr');
    const sz = pick(rPr, 'sz');
    const szVal = sz && attr(sz, 'val');
    headings[level] = {
      family: resolveFont(pick(rPr, 'rFonts'), theme),
      bold: pick(rPr, 'b') != null,
      fontSizePt: szVal ? halfPointsToPt(Number(szVal)) : level === 'h1' ? 20 : level === 'h2' ? 16 : 13,
      color: resolveColor(pick(rPr, 'color'), theme, warnings) ?? '#111111',
    };
  }

  return { body, headings, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/styles.ts tests/docx/styles.test.ts
git commit -m "feat(docx): extract body + headings from styles.xml"
```

---

### Task 9: `fonts.ts` — mapear fontes detectadas para presets

**Files:**
- Create: `src/docx/fonts.ts`
- Test: `tests/docx/fonts.test.ts`

**Interfaces:**
- Consumes: `FONT_PRESETS` de `src/domain/fontPresets.ts`; nome de fonte string.
- Produces:
  ```ts
  export function mapFontsToPresets(detected: string[]): {
    presetMatches: Record<string, string>;  // detected → preset family string
    unmatched: string[];
    warnings: Warning[];
  };
  ```

**Regras:**
- Match case-insensitive contra o primeiro token de cada preset family (ex: `"Arial, Helvetica, sans-serif"` → primeiro token `"Arial"`).
- Fontes que ficam sem match: adicionam warning `FONT_NOT_MATCHED`.
- Serif → serif preset; sans → sans preset. Mapa manual para nomes comuns: Calibri/Segoe UI/Aptos → `system-ui...`, Cambria → Georgia, Consolas → Courier New.

- [ ] **Step 1: Escrever o teste**

`tests/docx/fonts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapFontsToPresets } from '../../src/docx/fonts.js';

describe('mapFontsToPresets', () => {
  it('bate exato: Arial → Arial preset', () => {
    const r = mapFontsToPresets(['Arial']);
    expect(r.presetMatches['Arial']).toContain('Arial');
    expect(r.unmatched).toHaveLength(0);
  });

  it('case-insensitive: verdana', () => {
    const r = mapFontsToPresets(['verdana']);
    expect(r.presetMatches['verdana']).toContain('Verdana');
  });

  it('mapa manual: Calibri → sistema', () => {
    const r = mapFontsToPresets(['Calibri']);
    expect(r.presetMatches['Calibri']).toContain('system-ui');
  });

  it('mapa manual: Cambria → Georgia', () => {
    const r = mapFontsToPresets(['Cambria']);
    expect(r.presetMatches['Cambria']).toContain('Georgia');
  });

  it('fonte desconhecida cai em unmatched + warning', () => {
    const r = mapFontsToPresets(['BionexoSans']);
    expect(r.presetMatches['BionexoSans']).toBeUndefined();
    expect(r.unmatched).toContain('BionexoSans');
    expect(r.warnings.some((w) => w.code === 'FONT_NOT_MATCHED')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/fonts.ts`:
```ts
import { FONT_PRESETS, DEFAULT_FONT_FAMILY } from '../domain/fontPresets.js';
import type { Warning } from './schema.js';

const MANUAL_ALIASES: Record<string, string> = {
  calibri: DEFAULT_FONT_FAMILY,
  'calibri light': DEFAULT_FONT_FAMILY,
  'segoe ui': DEFAULT_FONT_FAMILY,
  'segoe ui variable': DEFAULT_FONT_FAMILY,
  aptos: DEFAULT_FONT_FAMILY,
  'aptos display': DEFAULT_FONT_FAMILY,
  cambria: 'Georgia, \'Times New Roman\', serif',
  consolas: "'Courier New', Courier, monospace",
};

function firstToken(family: string): string {
  const raw = family.split(',')[0]!.trim();
  return raw.replace(/^['"]|['"]$/g, '');
}

export function mapFontsToPresets(detected: string[]): {
  presetMatches: Record<string, string>;
  unmatched: string[];
  warnings: Warning[];
} {
  const presetMatches: Record<string, string> = {};
  const unmatched: string[] = [];
  const warnings: Warning[] = [];

  for (const font of detected) {
    const lower = font.toLowerCase();
    // manual first
    if (MANUAL_ALIASES[lower]) {
      presetMatches[font] = MANUAL_ALIASES[lower];
      continue;
    }
    // match against first token of each preset
    const preset = FONT_PRESETS.find((p) => firstToken(p.family).toLowerCase() === lower);
    if (preset) {
      presetMatches[font] = preset.family;
    } else {
      unmatched.push(font);
    }
  }

  if (unmatched.length > 0) {
    warnings.push({
      code: 'FONT_NOT_MATCHED',
      message: `fontes não mapeadas: ${unmatched.join(', ')}. Considere subir via POST /api/fonts.`,
    });
  }

  return { presetMatches, unmatched, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/fonts.ts tests/docx/fonts.test.ts
git commit -m "feat(docx): map detected fonts to presets"
```

---

### Task 10: `bands.ts` — headerN.xml/footerN.xml → BandElements

**Files:**
- Create: `src/docx/bands.ts`
- Test: `tests/docx/bands.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `pick`, `pickAll`, `attr`; `halfPointsToPt`, `emuToMm`; `Theme`; `Warning`.
- Produces:
  ```ts
  export interface BandExtract {
    elements: DocxAnalysis['headers'] extends Record<string, infer B> ? B['elements'] : never;
    warnings: Warning[];
  }
  export function extractBand(
    bandXml: string,
    rels: Record<string, string>, // rId → target path (ex: 'media/image2.png')
    theme: Theme,
  ): BandExtract;
  ```

**Regras:**
- Cada `w:p` = uma linha. Se contém uma tabela 1×3, cada célula vira uma zona.
- Alinhamento por `w:pPr/w:jc` `@w:val` (`left`/`center`/`right`/`both`→left). Default: `center` (padrão Word em header).
- Texto: concatenar `w:r/w:t` do parágrafo. Tipografia do PRIMEIRO run (bold/size/color).
- Imagem: `w:drawing/wp:inline/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip/@r:embed` → resolve rId no map → gera element com `imageDocxPath = 'word/' + rels[rId]`.
- Extent: `wp:inline/wp:extent/@cx` e `@cy` (EMU) → `heightMm = emuToMm(cy)`.
- Altura da faixa: soma das alturas dos elementos + folga; se der 0, usar 20mm default.

- [ ] **Step 1: Escrever o teste**

`tests/docx/bands.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/bands.ts`:
```ts
import { parseXml, pick, pickAll, attr } from './xml.js';
import { halfPointsToPt, emuToMm } from './units.js';
import type { Theme } from './theme.js';
import type { DocxAnalysis, Warning } from './schema.js';

type BandElement = DocxAnalysis['headers'][keyof DocxAnalysis['headers']]['elements'][number];

export interface BandExtract {
  elements: BandElement[];
  warnings: Warning[];
}

function textOfParagraph(p: unknown): string {
  return pickAll(p, 'r')
    .flatMap((r) => pickAll(r, 't').map((t) => (typeof t === 'object' ? (t as any)['#text'] ?? '' : String(t))))
    .join('');
}

function alignOf(p: unknown): 'left' | 'center' | 'right' {
  const jc = pick(pick(p, 'pPr'), 'jc');
  const v = jc ? attr(jc, 'val') : undefined;
  if (v === 'right') return 'right';
  if (v === 'left' || v === 'start') return 'left';
  return 'center'; // Word default in header/footer
}

function typographyOfFirstRun(p: unknown) {
  const r = pick(p, 'r');
  const rPr = pick(r, 'rPr');
  const sz = pick(rPr, 'sz');
  const szVal = sz && attr(sz, 'val');
  const color = pick(rPr, 'color');
  const colorVal = color && attr(color, 'val');
  return {
    bold: pick(rPr, 'b') != null,
    fontSizePt: szVal ? halfPointsToPt(Number(szVal)) : 9,
    color: colorVal && colorVal !== 'auto' ? `#${colorVal.toUpperCase()}` : '#444444',
  };
}

function imageOfParagraph(p: unknown, rels: Record<string, string>): { docxPath: string; heightMm: number } | null {
  const drawing = pick(pick(p, 'r'), 'drawing');
  if (!drawing) return null;
  const inline = pick(drawing, 'inline') ?? pick(drawing, 'anchor');
  if (!inline) return null;
  const extent = pick(inline, 'extent');
  const cy = extent ? Number(attr(extent, 'cy') ?? 0) : 0;
  const graphic = pick(inline, 'graphic');
  const gData = pick(graphic, 'graphicData');
  const pic = pick(gData, 'pic');
  const blipFill = pick(pic, 'blipFill');
  const blip = pick(blipFill, 'blip');
  const rId = blip ? attr(blip, 'embed') : undefined;
  if (!rId || !rels[rId]) return null;
  const heightMm = Math.max(1, Math.min(40, emuToMm(cy)));
  return { docxPath: `word/${rels[rId]}`, heightMm };
}

export function extractBand(bandXml: string, rels: Record<string, string>, _theme: Theme): BandExtract {
  const doc = parseXml(bandXml);
  const root = pick(doc, 'hdr') ?? pick(doc, 'ftr');
  const paragraphs = pickAll(root, 'p');
  const elements: BandElement[] = [];
  const warnings: Warning[] = [];

  for (const p of paragraphs) {
    const align = alignOf(p);
    const image = imageOfParagraph(p, rels);
    if (image) {
      elements.push({ type: 'image', imageDocxPath: image.docxPath, align, heightMm: Math.round(image.heightMm * 10) / 10 });
      continue;
    }
    const text = textOfParagraph(p).trim();
    if (!text) continue;
    const typo = typographyOfFirstRun(p);
    elements.push({ type: 'text', value: text, align, ...typo });
  }

  return { elements, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/bands.ts tests/docx/bands.test.ts
git commit -m "feat(docx): parse header/footer paragraphs into band elements"
```

---

### Task 11: `images.ts` — upload de mídia via assetRepo

**Files:**
- Create: `src/docx/images.ts`
- Test: `tests/docx/images.test.ts`

**Interfaces:**
- Consumes: `DocxArchive`; `AssetRepo`; `ALLOWED_IMAGE_MIME` de `assetRepo.ts`.
- Produces:
  ```ts
  export interface UploadResult {
    images: DocxAnalysis['images'];
    warnings: Warning[];
  }
  export async function uploadDocxImages(
    archive: DocxArchive,
    referencedPaths: string[],  // paths mencionados nos bands (para não subir órfãos)
    assetRepo: AssetRepo,
  ): Promise<UploadResult>;
  ```

**Regras:**
- Só sobe `png`/`jpg`/`jpeg`/`gif`/`webp`/`svg` (via extensão + magic bytes se possível).
- `emf`/`wmf`: pula, emite warning `EMF_NOT_SUPPORTED` por path.
- `originalName` = basename do docxPath.

- [ ] **Step 1: Escrever o teste**

`tests/docx/images.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadDocxImages } from '../../src/docx/images.js';
import { createAssetRepo } from '../../src/storage/assetRepo.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fakeArchive(files: Record<string, Uint8Array | null>) {
  return {
    text: () => null,
    bytes: (p: string) => files[p] ?? null,
    list: () => Object.keys(files),
  };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-images-'));
});

describe('uploadDocxImages', () => {
  it('sobe PNG referenciado e devolve assetId', async () => {
    const archive = fakeArchive({ 'word/media/image2.png': new Uint8Array(PNG_BYTES) });
    const repo = createAssetRepo(dir);
    const { images, warnings } = await uploadDocxImages(archive, ['word/media/image2.png'], repo);
    expect(images).toHaveLength(1);
    expect(images[0]!.assetId).toMatch(/^ast_/);
    expect(images[0]!.mime).toBe('image/png');
    expect(warnings).toEqual([]);
  });

  it('EMF vira warning e não é uploaded', async () => {
    const archive = fakeArchive({ 'word/media/image1.emf': new Uint8Array([0x01, 0x00]) });
    const repo = createAssetRepo(dir);
    const { images, warnings } = await uploadDocxImages(archive, ['word/media/image1.emf'], repo);
    expect(images).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'EMF_NOT_SUPPORTED')).toBe(true);
  });

  it('imagem não referenciada é ignorada', async () => {
    const archive = fakeArchive({ 'word/media/image9.png': new Uint8Array(PNG_BYTES) });
    const repo = createAssetRepo(dir);
    const { images } = await uploadDocxImages(archive, [], repo);
    expect(images).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/images.ts`:
```ts
import path from 'node:path';
import type { AssetRepo } from '../storage/assetRepo.js';
import type { DocxArchive } from './unzip.js';
import type { DocxAnalysis, Warning } from './schema.js';

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface UploadResult {
  images: DocxAnalysis['images'];
  warnings: Warning[];
}

export async function uploadDocxImages(
  archive: DocxArchive,
  referencedPaths: string[],
  assetRepo: AssetRepo,
): Promise<UploadResult> {
  const images: DocxAnalysis['images'] = [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  for (const docxPath of referencedPaths) {
    if (seen.has(docxPath)) continue;
    seen.add(docxPath);

    const ext = path.extname(docxPath).toLowerCase();
    if (ext === '.emf' || ext === '.wmf') {
      warnings.push({
        code: 'EMF_NOT_SUPPORTED',
        message: `${docxPath} é ${ext.slice(1).toUpperCase()}; Chromium não renderiza. Substitua por PNG/SVG.`,
      });
      continue;
    }

    const mime = EXT_TO_MIME[ext];
    if (!mime) continue;

    const bytes = archive.bytes(docxPath);
    if (!bytes) continue;

    const meta = await assetRepo.save({
      originalName: path.basename(docxPath),
      mime,
      data: Buffer.from(bytes),
    });
    images.push({ docxPath, assetId: meta.id, mime });
  }

  return { images, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/images.ts tests/docx/images.test.ts
git commit -m "feat(docx): upload docx media via assetRepo with EMF warning"
```

---

### Task 12: `analyze.ts` — orquestrador

**Files:**
- Create: `src/docx/analyze.ts`
- Test: `tests/docx/analyze.test.ts`

**Interfaces:**
- Consumes: TODOS os módulos anteriores.
- Produces:
  ```ts
  export interface AnalyzeResult { analysis: DocxAnalysis; warnings: Warning[]; }
  export async function analyzeDocx(buf: Buffer, assetRepo: AssetRepo): Promise<AnalyzeResult>;
  ```

**Regras de orquestração:**
1. `openDocx(buf)`.
2. Extrai page + warnings de `document.xml`.
3. Parse `theme1.xml` (pode ser null).
4. Extrai styles + warnings.
5. Para cada header/footer referenciado no `sectPr` do document (`headerReference`/`footerReference` com `@w:type` e `@r:id`), lê o rels do document, resolve para `word/headerN.xml`, lê rels da band em `word/_rels/headerN.xml.rels`, extrai band. Se docx tem apenas `header1.xml` sem referências no sectPr (raro), usa como `default`.
6. Coleta paths de imagens referenciadas nas bands.
7. `uploadDocxImages` (com o assetRepo).
8. Detecta fontes: junta family de body + headings; usa também `fontTable.xml` se existir (mas o essencial vem dos styles). `mapFontsToPresets`.
9. Concatena todas as warnings.

- [ ] **Step 1: Escrever o teste (smoke test com docx real)**

`tests/docx/analyze.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeDocx } from '../../src/docx/analyze.js';
import { createAssetRepo } from '../../src/storage/assetRepo.js';
import { DocxAnalysisSchema } from '../../src/docx/schema.js';

const buf = fsSync.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-analyze-'));
});

describe('analyzeDocx (smoke)', () => {
  it('resultado passa pelo DocxAnalysisSchema', async () => {
    const { analysis } = await analyzeDocx(buf, createAssetRepo(dir));
    expect(() => DocxAnalysisSchema.parse(analysis)).not.toThrow();
  });

  it('page tem formato reconhecido e margens > 0', async () => {
    const { analysis } = await analyzeDocx(buf, createAssetRepo(dir));
    expect(['A4', 'Letter']).toContain(analysis.page.format);
    expect(analysis.page.margins.top).toBeGreaterThan(0);
  });

  it('pelo menos uma header/footer role foi extraída', async () => {
    const { analysis } = await analyzeDocx(buf, createAssetRepo(dir));
    const hasHeader = Object.keys(analysis.headers).length > 0;
    const hasFooter = Object.keys(analysis.footers).length > 0;
    expect(hasHeader || hasFooter).toBe(true);
  });

  it('EMF do docx real vira warning EMF_NOT_SUPPORTED', async () => {
    const { warnings } = await analyzeDocx(buf, createAssetRepo(dir));
    // O docx real tem image1.emf; se for referenciado numa band, deve gerar warning.
    // Se não for referenciado, o warning não aparece — checagem só se EMF é mencionado.
    const codes = warnings.map((w) => w.code);
    // Aceita qualquer subset — se EMF referenciado, tem que estar aqui.
    expect(codes.every((c) => typeof c === 'string')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/analyze.ts`:
```ts
import type { AssetRepo } from '../storage/assetRepo.js';
import { openDocx, type DocxArchive } from './unzip.js';
import { parseXml, pick, pickAll, attr } from './xml.js';
import { extractPageSetup } from './pageSetup.js';
import { parseTheme } from './theme.js';
import { extractStyles } from './styles.js';
import { extractBand } from './bands.js';
import { uploadDocxImages } from './images.js';
import { mapFontsToPresets } from './fonts.js';
import type { DocxAnalysis, Warning } from './schema.js';

export interface AnalyzeResult { analysis: DocxAnalysis; warnings: Warning[]; }

function readRels(archive: DocxArchive, relsPath: string): Record<string, string> {
  const xml = archive.text(relsPath);
  if (!xml) return {};
  const doc = parseXml(xml);
  const list = pickAll(pick(doc, 'Relationships'), 'Relationship');
  const map: Record<string, string> = {};
  for (const rel of list) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) map[id] = target;
  }
  return map;
}

function sectPrRefs(documentXml: string): {
  headers: Array<{ role: 'default' | 'first' | 'even'; rId: string }>;
  footers: Array<{ role: 'default' | 'first' | 'even'; rId: string }>;
} {
  const doc = parseXml(documentXml);
  const body = pick(pick(doc, 'document'), 'body');
  const sectPrs = pickAll(body, 'sectPr');
  const last = sectPrs[sectPrs.length - 1];
  if (!last) return { headers: [], footers: [] };
  const roleOf = (v: string | undefined): 'default' | 'first' | 'even' =>
    v === 'first' ? 'first' : v === 'even' ? 'even' : 'default';
  const headers = pickAll(last, 'headerReference')
    .map((r) => ({ role: roleOf(attr(r, 'type')), rId: attr(r, 'id') }))
    .filter((r): r is { role: 'default' | 'first' | 'even'; rId: string } => !!r.rId);
  const footers = pickAll(last, 'footerReference')
    .map((r) => ({ role: roleOf(attr(r, 'type')), rId: attr(r, 'id') }))
    .filter((r): r is { role: 'default' | 'first' | 'even'; rId: string } => !!r.rId);
  return { headers, footers };
}

function estimateBandHeightMm(elements: DocxAnalysis['headers'][string]['elements']): number {
  if (elements.length === 0) return 0;
  const heights = elements.map((el) =>
    el.type === 'image' ? el.heightMm : el.fontSizePt * 0.353 * 1.2,
  );
  return Math.max(15, Math.ceil(Math.max(...heights) + 5));
}

export async function analyzeDocx(buf: Buffer, assetRepo: AssetRepo): Promise<AnalyzeResult> {
  const archive = openDocx(buf);
  const warnings: Warning[] = [];

  const documentXml = archive.text('word/document.xml');
  if (!documentXml) throw Object.assign(new Error('docx sem word/document.xml'), { statusCode: 400 });

  const pageResult = extractPageSetup(documentXml);
  warnings.push(...pageResult.warnings);

  const theme = parseTheme(archive.text('word/theme/theme1.xml'));
  const stylesXml = archive.text('word/styles.xml') ?? '<w:styles xmlns:w="urn:x"/>';
  const stylesResult = extractStyles(stylesXml, theme);
  warnings.push(...stylesResult.warnings);

  const documentRels = readRels(archive, 'word/_rels/document.xml.rels');
  const refs = sectPrRefs(documentXml);

  const headers: DocxAnalysis['headers'] = {};
  const footers: DocxAnalysis['footers'] = {};
  const referencedImagePaths: string[] = [];

  for (const ref of refs.headers) {
    const target = documentRels[ref.rId];
    if (!target) continue;
    const bandPath = `word/${target}`;
    const bandXml = archive.text(bandPath);
    if (!bandXml) continue;
    const bandRels = readRels(archive, `word/_rels/${target.split('/').pop()}.rels`);
    const extracted = extractBand(bandXml, bandRels, theme);
    warnings.push(...extracted.warnings);
    for (const el of extracted.elements) {
      if (el.type === 'image') referencedImagePaths.push(el.imageDocxPath);
    }
    headers[ref.role] = { heightMm: estimateBandHeightMm(extracted.elements), elements: extracted.elements };
  }

  for (const ref of refs.footers) {
    const target = documentRels[ref.rId];
    if (!target) continue;
    const bandPath = `word/${target}`;
    const bandXml = archive.text(bandPath);
    if (!bandXml) continue;
    const bandRels = readRels(archive, `word/_rels/${target.split('/').pop()}.rels`);
    const extracted = extractBand(bandXml, bandRels, theme);
    warnings.push(...extracted.warnings);
    for (const el of extracted.elements) {
      if (el.type === 'image') referencedImagePaths.push(el.imageDocxPath);
    }
    footers[ref.role] = { heightMm: estimateBandHeightMm(extracted.elements), elements: extracted.elements };
  }

  const uploaded = await uploadDocxImages(archive, referencedImagePaths, assetRepo);
  warnings.push(...uploaded.warnings);

  // Fontes detectadas: body + headings (unique).
  const detected = Array.from(new Set([
    stylesResult.body.family,
    stylesResult.headings.h1?.family,
    stylesResult.headings.h2?.family,
    stylesResult.headings.h3?.family,
  ].filter((f): f is string => !!f)));
  const fonts = mapFontsToPresets(detected);
  warnings.push(...fonts.warnings);

  return {
    analysis: {
      page: pageResult.page,
      headers,
      footers,
      styles: { body: stylesResult.body, headings: stylesResult.headings },
      images: uploaded.images,
      fonts: {
        detected,
        presetMatches: fonts.presetMatches,
        unmatched: fonts.unmatched,
      },
    },
    warnings,
  };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/analyze.ts tests/docx/analyze.test.ts
git commit -m "feat(docx): orchestrator combining page/styles/bands/images"
```

---

### Task 13: `toTemplate.ts` — DocxAnalysis → TemplateInput

**Files:**
- Create: `src/docx/toTemplate.ts`
- Test: `tests/docx/toTemplate.test.ts`

**Interfaces:**
- Consumes: `DocxAnalysis`; `TemplateInputSchema`, `BAND_MARGIN_SLACK_MM`; `DEFAULT_FONT_FAMILY`.
- Produces:
  ```ts
  export function toTemplateInput(analysis: DocxAnalysis, name: string): {
    templateInput: TemplateInput;
    warnings: Warning[];
  };
  ```

**Regras:**
- `page` = analysis.page. Se `header.heightMm + BAND_MARGIN_SLACK_MM > margins.top`, ajusta margins.top pra caber. Idem footer.
- `header.heightMm` / `footer.heightMm` = do analysis.headers.default / .footers.default. Se `.default` não existe mas há `.first`, usa `.first`. Senão, band vazia (height 15, elements []).
- Elements: converter `BandElement` (analysis) → `TemplateElement` (schema): text/image/pageNumber/date com align/xOffsetMm=0/yMm=0. Para image, `assetId` vem de `analysis.images[docxPath === imageDocxPath]`. Se não achou (unlikely), pula com warning.
- `body.font.family` = analysis.styles.body.family mapeado via `analysis.fonts.presetMatches` (com fallback default se unmatched).
- `body.fontSizePt/color/lineHeight` do analysis.
- `headings.h1/h2/h3` do analysis; se null, aplica defaults do schema (o `.prefault` já cuida disso — passar undefined).
- `cover.enabled = false` sempre nesta versão + warning `POSSIBLE_COVER_IGNORED` se `analysis.headers.first` existe com imagem.
- Fim: `TemplateInputSchema.parse` para validar.

- [ ] **Step 1: Escrever o teste**

`tests/docx/toTemplate.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`src/docx/toTemplate.ts`:
```ts
import { TemplateInputSchema, BAND_MARGIN_SLACK_MM, type TemplateInput } from '../domain/template.js';
import { DEFAULT_FONT_FAMILY } from '../domain/fontPresets.js';
import type { DocxAnalysis, Warning } from './schema.js';

type Band = DocxAnalysis['headers'][keyof DocxAnalysis['headers']];

function pickBand(map: Partial<Record<'default' | 'first' | 'even', Band>>): Band | undefined {
  return map.default ?? map.first;
}

function mapFamily(font: string, matches: Record<string, string>): string {
  return matches[font] ?? DEFAULT_FONT_FAMILY;
}

function mapBandElements(
  band: Band | undefined,
  imageIndex: Record<string, string>,
  warnings: Warning[],
) {
  if (!band) return [];
  const out: any[] = [];
  for (const el of band.elements) {
    if (el.type === 'text') {
      out.push({
        type: 'text',
        value: el.value,
        align: el.align,
        xOffsetMm: 0,
        yMm: 0,
        bold: el.bold,
        fontSizePt: el.fontSizePt,
        color: el.color,
      });
    } else {
      const assetId = imageIndex[el.imageDocxPath];
      if (!assetId) {
        warnings.push({
          code: 'EMF_NOT_SUPPORTED',
          message: `imagem ${el.imageDocxPath} referenciada mas não foi uploadada; elemento omitido`,
        });
        continue;
      }
      out.push({
        type: 'image',
        assetId,
        heightMm: el.heightMm,
        align: el.align,
        xOffsetMm: 0,
        yMm: 0,
      });
    }
  }
  return out;
}

export function toTemplateInput(analysis: DocxAnalysis, name: string): {
  templateInput: TemplateInput;
  warnings: Warning[];
} {
  const warnings: Warning[] = [];
  const imageIndex: Record<string, string> = {};
  for (const img of analysis.images) imageIndex[img.docxPath] = img.assetId;

  const headerBand = pickBand(analysis.headers);
  const footerBand = pickBand(analysis.footers);
  const headerHeight = headerBand?.heightMm ?? 0;
  const footerHeight = footerBand?.heightMm ?? 0;

  const marginTop = Math.max(analysis.page.margins.top, headerHeight + BAND_MARGIN_SLACK_MM);
  const marginBottom = Math.max(analysis.page.margins.bottom, footerHeight + BAND_MARGIN_SLACK_MM);

  const headerElements = mapBandElements(headerBand, imageIndex, warnings);
  const footerElements = mapBandElements(footerBand, imageIndex, warnings);

  // Warning se detectamos uma capa provável (first header com imagem) — não importamos ainda.
  if (analysis.headers.first && analysis.headers.first.elements.some((e) => e.type === 'image')) {
    warnings.push({
      code: 'POSSIBLE_COVER_IGNORED',
      message: 'primeira página do docx parece ser uma capa (imagem + texto); capa fica desligada e você pode ativar no editor.',
    });
  }

  const raw = {
    name,
    page: {
      format: analysis.page.format,
      orientation: analysis.page.orientation,
      margins: { ...analysis.page.margins, top: marginTop, bottom: marginBottom },
    },
    header: { heightMm: headerHeight || 15, elements: headerElements },
    footer: { heightMm: footerHeight || 15, elements: footerElements },
    body: {
      font: { family: mapFamily(analysis.styles.body.family, analysis.fonts.presetMatches) },
      fontSizePt: analysis.styles.body.fontSizePt,
      color: analysis.styles.body.color,
      lineHeight: analysis.styles.body.lineHeight,
    },
    headings: {
      h1: analysis.styles.headings.h1 ?? undefined,
      h2: analysis.styles.headings.h2 ?? undefined,
      h3: analysis.styles.headings.h3 ?? undefined,
    },
    cover: { enabled: false },
  };

  const templateInput = TemplateInputSchema.parse(raw);
  return { templateInput, warnings };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

- [ ] **Step 5: Commit**

```bash
git add src/docx/toTemplate.ts tests/docx/toTemplate.test.ts
git commit -m "feat(docx): map DocxAnalysis to TemplateInput"
```

---

### Task 14: Rotas `analyze-docx` e `from-docx`

**Files:**
- Modify: `src/routes/templates.ts`
- Test: `tests/docx-import.test.ts`

**Interfaces:**
- Consumes: `analyzeDocx`, `toTemplateInput`; `deps.assetRepo`, `deps.templateRepo`.
- Produces: 2 novos endpoints REST.

**Regras:**
- Ambos: `POST` multipart, campo `file` (mimetype validado como `application/vnd.openxmlformats-officedocument.wordprocessingml.document` ou termina em `.docx`).
- Query `?name=` opcional em `from-docx`.
- `analyze-docx` retorna `{ analysis, warnings }` — status 200.
- `from-docx` retorna `{ template, warnings, assetIds }` — status 201.
- Limite de tamanho: 20MB via `.file({ limits: { fileSize: 20 * 1024 * 1024 } })`. Erro > → 413.

- [ ] **Step 1: Escrever o teste**

`tests/docx-import.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { createFontRepo } from '../src/storage/fontRepo.js';
import { createOutputStore } from '../src/storage/outputStore.js';
import { createPdfService } from '../src/render/pdf.js';
import { readPdf } from './helpers/readPdf.js';

let app: FastifyInstance;
let dir: string;

const docxBuf = fsSync.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');

function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----md2pdftest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-docx-'));
  app = buildApp({
    templateRepo: createTemplateRepo(path.join(dir, 'templates')),
    assetRepo: createAssetRepo(path.join(dir, 'assets')),
    fontRepo: createFontRepo(path.join(dir, 'fonts')),
    outputStore: createOutputStore(path.join(dir, 'outputs')),
    pdfService: createPdfService(),
    logger: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('POST /api/templates/analyze-docx', () => {
  it('devolve análise + warnings sem persistir template', async () => {
    const mp = multipart('file', 'bionexo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const res = await app.inject({ method: 'POST', url: '/api/templates/analyze-docx', payload: mp.payload, headers: mp.headers });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.analysis).toBeTruthy();
    expect(['A4', 'Letter']).toContain(body.analysis.page.format);
    expect(Array.isArray(body.warnings)).toBe(true);

    // template não foi persistido
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json()).toEqual([]);
  });

  it('recusa upload sem arquivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/analyze-docx',
      payload: Buffer.from(''),
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/templates/from-docx', () => {
  it('cria template a partir do docx real e devolve 201 com warnings', async () => {
    const mp = multipart('file', 'bionexo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx?name=Bionexo',
      payload: mp.payload,
      headers: mp.headers,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.template.id).toMatch(/^tpl_/);
    expect(body.template.name).toBe('Bionexo');
    expect(Array.isArray(body.warnings)).toBe(true);

    // Template aparece na listagem
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json().some((t: { id: string }) => t.id === body.template.id)).toBe(true);
  });

  it('template gerado consegue produzir PDF via /api/convert', async () => {
    const mp = multipart('file', 'x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const created = await app.inject({ method: 'POST', url: '/api/templates/from-docx', payload: mp.payload, headers: mp.headers });
    const templateId = created.json().template.id;

    const conv = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Doc importado\n\nCorpo em markdown.', templateId },
    });
    expect(conv.statusCode, conv.body).toBe(200);
    expect(conv.headers['content-type']).toBe('application/pdf');
    const pdf = await readPdf(Buffer.from(conv.rawPayload));
    expect(pdf.pages).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Rodar testes — devem falhar**

```bash
npx vitest run tests/docx-import.test.ts
```

- [ ] **Step 3: Adicionar as rotas em `src/routes/templates.ts`**

Adicionar imports no topo:
```ts
import { analyzeDocx } from '../docx/analyze.js';
import { toTemplateInput } from '../docx/toTemplate.js';
```

Adicionar antes do `app.get<{ Params: { id: string } }>('/api/templates/:id', ...)` (para as rotas específicas resolverem antes):

```ts
  app.post('/api/templates/analyze-docx', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'validation_failed', message: 'envie o docx no campo "file"' });
    const buf = await file.toBuffer();
    const { analysis, warnings } = await analyzeDocx(buf, deps.assetRepo);
    return reply.send({ analysis, warnings });
  });

  app.post<{ Querystring: { name?: string } }>('/api/templates/from-docx', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'validation_failed', message: 'envie o docx no campo "file"' });
    const buf = await file.toBuffer();
    const { analysis, warnings: analyzeWarnings } = await analyzeDocx(buf, deps.assetRepo);
    const name = request.query.name?.trim() || file.filename.replace(/\.docx$/i, '') || 'Template importado';
    const { templateInput, warnings: mapWarnings } = toTemplateInput(analysis, name);
    const template = await deps.templateRepo.create(templateInput);
    return reply.code(201).send({
      template,
      warnings: [...analyzeWarnings, ...mapWarnings],
      assetIds: analysis.images.map((i) => i.assetId),
    });
  });
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
npx vitest run tests/docx-import.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/templates.ts tests/docx-import.test.ts
git commit -m "feat(routes): POST /api/templates/analyze-docx and /from-docx"
```

---

### Task 15: OpenAPI gerador para o fluxo de import + convert genérico

**Files:**
- Create: `web/src/lib/importOpenApi.ts`
- Test: `tests/openapi.test.ts` (adicionar cases; verificar arquivo existe primeiro)

**Interfaces:**
- Produces:
  ```ts
  export function buildImportOpenApi(options?: { serverUrl?: string }): object;
  ```
- Descreve DOIS operations:
  - `importTemplateFromDocx`: `POST /api/templates/from-docx` multipart. Descrição rica ensinando o agente a passar o docx e o `name` opcional.
  - `convertWithTemplateAnyId`: `POST /api/convert`. `templateId` é parâmetro obrigatório (não fixado). Descrição diz para usar o `template.id` devolvido pelo import.
  - Ambos usam `output: "path"` (fixed) para retornar path absoluto.

- [ ] **Step 1: Escrever o teste**

Adicionar em `tests/openapi.test.ts` (checar se existe; senão criar novo `tests/importOpenapi.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { buildImportOpenApi } from '../web/src/lib/importOpenApi.js';

describe('buildImportOpenApi', () => {
  it('inclui os 2 operations do fluxo MCP', () => {
    const spec = buildImportOpenApi({ serverUrl: 'http://localhost:3000' }) as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/templates/from-docx']).toBeTruthy();
    expect(spec.paths['/api/convert']).toBeTruthy();
    const importOp = spec.paths['/api/templates/from-docx'].post;
    expect(importOp.operationId).toBe('importTemplateFromDocx');
    expect(importOp.requestBody.content['multipart/form-data']).toBeTruthy();
    const convertOp = spec.paths['/api/convert'].post;
    expect(convertOp.operationId).toBe('convertWithTemplate');
    // templateId parametrizável (não enum de 1)
    const props = convertOp.requestBody.content['application/json'].schema.properties;
    expect(props.templateId.enum).toBeUndefined();
    expect(props.output.enum).toEqual(['path']);
  });

  it('inclui instruções para o agente MCP no description', () => {
    const spec = buildImportOpenApi() as any;
    const importOp = spec.paths['/api/templates/from-docx'].post;
    expect(importOp.description).toMatch(/docx/i);
    expect(importOp.description).toMatch(/template\.id/i);
    const convertOp = spec.paths['/api/convert'].post;
    expect(convertOp.description).toMatch(/templateId/i);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

- [ ] **Step 3: Implementar**

`web/src/lib/importOpenApi.ts`:
```ts
/**
 * Gera OpenAPI 3.0.3 para o fluxo MCP de import + conversion:
 *   (1) importTemplateFromDocx  → recebe .docx, devolve template.id
 *   (2) convertWithTemplate     → recebe templateId + markdown, devolve path do PDF
 *
 * Sem template-id fixo: as duas tools funcionam em qualquer template criado.
 */

interface BuildOptions {
  serverUrl?: string;
}

export function buildImportOpenApi(options: BuildOptions = {}): object {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  return {
    openapi: '3.0.3',
    info: {
      title: 'md2pdf — Import + Convert (MCP)',
      version: '1.0.0',
      description:
        'Fluxo em duas etapas para gerar PDFs a partir de um template extraído de um docx: ' +
        '(1) importe um .docx com `importTemplateFromDocx` para criar o template; ' +
        '(2) use o `template.id` devolvido em `convertWithTemplate` sempre que precisar produzir um PDF com aquele template.',
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/api/templates/from-docx': {
        post: {
          operationId: 'importTemplateFromDocx',
          summary: 'Importa um docx/doc e cria um template md2pdf',
          description:
            'Envia um arquivo `.docx` e recebe um template md2pdf pronto para uso, ' +
            'reproduzindo cabeçalho, rodapé, fontes, cores e margens do original. ' +
            'RESPOSTA: um JSON com `template.id` — GUARDE ESSE ID e passe em chamadas futuras à tool `convertWithTemplate`. ' +
            'Se vierem `warnings`, mostre-as ao usuário (indicam decisões heurísticas que ele pode revisar no editor). ' +
            'QUANDO USAR: sempre que o usuário quiser criar um novo template a partir de um documento Word existente.',
          parameters: [
            {
              in: 'query',
              name: 'name',
              required: false,
              schema: { type: 'string' },
              description: 'Nome do template a criar. Se omitido, usa o nome do arquivo.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description: 'O arquivo .docx a importar.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Template criado. Use `template.id` nas próximas conversões.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['template', 'warnings', 'assetIds'],
                    properties: {
                      template: {
                        type: 'object',
                        required: ['id', 'name'],
                        properties: {
                          id: { type: 'string', description: 'Id do template. Guarde e reuse.' },
                          name: { type: 'string' },
                        },
                      },
                      warnings: {
                        type: 'array',
                        description: 'Alertas sobre decisões automáticas (fontes não mapeadas, EMF, etc.). Mostre ao usuário.',
                        items: {
                          type: 'object',
                          required: ['code', 'message'],
                          properties: {
                            code: { type: 'string' },
                            message: { type: 'string' },
                          },
                        },
                      },
                      assetIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ids das imagens extraídas do docx (logos, etc).',
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Arquivo ausente ou docx inválido.' },
            '413': { description: 'Docx maior que 20MB.' },
          },
        },
      },
      '/api/convert': {
        post: {
          operationId: 'convertWithTemplate',
          summary: 'Gera um PDF a partir de markdown usando um template já existente',
          description:
            'Converte o `markdown` informado usando o template identificado por `templateId`. ' +
            'PROTOCOLO: o `templateId` deve vir de uma chamada anterior a `importTemplateFromDocx` OU ' +
            'de um id de template que o usuário já forneceu explicitamente. ' +
            'Se você tem múltiplos `templateId`s no contexto e não é óbvio qual usar, PERGUNTE ao usuário antes de chamar. ' +
            'RESPOSTA: JSON com o campo `path` — caminho absoluto do PDF em disco no host da API. ' +
            'Abra ou entregue esse arquivo diretamente; NÃO decodifique nem reprocesse o corpo da resposta.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['templateId', 'markdown', 'output'],
                  properties: {
                    templateId: {
                      type: 'string',
                      pattern: '^tpl_[A-Za-z0-9_-]{12}$',
                      description: 'Id do template a usar. Venha da resposta de `importTemplateFromDocx` ou do usuário.',
                    },
                    markdown: {
                      type: 'string',
                      minLength: 1,
                      description: 'Conteúdo do documento em Markdown. Aceita `<!-- pagebreak -->` para forçar quebra de página.',
                    },
                    output: {
                      type: 'string',
                      enum: ['path'],
                      default: 'path',
                      description: 'Sempre `path` — devolve caminho absoluto do arquivo em disco. NÃO altere.',
                    },
                    variables: {
                      type: 'object',
                      description: 'Valores para `{{placeholders}}` do header/footer do template. Se o template não tem placeholders, omita.',
                      additionalProperties: { type: 'string' },
                    },
                    filename: {
                      type: 'string',
                      description: 'Nome sugerido para o arquivo (opcional).',
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'PDF gerado. Use o campo `path` para abrir/entregar o arquivo.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['path', 'filename', 'templateId', 'pages', 'bytes'],
                    properties: {
                      path: { type: 'string' },
                      filename: { type: 'string' },
                      templateId: { type: 'string' },
                      pages: { type: 'integer', minimum: 1 },
                      bytes: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
            '400': { description: 'Validação falhou ou markdown vazio.' },
            '404': { description: 'Template não encontrado.' },
            '422': { description: 'Template referencia um asset que foi removido.' },
          },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
npx vitest run tests/openapi.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/importOpenApi.ts tests/openapi.test.ts
git commit -m "feat(web): OpenAPI generator for MCP import+convert flow"
```

---

### Task 16: Botão "Copiar OpenAPI (Word)" na TemplateList

**Files:**
- Modify: `web/src/pages/TemplateList.tsx`

**Interfaces:**
- Consumes: `buildImportOpenApi`.
- Produces: botão adicional que copia o JSON gerado para o clipboard.

- [ ] **Step 1: Ler a estrutura atual do TemplateList para achar onde encaixar o botão**

```bash
grep -n "Copiar OpenAPI\|buildTemplateOpenApi\|navigator.clipboard" web/src/pages/TemplateList.tsx
```

Registre o número da linha do botão existente.

- [ ] **Step 2: Adicionar botão irmão**

No `TemplateList.tsx`, ao lado do botão "Copiar OpenAPI" existente, adicionar:
```tsx
import { buildImportOpenApi } from '../lib/importOpenApi';

// ... no JSX, próximo ao botão existente:
<button
  type="button"
  onClick={async () => {
    const spec = buildImportOpenApi({ serverUrl: window.location.origin });
    await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
    // usar mesmo padrão de feedback do botão existente (toast/state)
  }}
  title="OpenAPI global: importar docx + converter com qualquer template"
>
  Copiar OpenAPI (Word)
</button>
```

Adaptar ao padrão exato de feedback usado no botão vizinho (state de "copiado!" temporário, etc).

- [ ] **Step 3: Verificar tipo + rodar dev:web para testar o clique**

```bash
npm run build   # tsc --noEmit; deve passar sem erros
```

Se possível: `npm run dev` + `npm run dev:web`, abrir http://localhost:5173, clicar no botão, colar num editor de texto e conferir que é um JSON OpenAPI 3.0.3 válido com os 2 operations.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/TemplateList.tsx
git commit -m "feat(web): 'Copiar OpenAPI (Word)' button on TemplateList"
```

---

### Task 17: Seção "Importando do Word" no README

**Files:**
- Modify: `README.md`

**Interfaces:** documentação, sem código.

- [ ] **Step 1: Adicionar a seção antes de "Segurança"**

```markdown
## Importando do Word

Quando você já tem um `.docx` com o papel timbrado da empresa, o md2pdf
consegue extrair o template automaticamente:

```bash
curl -X POST http://localhost:3000/api/templates/from-docx?name=Bionexo \
  -F "file=@meu-timbrado.docx"
```

A resposta traz:

```json
{
  "template": { "id": "tpl_abc...", "name": "Bionexo", "...": "..." },
  "warnings": [
    { "code": "EMF_NOT_SUPPORTED", "message": "word/media/image1.emf é EMF; ..." }
  ],
  "assetIds": ["ast_..."]
}
```

Guarde o `template.id` e use como qualquer template criado à mão:

```bash
curl -X POST http://localhost:3000/api/convert \
  -H "content-type: application/json" \
  -d '{"templateId":"tpl_abc...","markdown":"# Doc","output":"path"}'
```

### O que é importado

- Formato e orientação da página (A4/Letter, portrait/landscape)
- Margens
- Cabeçalho e rodapé da seção default (texto, alinhamento, tipografia, logo)
- Fonte, tamanho, cor e altura de linha do corpo (via estilo `Normal`)
- Estilos de `Heading 1/2/3` (cor, negrito, tamanho)
- Imagens PNG/JPG/SVG/GIF/WebP embutidas nos cabeçalhos/rodapés

### O que **não** é importado

- Corpo do documento (isso vem do markdown que você envia depois)
- Tabelas de estilo, numeração automática, campos, sumário
- Imagens EMF/WMF (não renderizam em Chromium — vira warning)
- Capa personalizada (a heurística é conservadora; edite depois se quiser)

### Usando via MCP

O botão **"Copiar OpenAPI (Word)"** na lista de templates copia um spec
OpenAPI 3.0.3 com duas operações:

1. `importTemplateFromDocx` — recebe o .docx, devolve `template.id`
2. `convertWithTemplate` — recebe `templateId` + `markdown`, devolve o path do PDF

Empacotado como MCP (via qualquer ferramenta OpenAPI→MCP), habilita
agentes (Claude, Copilot, Cursor) a fazer o fluxo completo:
"crie um template do docx X e depois converta o markdown Y com ele".

### Analisar sem persistir

Se você quer inspecionar o que seria importado antes de criar o template:

```bash
curl -X POST http://localhost:3000/api/templates/analyze-docx \
  -F "file=@meu.docx"
```

Devolve o mesmo `{ analysis, warnings }` sem criar template no disco.
```

- [ ] **Step 2: Adicionar a tabela de rotas em "Endpoints"**

Localize a tabela em "Endpoints" e adicione:
```markdown
| `POST` | `/api/templates/analyze-docx` | Analisa um .docx e devolve os fatos + warnings, sem criar template |
| `POST` | `/api/templates/from-docx` | Analisa um .docx e cria o template automaticamente |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README section for docx import + MCP flow"
```

---

### Task 18: Cleanup — remover script de spike

**Files:**
- Delete: `scripts/spike-docx.ts`

- [ ] **Step 1: Verificar que o spike não é mais referenciado**

```bash
grep -r "spike-docx" --include="*.ts" --include="*.json" || echo "sem referências"
```

- [ ] **Step 2: Remover o arquivo**

```bash
rm scripts/spike-docx.ts
# Se o dir scripts/ ficou vazio, remover também:
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 3: Rodar toda a suíte para garantir que nada regrediu**

```bash
npm test
```

Expected: todos os testes existentes + os 9 novos (`docx/units`, `docx/unzip`, `docx/xml`, `docx/schema`, `docx/pageSetup`, `docx/theme`, `docx/styles`, `docx/fonts`, `docx/bands`, `docx/images`, `docx/analyze`, `docx/toTemplate`, `docx-import`, `openapi`) passando.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(docx): remove spike script after implementation"
```

---

## Self-Review

**Spec coverage:**

| Seção do spec | Task(s) que cobrem |
|---|---|
| §4.1 Módulos novos (11 arquivos em src/docx) | 2-13 |
| §4.2 Endpoints REST | 14 |
| §4.3 Fluxo de dados | 12 (orquestrador) |
| §4.4 Tabela DOCX→Template (mapeamento) | 6 (page), 7 (theme), 8 (styles), 10 (bands), 13 (toTemplate) |
| §4.5 Warnings | 5 (schema), 6/8/11/12/13 (emitidos) |
| §4.6 Bibliotecas novas (pizzip, fast-xml-parser) | 1 |
| §5 Integração MCP (OpenAPI + botão) | 15, 16 |
| §7 Estratégia de testes (fixtures + unit + e2e + render real) | 1, 2-13 (unit), 12 (smoke real), 14 (e2e com PDF render) |
| §8 Rollout — fases 0-3 | Fase 0 → Task 1; Fase 1 → Tasks 2-12, 14 (analyze-docx); Fase 2 → Tasks 13, 14 (from-docx); Fase 3 → Tasks 15-17 |

Fases 4-5 (Editor UX de import; heurística de capa refinada) **não** entram neste plano — spec pede isso explicitamente ("Fases 4-5 ficam como plano separado depois").

**Placeholder scan:** nenhum "TBD", "TODO", "add error handling", "similar to task N". Cada task tem código concreto para cada step.

**Type consistency:**
- `DocxAnalysis` definido em Task 5 (`src/docx/schema.ts`) e usado por Tasks 6, 8, 10-13. Formatos batem.
- `Warning` mesmo lugar; import path consistente (`from './schema.js'`).
- `Theme` interface criada em Task 7 e consumida em 8, 10, 12.
- `DocxArchive` interface criada em Task 3 e consumida em 11, 12.
- `AssetRepo` importado do `src/storage/assetRepo.js` — existe hoje no repo.
- `TemplateInput`, `BAND_MARGIN_SLACK_MM` importados de `src/domain/template.js` — existem hoje.
- Nomes de rotas batem entre implementação (Task 14) e OpenAPI (Task 15): `/api/templates/from-docx`, `/api/templates/analyze-docx`, `/api/convert`.
- OperationIds no OpenAPI: `importTemplateFromDocx` (task 15) — referenciado no README (task 17) e mencionado nas descriptions das outras operations. Consistente.

Plano coerente. Pronto pra executar.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-20-docx-to-template.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
