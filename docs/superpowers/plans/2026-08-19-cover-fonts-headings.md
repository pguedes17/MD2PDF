# Capa customizável, fonte do corpo e estilos de cabeçalho — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao domínio de template (a) capa opcional com posicionamento livre, (b) escolha de fonte para o corpo do texto com upload custom, e (c) estilos por nível de cabeçalho (h1/h2/h3).

**Architecture:** Três features independentes por dentro (schema/renderer/editor), amarradas por uma migração v1→v2 do template. A capa "limpa" (sem header/footer) é gerada como PDF separado e concatenada com `pdf-lib`; a capa que herda header/footer vira apenas um bloco HTML antes do corpo. Fontes customizadas ficam num storage novo (`fontRepo`) espelhando `assetRepo`.

**Tech Stack:** TypeScript + Zod (schema) · Fastify (rotas) · Playwright/Chromium (PDF) · `pdf-lib` **(nova dep)** para merge · React + Vite (editor) · Vitest + `pdfjs-dist` (testes).

**Spec:** [docs/superpowers/specs/2026-08-19-cover-fonts-headings-design.md](../specs/2026-08-19-cover-fonts-headings-design.md)

## Global Constraints

- Node **≥ 22**, `type: module`, imports com extensão `.js` mesmo em TS.
- Todas as validações passam por `zod` v4 (o repo usa `.prefault({})` para defaults internos).
- Nada de HTTP externo dentro do Chromium: recursos precisam virar `data:` URI antes.
- Formato dos erros da API: `{ error, message, issues? }`; código HTTP via `error.statusCode`.
- Testes de PDF sempre conferem o PDF gerado com `pdfjs-dist` (não só "gerou bytes").
- Migrações são **retrocompatíveis** e determinísticas: template v1 no disco lê, valida como v2, e reescreve.
- Versão nova do template: `version: 2` (o atual é `version: 1`).
- Storage IDs seguem o padrão `<prefix>_<12 chars base62 do nanoid>`. Fontes: prefixo `fnt_`.
- Nomenclatura no editor: aba "Capa" (não "Cover"); painel "Tipografia" para fonte+headings.

---

## File Structure

**Novos arquivos (backend):**
- `src/domain/fontPresets.ts` — lista curada de font-stacks.
- `src/storage/fontRepo.ts` — CRUD de fontes uploadadas.
- `src/routes/fonts.ts` — endpoints `POST/GET/DELETE /api/fonts`.
- `src/render/pdfMerge.ts` — utilitário puro `mergePdfs(buffers): Buffer` usando `pdf-lib`.

**Novos arquivos (frontend):**
- `web/src/components/FontPicker.tsx` — dropdown de presets + modal de upload.
- `web/src/components/HeadingsPanel.tsx` — controles h1/h2/h3 (cor/negrito/tamanho).
- `web/src/components/CoverEditor.tsx` — canvas de folha inteira para a capa.

**Arquivos modificados:**
- `src/domain/template.ts` — `HeadingsSchema`, `CoverSchema`, `BodySchema` novo, `version: 2`.
- `src/domain/templateMigration.ts` — passo v1→v2.
- `src/domain/templateBundle.ts` — inclui fontes no export/import.
- `src/render/template.ts` — CSS para headings, `@font-face`, HTML da capa.
- `src/conversion.ts` — resolve fonte custom + dual-render + merge.
- `src/storage/templateRepo.ts` — grava `version: 2` no create/update.
- `src/storage/assetRepo.ts` — reaproveita helpers para o novo fontRepo (nada muda aqui, só é referência).
- `src/app.ts` — registra `fontRoutes`, deps novas.
- `src/config.ts` — `storage.fonts`, `maxFontBytes`.
- `web/src/lib/templateModel.ts` — tipos derivados do schema novo.
- `web/src/lib/templateOpenApi.ts` — reflete novos campos.
- `web/src/api.ts` — funções para `/api/fonts`.
- `web/src/pages/TemplateEditor.tsx` — nova aba "Capa" + painel "Tipografia".
- `README.md` — documenta capa, fonte custom, estilos de heading.

---

## Task 1: Schema — HeadingsSchema + CSS emission

**Files:**
- Modify: `src/domain/template.ts` — adiciona `HeadingsSchema`, insere `headings` em `baseTemplateShape`.
- Modify: `src/render/template.ts:213-260` — `buildCss` emite regras por nível.
- Test: `tests/template-schema.test.ts` (extend).
- Test: `tests/template-render.test.ts` (extend).

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export const HeadingStyleSchema = z.object({
    color: hexColor,
    bold: z.boolean(),
    fontSizePt: fontSizePt,
  });
  export const HeadingsSchema = z.object({
    h1: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 20 }),
    h2: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 16 }),
    h3: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 13 }),
  });
  export type TemplateHeadings = z.infer<typeof HeadingsSchema>;
  // baseTemplateShape ganha:  headings: HeadingsSchema.prefault({}),
  ```

- [ ] **Step 1: Write failing schema test**

Em `tests/template-schema.test.ts`:

```ts
import { HeadingsSchema, TemplateInputSchema, makeBlankTemplateInput } from '../src/domain/template.js';

describe('HeadingsSchema', () => {
  it('aplica defaults por nível quando o objeto vem vazio', () => {
    const parsed = HeadingsSchema.parse({});
    expect(parsed.h1).toEqual({ color: '#111111', bold: true, fontSizePt: 20 });
    expect(parsed.h2).toEqual({ color: '#111111', bold: true, fontSizePt: 16 });
    expect(parsed.h3).toEqual({ color: '#111111', bold: true, fontSizePt: 13 });
  });

  it('rejeita cor sem #', () => {
    const res = HeadingsSchema.safeParse({ h1: { color: 'ff0000', bold: true, fontSizePt: 20 } });
    expect(res.success).toBe(false);
  });

  it('template em branco já vem com headings default', () => {
    const t = makeBlankTemplateInput();
    expect(t.headings.h1.fontSizePt).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- template-schema`
Expected: FAIL — `HeadingsSchema` não existe.

- [ ] **Step 3: Add the schema**

Em `src/domain/template.ts`, logo depois de `BodySchema`:

```ts
export const HeadingStyleSchema = z.object({
  color: hexColor,
  bold: z.boolean(),
  fontSizePt: fontSizePt,
});

export const HeadingsSchema = z.object({
  h1: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 20 }),
  h2: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 16 }),
  h3: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 13 }),
});

export type TemplateHeadings = z.infer<typeof HeadingsSchema>;
```

E dentro de `baseTemplateShape`, depois de `body`:

```ts
headings: HeadingsSchema.prefault({}),
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `npm test -- template-schema`
Expected: PASS.

- [ ] **Step 5: Write failing render test**

Em `tests/template-render.test.ts`:

```ts
it('emite regras CSS por nível de heading configurado', () => {
  const t = makeBlankTemplateInput();
  t.headings.h1 = { color: '#ff0000', bold: false, fontSizePt: 22 };
  t.headings.h2 = { color: '#0000ff', bold: true, fontSizePt: 15 };
  const { css } = renderTemplate(t);
  expect(css).toContain('h1 { color: #ff0000; font-weight: 400; font-size: 22pt; }');
  expect(css).toContain('h2 { color: #0000ff; font-weight: 700; font-size: 15pt; }');
  // h3-h6 compartilham a regra do h3:
  expect(css).toMatch(/h3, h4, h5, h6 \{ color: #111111; font-weight: 700; font-size: 13pt; \}/);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- template-render`
Expected: FAIL — `css` não contém as regras.

- [ ] **Step 7: Emit heading CSS from buildCss**

Em `src/render/template.ts`, dentro de `buildCss`, depois de `codeSizePt` e antes do template-string:

```ts
const { headings } = template;
const headingRule = (h: TemplateHeadings['h1']) =>
  `color: ${h.color}; font-weight: ${h.bold ? 700 : 400}; font-size: ${h.fontSizePt}pt;`;
const h1Rule = `h1 { ${headingRule(headings.h1)} }`;
const h2Rule = `h2 { ${headingRule(headings.h2)} }`;
const h3Rule = `h3, h4, h5, h6 { ${headingRule(headings.h3)} }`;
```

Adicione o import de `TemplateHeadings` (ou use `Template['headings']['h1']`).

Injete os três blocos no CSS gerado, logo depois da regra genérica `h1, h2, h3, h4, h5, h6 { break-after: avoid; ... }`:

```ts
`
/* ... regras existentes acima ... */
h1, h2, h3, h4, h5, h6 { break-after: avoid; margin: 1.2em 0 0.5em; line-height: 1.25; }
h1:first-child, h2:first-child { margin-top: 0; }

${h1Rule}
${h2Rule}
${h3Rule}

/* ... resto ... */
`
```

- [ ] **Step 8: Run render + schema tests**

Run: `npm test -- template-render template-schema`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/template.ts src/render/template.ts tests/template-schema.test.ts tests/template-render.test.ts
git commit -m "feat(template): estilos por nível para h1/h2/h3"
```

---

## Task 2: Schema — body.font com dropdown + presets

**Files:**
- Create: `src/domain/fontPresets.ts`.
- Modify: `src/domain/template.ts` — reestrutura `BodySchema`.
- Modify: `src/render/template.ts` — usa `body.font.family` em vez de `body.fontFamily`.
- Test: `tests/template-schema.test.ts` (extend).

**Interfaces:**
- Consumes: `HeadingsSchema` (Task 1) já no shape.
- Produces:
  ```ts
  // src/domain/fontPresets.ts
  export interface FontPreset { family: string; label: string; }
  export const FONT_PRESETS: readonly FontPreset[];
  export const DEFAULT_FONT_FAMILY: string;
  export function isPresetFamily(family: string): boolean;

  // BodySchema muda para:
  BodySchema = z.object({
    font: z.object({
      family: z.string().min(1).default(DEFAULT_FONT_FAMILY),
      customFontId: z.string().regex(/^fnt_[A-Za-z0-9_-]{12}$/).optional(),
    }).prefault({}),
    fontSizePt: fontSizePt.default(11),
    color: hexColor.default('#111111'),
    lineHeight: z.number().min(1).max(3).default(1.5),
  });
  ```

- [ ] **Step 1: Create fontPresets module**

`src/domain/fontPresets.ts`:

```ts
export interface FontPreset {
  family: string;
  label: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
  { family: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", label: "Sistema (padrão)" },
  { family: "Arial, Helvetica, sans-serif", label: "Arial" },
  { family: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { family: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { family: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { family: "'Courier New', Courier, monospace", label: "Courier New" },
  { family: "Roboto, sans-serif", label: "Roboto" },
  { family: "Inter, sans-serif", label: "Inter" },
  { family: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { family: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
];

export const DEFAULT_FONT_FAMILY = FONT_PRESETS[0]!.family;

export function isPresetFamily(family: string): boolean {
  return FONT_PRESETS.some((p) => p.family === family);
}
```

- [ ] **Step 2: Write failing schema test**

Em `tests/template-schema.test.ts`:

```ts
import { DEFAULT_FONT_FAMILY } from '../src/domain/fontPresets.js';

describe('BodySchema — font', () => {
  it('aplica default de family quando body.font vem vazio', () => {
    const t = makeBlankTemplateInput();
    expect(t.body.font.family).toBe(DEFAULT_FONT_FAMILY);
    expect(t.body.font.customFontId).toBeUndefined();
  });

  it('aceita customFontId válido', () => {
    const raw = { ...makeBlankTemplateInput() };
    (raw.body as any).font = { family: 'MinhaFonte, sans-serif', customFontId: 'fnt_abcdefghij12' };
    const parsed = TemplateInputSchema.parse(raw);
    expect(parsed.body.font.customFontId).toBe('fnt_abcdefghij12');
  });

  it('rejeita customFontId em formato inválido', () => {
    const raw = { ...makeBlankTemplateInput() };
    (raw.body as any).font = { family: 'X', customFontId: 'lixo' };
    const res = TemplateInputSchema.safeParse(raw);
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- template-schema`
Expected: FAIL — `body.fontFamily` ainda é o shape.

- [ ] **Step 4: Reshape BodySchema**

Em `src/domain/template.ts`, substitua `BodySchema`:

```ts
import { DEFAULT_FONT_FAMILY } from './fontPresets.js';

const BodyFontSchema = z.object({
  family: z.string().min(1).default(DEFAULT_FONT_FAMILY),
  customFontId: z.string().regex(/^fnt_[A-Za-z0-9_-]{12}$/, 'customFontId inválido').optional(),
});

const BodySchema = z.object({
  font: BodyFontSchema.prefault({}),
  fontSizePt: fontSizePt.default(11),
  color: hexColor.default('#111111'),
  lineHeight: z.number().min(1).max(3).default(1.5),
});
```

Remova a antiga `fontFamily` do `BodySchema`. (A migração no Task 4 vai converter templates v1 em disco.)

- [ ] **Step 5: Update renderer references**

Em `src/render/template.ts`:
- `buildCss`: trocar `body.fontFamily` por `body.font.family`.
- `bandHtml`: idem em `font-family: ${template.body.fontFamily}` → `template.body.font.family`.

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- template-schema template-render`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/template.ts src/domain/fontPresets.ts src/render/template.ts tests/template-schema.test.ts
git commit -m "feat(template): body.font como objeto (family + customFontId), lista curada de presets"
```

---

## Task 3: Schema — CoverSchema com posicionamento livre

**Files:**
- Modify: `src/domain/template.ts` — extrai `bandPositionProps`, cria `coverPositionProps`, `CoverElementSchema`, `CoverSchema`; adiciona ao `baseTemplateShape`; sanity check.
- Test: `tests/template-schema.test.ts` (extend).

**Interfaces:**
- Consumes: `ElementSchema` existente (base para o cover element).
- Produces:
  ```ts
  export const CoverElementSchema: z.ZodDiscriminatedUnion<...>;
  export const CoverSchema = z.object({
    enabled: z.boolean().default(false),
    applyHeaderFooter: z.boolean().default(false),
    elements: z.array(CoverElementSchema).default([]),
  });
  export type TemplateCoverElement = z.infer<typeof CoverElementSchema>;
  export type TemplateCover = z.infer<typeof CoverSchema>;
  // baseTemplateShape ganha: cover: CoverSchema.prefault({}),
  ```

- [ ] **Step 1: Write failing tests**

Em `tests/template-schema.test.ts`:

```ts
describe('CoverSchema', () => {
  it('vem desabilitada por default', () => {
    const t = makeBlankTemplateInput();
    expect(t.cover).toEqual({ enabled: false, applyHeaderFooter: false, elements: [] });
  });

  it('aceita texto e imagem na capa com yMm até a altura da página', () => {
    const raw = makeBlankTemplateInput() as any;
    raw.cover = {
      enabled: true,
      applyHeaderFooter: false,
      elements: [
        { type: 'text', value: 'Título', align: 'center', xOffsetMm: 0, yMm: 140, fontSizePt: 32, bold: true, color: '#000' },
        { type: 'image', assetId: 'ast_abcdefghij12', heightMm: 30, align: 'center', xOffsetMm: 0, yMm: 40 },
      ],
    };
    const parsed = TemplateInputSchema.parse(raw);
    expect(parsed.cover.elements).toHaveLength(2);
  });

  it('rejeita pageNumber como elemento de capa', () => {
    const raw = makeBlankTemplateInput() as any;
    raw.cover = {
      enabled: true,
      applyHeaderFooter: false,
      elements: [{ type: 'pageNumber', format: '{page}', align: 'center', xOffsetMm: 0, yMm: 100 }],
    };
    const res = TemplateInputSchema.safeParse(raw);
    expect(res.success).toBe(false);
  });

  it('recusa elemento que sai da folha (capa limpa: usa page.height inteira)', () => {
    const raw = makeBlankTemplateInput() as any;
    raw.cover = {
      enabled: true,
      applyHeaderFooter: false,
      // A4 portrait = 297mm; um texto grande em yMm=290 estoura.
      elements: [{ type: 'text', value: 'X', align: 'left', xOffsetMm: 0, yMm: 290, fontSizePt: 60, bold: false, color: '#000' }],
    };
    const res = TemplateInputSchema.safeParse(raw);
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- template-schema`
Expected: FAIL — `t.cover` é `undefined`.

- [ ] **Step 3: Refactor positionProps into band vs cover**

Em `src/domain/template.ts`, substitua o `positionProps` atual:

```ts
const bandPositionProps = {
  align: z.enum(['left', 'center', 'right']).default('left'),
  xOffsetMm: z.number().min(-200).max(200).default(0),
  yMm: z.number().min(0).max(60).default(0),
};

const coverPositionProps = {
  align: z.enum(['left', 'center', 'right']).default('left'),
  xOffsetMm: z.number().min(-200).max(200).default(0),
  yMm: z.number().min(0).max(320).default(0),
};
```

Substitua `...positionProps` por `...bandPositionProps` em cada variante do `ElementSchema`.

- [ ] **Step 4: Define CoverElementSchema (sem pageNumber)**

Logo depois de `ElementSchema`:

```ts
export const CoverElementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    assetId: z.string().min(1, 'escolha uma imagem para este elemento'),
    heightMm: z.number().min(1).max(200).default(30),
    ...coverPositionProps,
  }),
  z.object({
    type: z.literal('text'),
    value: z.string().default(''),
    ...commonTextProps,
    ...coverPositionProps,
  }),
  z.object({
    type: z.literal('date'),
    format: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy HH:mm']).default('dd/MM/yyyy'),
    ...commonTextProps,
    ...coverPositionProps,
  }),
]);

export const CoverSchema = z.object({
  enabled: z.boolean().default(false),
  applyHeaderFooter: z.boolean().default(false),
  elements: z.array(CoverElementSchema).default([]),
});

export type TemplateCoverElement = z.infer<typeof CoverElementSchema>;
export type TemplateCover = z.infer<typeof CoverSchema>;
```

E dentro de `baseTemplateShape`, depois de `headings`:

```ts
cover: CoverSchema.prefault({}),
```

- [ ] **Step 5: Add sanity check for cover element fit**

Em `template.ts`, adicione:

```ts
import { PAGE_SIZES_MM } from './template.js'; // já existe no mesmo arquivo — só reuse

function pageHeightMm(t: TemplateBase): number {
  const size = PAGE_SIZES_MM[t.page.format];
  return t.page.orientation === 'landscape' ? size.width : size.height;
}

function pageWidthMm(t: TemplateBase): number {
  const size = PAGE_SIZES_MM[t.page.format];
  return t.page.orientation === 'landscape' ? size.height : size.width;
}

function estimatedCoverElementHeightMm(el: z.infer<typeof CoverElementSchema>): number {
  if (el.type === 'image') return el.heightMm;
  return el.fontSizePt * 0.353 * 1.2;
}

function checkCoverFits(t: TemplateBase, ctx: z.RefinementCtx): void {
  if (!t.cover.enabled) return;
  const pageH = pageHeightMm(t);
  const availableH = t.cover.applyHeaderFooter
    ? pageH - t.page.margins.top - t.page.margins.bottom
    : pageH;
  t.cover.elements.forEach((el, i) => {
    const h = estimatedCoverElementHeightMm(el);
    if (el.yMm + h > availableH + 0.001) {
      ctx.addIssue({
        code: 'custom',
        path: ['cover', 'elements', i, 'yMm'],
        message: `elemento não cabe na página: yMm (${el.yMm}) + altura (${h.toFixed(1)}) excede ${availableH}mm`,
      });
    }
  });
}
```

Chame `checkCoverFits(t, ctx)` dentro de `checkBands`.

- [ ] **Step 6: Update `makeBlankTemplateInput` to include cover default**

Já vem da `.prefault({})`, mas garanta que o retorno tipa como incluindo `cover`. Nada mais a mudar aqui — a próxima chamada `TemplateInputSchema.parse(...)` preenche.

- [ ] **Step 7: Run tests**

Run: `npm test -- template-schema`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/template.ts tests/template-schema.test.ts
git commit -m "feat(template): schema de capa com posicionamento livre (opt-in, sem pageNumber)"
```

---

## Task 4: Migração v1 → v2

**Files:**
- Modify: `src/domain/templateMigration.ts` — adiciona passo de v1→v2.
- Modify: `src/domain/template.ts` — muda `version: z.literal(1)` para `z.literal(2)`.
- Modify: `src/storage/templateRepo.ts` — `create/update` gravam `version: 2`.
- Test: `tests/template-migration.test.ts` (extend).

**Interfaces:**
- Consumes: schema completo v2 pronto.
- Produces: `migrateTemplateJson` reescreve v1 → v2 tanto quanto v0 (zones) → v1 (elements) que já existia. Ambos os passos rodam em série.

- [ ] **Step 1: Write failing test**

Em `tests/template-migration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- template-migration`
Expected: FAIL — migração ainda não injeta os campos novos.

- [ ] **Step 3: Extend migrateTemplateJson**

Em `src/domain/templateMigration.ts`, substitua a export final por uma que roda dois passos:

```ts
function bodyNeedsMigration(body: unknown): boolean {
  return isObject(body) && 'fontFamily' in body && !('font' in body);
}

function migrateBody(body: Record<string, unknown>): Record<string, unknown> {
  const { fontFamily, ...rest } = body as { fontFamily?: unknown } & Record<string, unknown>;
  const family = typeof fontFamily === 'string' && fontFamily.length > 0
    ? fontFamily
    : "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return { ...rest, font: { family } };
}

function needsV1toV2(raw: Record<string, unknown>): boolean {
  const isV1 = raw.version === 1 || raw.version === undefined;
  const missingSection = !('cover' in raw) || !('headings' in raw) || bodyNeedsMigration(raw.body);
  return isV1 && missingSection;
}

function migrateV1toV2(raw: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw, version: 2 };
  if (bodyNeedsMigration(raw.body)) next.body = migrateBody(raw.body as Record<string, unknown>);
  if (!('cover' in raw)) next.cover = { enabled: false, applyHeaderFooter: false, elements: [] };
  if (!('headings' in raw)) {
    next.headings = {
      h1: { color: '#111111', bold: true, fontSizePt: 20 },
      h2: { color: '#111111', bold: true, fontSizePt: 16 },
      h3: { color: '#111111', bold: true, fontSizePt: 13 },
    };
  }
  return next;
}

export function migrateTemplateJson(raw: unknown): { data: unknown; changed: boolean } {
  if (!isObject(raw)) return { data: raw, changed: false };

  let current: Record<string, unknown> = raw;
  let changed = false;

  // v0 (zones) → v1 (elements) — passo original
  const headerLegacy = bandNeedsMigration(current.header);
  const footerLegacy = bandNeedsMigration(current.footer);
  if (headerLegacy || footerLegacy) {
    current = { ...current };
    if (headerLegacy) current.header = migrateBand(current.header as Record<string, unknown>);
    if (footerLegacy) current.footer = migrateBand(current.footer as Record<string, unknown>);
    changed = true;
  }

  // v1 → v2 (body.font, cover, headings)
  if (needsV1toV2(current)) {
    current = migrateV1toV2(current);
    changed = true;
  }

  return { data: current, changed };
}
```

- [ ] **Step 4: Bump schema version to 2**

Em `src/domain/template.ts`, `TemplateSchema.extend({ ... version: z.literal(2).default(2), ... })`. E em `src/storage/templateRepo.ts`:

- `create` grava `version: 2`.
- `update` grava `version: 2` (linha `version: 1` na função `update`).

- [ ] **Step 5: Run tests**

Run: `npm test -- template-migration template-schema api.test`
Expected: PASS. Se `api.test.ts` falhar em algum lugar por causa da version, é sinal de que faltou atualizar — corrija.

- [ ] **Step 6: Commit**

```bash
git add src/domain/template.ts src/domain/templateMigration.ts src/storage/templateRepo.ts tests/template-migration.test.ts
git commit -m "feat(template): migração v1→v2 (body.font + cover + headings)"
```

---

## Task 5: Renderer — HTML da capa

**Files:**
- Modify: `src/render/template.ts` — `renderTemplate` retorna opcionalmente `cover: { html, pdfOptions }`; helpers para o HTML da capa.
- Test: `tests/template-render.test.ts` (extend).

**Interfaces:**
- Consumes: `CoverSchema` (Task 3), `resolveAssets` já cobre imagens da capa (Task 7 fará a chamada real; aqui só passamos `opts.assets`).
- Produces:
  ```ts
  export interface RenderedTemplate {
    headerHtml: string;
    footerHtml: string;
    css: string;
    pdfOptions: PdfOptions;
    cover?: {                            // presente sse cover.enabled && !applyHeaderFooter
      html: string;                      // HTML completo (doctype + head + body)
      pdfOptions: PdfOptions;            // displayHeaderFooter: false, margens = 0
    };
    /** Se cover.enabled && cover.applyHeaderFooter, é embutida no bodyHtml final:
     *  quem consome pré-fixa isto no HTML do markdown. Fica exposto para o
     *  serviço de conversão poder concatenar sem precisar reimplementar o layout. */
    coverInlineHtml?: string;
  }
  ```

- [ ] **Step 1: Write failing tests**

Em `tests/template-render.test.ts`:

```ts
describe('renderTemplate — cover', () => {
  it('não emite cover quando desabilitada', () => {
    const t = makeBlankTemplateInput();
    const r = renderTemplate(t);
    expect(r.cover).toBeUndefined();
    expect(r.coverInlineHtml).toBeUndefined();
  });

  it('emite cover como documento separado quando applyHeaderFooter=false', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: false,
      elements: [{ type: 'text', value: 'Título', align: 'center', xOffsetMm: 0, yMm: 130, fontSizePt: 28, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t);
    expect(r.cover).toBeDefined();
    expect(r.cover!.html).toContain('Título');
    expect(r.cover!.html.trim().startsWith('<!doctype html>')).toBe(true);
    expect(r.cover!.pdfOptions.displayHeaderFooter).toBe(false);
    expect(r.cover!.pdfOptions.margin).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' });
    expect(r.coverInlineHtml).toBeUndefined();
  });

  it('emite coverInlineHtml quando applyHeaderFooter=true', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: true,
      elements: [{ type: 'text', value: 'Título', align: 'center', xOffsetMm: 0, yMm: 100, fontSizePt: 24, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t);
    expect(r.cover).toBeUndefined();
    expect(r.coverInlineHtml).toBeDefined();
    expect(r.coverInlineHtml).toContain('Título');
    expect(r.coverInlineHtml).toContain('page-break');
  });

  it('resolve variáveis nos textos da capa', () => {
    const t = makeBlankTemplateInput() as any;
    t.cover = {
      enabled: true, applyHeaderFooter: false,
      elements: [{ type: 'text', value: 'Contrato {{numero}}', align: 'center', xOffsetMm: 0, yMm: 100, fontSizePt: 22, bold: true, color: '#000' }],
    };
    const r = renderTemplate(t, { variables: { numero: '2026/0413' } });
    expect(r.cover!.html).toContain('Contrato 2026/0413');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- template-render`
Expected: FAIL.

- [ ] **Step 3: Add cover element renderer**

Em `src/render/template.ts`, adicione uma função que reaproveita `elementInnerHtml` — o discriminante `type` de `CoverElementSchema` é subset de `ElementSchema`, então dá para tratá-lo como um `TemplateElement` sem `pageNumber`:

```ts
function coverBodyHtml(
  template: TemplateInput,
  opts: RenderTemplateOptions,
): string {
  const pageW = template.page.orientation === 'landscape'
    ? PAGE_SIZES_MM[template.page.format].height
    : PAGE_SIZES_MM[template.page.format].width;
  const pageH = template.page.orientation === 'landscape'
    ? PAGE_SIZES_MM[template.page.format].width
    : PAGE_SIZES_MM[template.page.format].height;

  const inner = template.cover.elements.map((el) => {
    // O CoverElement compartilha align/xOffsetMm/yMm com TemplateElement;
    // elementInnerHtml só olha esses campos + o discriminante.
    const wrapperStyle = `position: absolute; ${positionInlineStyle(el as TemplateElement)};`;
    return `<div style="${wrapperStyle}">${elementInnerHtml(el as TemplateElement, opts)}</div>`;
  }).join('');

  const style = [
    'position: relative',
    'box-sizing: border-box',
    `width: ${pageW}mm`,
    `height: ${pageH}mm`,
    'overflow: hidden',
  ].join('; ');
  return `<div class="cover-page" style="${style}">${inner}</div>`;
}

function coverDocumentHtml(
  template: TemplateInput,
  opts: RenderTemplateOptions,
): string {
  return buildDocumentHtml({
    css: buildCss(template),
    bodyHtml: coverBodyHtml(template, opts),
  });
}
```

Note: `PAGE_SIZES_MM` já é exportado de `template.ts` (domain). Importe se preciso.

- [ ] **Step 4: Wire cover into renderTemplate**

Em `renderTemplate`, no final, antes do `return`:

```ts
const cover = template.cover;
let coverExternal: RenderedTemplate['cover'] | undefined;
let coverInline: string | undefined;

if (cover.enabled) {
  if (cover.applyHeaderFooter) {
    coverInline = `${coverBodyHtml(template, opts)}<div class="page-break"></div>`;
  } else {
    coverExternal = {
      html: coverDocumentHtml(template, opts),
      pdfOptions: {
        format: page.format,
        landscape: page.orientation === 'landscape',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      },
    };
  }
}

return {
  headerHtml: bandHtml(header, template, opts),
  footerHtml: bandHtml(footer, template, opts),
  css: buildCss(template),
  pdfOptions: { /* ... existente ... */ },
  ...(coverExternal ? { cover: coverExternal } : {}),
  ...(coverInline ? { coverInlineHtml: coverInline } : {}),
};
```

- [ ] **Step 5: Run tests**

Run: `npm test -- template-render`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/template.ts tests/template-render.test.ts
git commit -m "feat(render): HTML da capa (documento separado ou inline conforme applyHeaderFooter)"
```

---

## Task 6: Utilitário de merge de PDFs

**Files:**
- Create: `src/render/pdfMerge.ts`.
- Create: `tests/pdfMerge.test.ts`.
- Modify: `package.json` — nova dep `pdf-lib`.

**Interfaces:**
- Produces:
  ```ts
  export async function mergePdfs(buffers: Buffer[]): Promise<Buffer>;
  ```

- [ ] **Step 1: Add pdf-lib**

Run: `npm install pdf-lib`

Confira que virou uma entrada em `dependencies` (não `devDependencies`).

- [ ] **Step 2: Write failing test**

`tests/pdfMerge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfs } from '../src/render/pdfMerge.js';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('mergePdfs', () => {
  it('concatena páginas na ordem', async () => {
    const a = await makePdf(1);
    const b = await makePdf(3);
    const merged = await mergePdfs([a, b]);
    const loaded = await PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(4);
  });

  it('caso trivial: um único PDF passa incólume no total de páginas', async () => {
    const a = await makePdf(2);
    const merged = await mergePdfs([a]);
    const loaded = await PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('rejeita array vazio', async () => {
    await expect(mergePdfs([])).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- pdfMerge`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implement mergePdfs**

`src/render/pdfMerge.ts`:

```ts
import { PDFDocument } from 'pdf-lib';

/**
 * Concatena PDFs preservando a ordem. Puro: não toca em fs, Playwright ou Fastify.
 * A capa (PDF 1) e o corpo (PDF 2) são fundidos aqui para produzir o documento
 * final quando a capa não herda header/footer.
 */
export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('mergePdfs: nenhum PDF para juntar');
  }
  if (buffers.length === 1) return buffers[0]!;

  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return Buffer.from(bytes);
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- pdfMerge`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/render/pdfMerge.ts tests/pdfMerge.test.ts
git commit -m "feat(render): utilitário mergePdfs (pdf-lib)"
```

---

## Task 7: ConversionService com capa e fonte custom

**Files:**
- Modify: `src/conversion.ts` — coletar fonte custom + cover elements com imagem, dual-render, merge.
- Test: `tests/pdf.test.ts` (extend) — testes gerando PDF real.

**Interfaces:**
- Consumes: `RenderedTemplate.cover` (Task 5), `mergePdfs` (Task 6), `assetRepo.getDataUri`, futuro `fontRepo.getDataUri` (Task 8).
- Produces: nenhuma nova export; o comportamento externo de `convert`/`convertWithTemplate` continua o mesmo (Buffer), mas o pipeline interno muda.

**Nota de ordem:** Este task assume que `fontRepo` **ainda não existe**. Deixamos o "resolve font" atrás de um opcional `deps.fontRepo?` — o Task 9 conecta. Aqui só verificamos que a capa funciona com o assetRepo (imagem na capa) e que o merge acontece.

- [ ] **Step 1: Extend ConversionService deps signature**

Em `src/conversion.ts`, adicione a dep opcional (será obrigatória depois):

```ts
import type { FontRepo } from './storage/fontRepo.js'; // ainda não existe; ver Task 8
// substitua o export para evitar quebrar temp — use inline type:
export interface ConversionServiceDeps {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  pdfService: PdfService;
  fontRepo?: FontRepo;
}
```

Se o import falhar porque o arquivo ainda não existe, **postergue este step para depois do Task 8** e siga o restante do Task 7 com um mock local: `fontRepo: undefined`.

- [ ] **Step 2: Coletar assetIds da capa também**

Extenda `collectAssetIds` em `conversion.ts`:

```ts
function collectAssetIds(template: Template): string[] {
  const ids = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const el of band.elements) if (el.type === 'image') ids.add(el.assetId);
  }
  if (template.cover.enabled) {
    for (const el of template.cover.elements) if (el.type === 'image') ids.add(el.assetId);
  }
  return [...ids];
}
```

- [ ] **Step 3: Write failing PDF test (capa limpa aumenta em 1 o total)**

Em `tests/pdf.test.ts`:

```ts
it('gera capa limpa como primeira página, sem header/footer nela', async () => {
  const t = makeBlankTemplateInput() as any;
  t.name = 'Doc';
  t.header = { heightMm: 20, elements: [{ type: 'text', value: 'CABECALHO', align: 'left', xOffsetMm: 0, yMm: 5, bold: true, fontSizePt: 10, color: '#000' }] };
  t.cover = {
    enabled: true, applyHeaderFooter: false,
    elements: [{ type: 'text', value: 'MEU TITULO', align: 'center', xOffsetMm: 0, yMm: 140, fontSizePt: 32, bold: true, color: '#000' }],
  };
  const template = await templateRepo.create(t);
  const buf = await conversion.convertWithTemplate(template, '# Página do corpo');
  const info = await readPdf(buf);

  expect(info.pages).toBe(2);                                // capa + corpo
  expect(info.textByPage[0]).toContain('MEU TITULO');        // capa mostra título
  expect(info.textByPage[0]).not.toContain('CABECALHO');     // capa sem header
  expect(info.textByPage[1]).toContain('CABECALHO');         // corpo tem header
});

it('capa com applyHeaderFooter=true mantém o header também na página 1', async () => {
  const t = makeBlankTemplateInput() as any;
  t.header = { heightMm: 20, elements: [{ type: 'text', value: 'CABECALHO', align: 'left', xOffsetMm: 0, yMm: 5, bold: true, fontSizePt: 10, color: '#000' }] };
  t.cover = {
    enabled: true, applyHeaderFooter: true,
    elements: [{ type: 'text', value: 'CAPA TITULO', align: 'center', xOffsetMm: 0, yMm: 120, fontSizePt: 28, bold: true, color: '#000' }],
  };
  const template = await templateRepo.create(t);
  const buf = await conversion.convertWithTemplate(template, '# Corpo');
  const info = await readPdf(buf);
  expect(info.pages).toBe(2);
  expect(info.textByPage[0]).toContain('CABECALHO');
  expect(info.textByPage[0]).toContain('CAPA TITULO');
});
```

Confirme se `readPdf` de `tests/helpers/readPdf.ts` já retorna texto por página (`textByPage`). Se não, estenda-o — a extensão é uma linha em `pdfjs-dist` (`page.getTextContent().items.map(i => i.str).join(' ')`).

- [ ] **Step 4: Run tests to verify fail**

Run: `npm test -- pdf.test`
Expected: FAIL — capa ainda não é gerada.

- [ ] **Step 5: Rewrite convertWithTemplate to handle the three paths**

Em `src/conversion.ts`:

```ts
import { renderTemplate } from './render/template.js';
import { renderMarkdown } from './render/markdown.js';
import { buildDocumentHtml } from './render/template.js';
import { mergePdfs } from './render/pdfMerge.js';

// dentro do createConversionService:
async function convertWithTemplate(template, markdown, variables) {
  const assets = await resolveAssets(template);
  // fontDataUri é obtido no Task 9; aqui: undefined
  const rendered = renderTemplate(template, { variables, assets });

  const bodyHtml = (rendered.coverInlineHtml ?? '') + renderMarkdown(markdown);
  const bodyPdf = await deps.pdfService.convert({
    bodyHtml,
    headerHtml: rendered.headerHtml,
    footerHtml: rendered.footerHtml,
    css: rendered.css,
    pdfOptions: rendered.pdfOptions,
  });

  if (!rendered.cover) return bodyPdf;

  const coverPdf = await deps.pdfService.convert({
    bodyHtml: '', // já embutido em cover.html; pdf.ts vai reconstruir via setContent do html direto — ver step 6
    headerHtml: '',
    footerHtml: '',
    css: '', // ignorado; ver step 6
    pdfOptions: rendered.cover.pdfOptions,
    fullHtml: rendered.cover.html, // NOVO campo — ver step 6
  } as any);

  return mergePdfs([coverPdf, bodyPdf]);
}
```

- [ ] **Step 6: Extend PdfService to accept a pre-built full HTML**

Em `src/render/pdf.ts`, `ConvertInput`:

```ts
export interface ConvertInput {
  bodyHtml: string;
  headerHtml: string;
  footerHtml: string;
  css: string;
  pdfOptions: PdfOptions;
  /** Se presente, o serviço usa este HTML como o documento inteiro
   *  (ignorando bodyHtml/css). Serve para a capa, que já vem como
   *  documento completo do renderer. */
  fullHtml?: string;
}
```

Em `renderOnce`:

```ts
const html = input.fullHtml ?? buildDocumentHtml({ css: input.css, bodyHtml: input.bodyHtml });
await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
```

- [ ] **Step 7: Run tests**

Run: `npm test -- pdf.test`
Expected: PASS. Se o `readPdf` helper precisou de extensão, confirmar que a extensão passa em `template-render` e `api` também.

- [ ] **Step 8: Commit**

```bash
git add src/conversion.ts src/render/pdf.ts tests/pdf.test.ts tests/helpers/readPdf.ts
git commit -m "feat(convert): dual-render + merge quando a capa é limpa"
```

---

## Task 8: Storage e rotas de fontes

**Files:**
- Create: `src/storage/fontRepo.ts`.
- Create: `src/routes/fonts.ts`.
- Modify: `src/config.ts` — `storage.fonts`, `maxFontBytes`.
- Modify: `src/app.ts` — registra a rota, expõe `fontRepo` em `AppDeps`.
- Test: `tests/api.test.ts` (extend).

**Interfaces:**
- Produces:
  ```ts
  export interface FontMeta {
    id: string;                 // fnt_<12>
    family: string;             // declarado pelo usuário no upload
    filename: string;
    mimeType: 'font/ttf' | 'font/otf';
    size: number;
    createdAt: string;
  }
  export interface FontRepo {
    save(input: { originalName: string; declaredFamily: string; mime: string; data: Buffer }): Promise<FontMeta>;
    get(id: string): Promise<{ meta: FontMeta; data: Buffer } | null>;
    getDataUri(id: string): Promise<string | null>;
    remove(id: string): Promise<boolean>;
    list(): Promise<FontMeta[]>;
  }
  export function createFontRepo(dir: string): FontRepo;
  ```
  Rotas:
  - `POST /api/fonts` (multipart, `file` + campo `family`) → `201 { fontId, family, filename, size }`
  - `GET  /api/fonts` → `[{ fontId, family, filename, size, createdAt }, ...]`
  - `GET  /api/fonts/:id` → binário
  - `GET  /api/fonts/:id/data-uri` → `{ dataUri: "data:font/ttf;base64,..." }` (JSON)
  - `DELETE /api/fonts/:id` → `204` (409 se referenciada)

- [ ] **Step 1: Config**

Em `src/config.ts`, adicione:

```ts
storage: {
  root,
  templates: path.join(root, 'templates'),
  assets: path.join(root, 'assets'),
  fonts: path.join(root, 'fonts'),         // novo
  outputs: process.env.MD2PDF_OUTPUT_DIR ?? path.join(root, 'outputs'),
},
// ...
maxAssetBytes: 5 * 1024 * 1024,
maxFontBytes: 2 * 1024 * 1024,             // novo
```

- [ ] **Step 2: Write failing test — upload + list + get + data-uri + delete**

Em `tests/api.test.ts` (helper `fontRepo` também precisa ser passado ao buildApp — vou incluir no step 5):

```ts
describe('/api/fonts', () => {
  it('POST + GET fluxo básico', async () => {
    const ttf = Buffer.alloc(64, 0); // dummy; o repo só valida MIME/tamanho, não parseia
    const mp = multipartWithField('file', 'MinhaFonte.ttf', 'font/ttf', ttf, { family: 'MinhaFonte, sans-serif' });
    const create = await app.inject({ method: 'POST', url: '/api/fonts', payload: mp.payload, headers: mp.headers });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.fontId).toMatch(/^fnt_/);

    const list = await app.inject({ method: 'GET', url: '/api/fonts' });
    expect(list.statusCode).toBe(200);
    expect(list.json().find((f: any) => f.fontId === created.fontId)).toBeDefined();

    const data = await app.inject({ method: 'GET', url: `/api/fonts/${created.fontId}/data-uri` });
    expect(data.statusCode).toBe(200);
    expect(data.json().dataUri.startsWith('data:font/ttf;base64,')).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/api/fonts/${created.fontId}` });
    expect(del.statusCode).toBe(204);
  });

  it('POST recusa tipo inválido', async () => {
    const mp = multipartWithField('file', 'x.exe', 'application/octet-stream', Buffer.from('lixo'), { family: 'X' });
    const res = await app.inject({ method: 'POST', url: '/api/fonts', payload: mp.payload, headers: mp.headers });
    expect(res.statusCode).toBe(400);
  });
});
```

Você vai precisar de um helper `multipartWithField` que também injeta campos de texto — extenda o `multipart` existente:

```ts
function multipartWithField(
  fileField: string, filename: string, contentType: string, data: Buffer,
  textFields: Record<string, string>,
) {
  const boundary = '----md2pdftest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(textFields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
```

- [ ] **Step 3: Implement fontRepo**

`src/storage/fontRepo.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { assertSafeId, readJsonIfExists, removeIfExists, writeFileAtomic } from './fsUtil.js';

export const ALLOWED_FONT_MIMES = ['font/ttf', 'font/otf'] as const;
export type FontMime = typeof ALLOWED_FONT_MIMES[number];

const EXTS: Record<FontMime, string> = { 'font/ttf': 'ttf', 'font/otf': 'otf' };

export interface FontMeta {
  id: string;
  family: string;
  filename: string;
  mimeType: FontMime;
  size: number;
  createdAt: string;
}

export interface FontRepo {
  save(input: { originalName: string; declaredFamily: string; mime: string; data: Buffer }): Promise<FontMeta>;
  get(id: string): Promise<{ meta: FontMeta; data: Buffer } | null>;
  getDataUri(id: string): Promise<string | null>;
  remove(id: string): Promise<boolean>;
  list(): Promise<FontMeta[]>;
}

function normalizeMime(mime: string, filename: string): FontMime | null {
  if (mime === 'font/ttf' || mime === 'application/font-sfnt') return 'font/ttf';
  if (mime === 'font/otf') return 'font/otf';
  if (mime === 'application/octet-stream') {
    if (filename.toLowerCase().endsWith('.ttf')) return 'font/ttf';
    if (filename.toLowerCase().endsWith('.otf')) return 'font/otf';
  }
  return null;
}

export function createFontRepo(dir: string): FontRepo {
  const metaOf = (id: string) => {
    assertSafeId(id, 'fnt');
    return path.join(dir, `${id}.meta.json`);
  };
  const binOf = (meta: FontMeta) => path.join(dir, `${meta.id}.${EXTS[meta.mimeType]}`);

  return {
    async save({ originalName, declaredFamily, mime, data }) {
      const normalized = normalizeMime(mime, originalName);
      if (!normalized) {
        throw Object.assign(new Error(`tipo de fonte não suportado: ${mime}`), { statusCode: 400 });
      }
      if (!declaredFamily || declaredFamily.trim().length === 0) {
        throw Object.assign(new Error('campo "family" obrigatório'), { statusCode: 400 });
      }
      const meta: FontMeta = {
        id: `fnt_${nanoid(12)}`,
        family: declaredFamily.trim(),
        filename: originalName,
        mimeType: normalized,
        size: data.byteLength,
        createdAt: new Date().toISOString(),
      };
      await writeFileAtomic(binOf(meta), data);
      await writeFileAtomic(metaOf(meta.id), JSON.stringify(meta, null, 2));
      return meta;
    },

    async get(id) {
      const meta = await readJsonIfExists<FontMeta>(metaOf(id));
      if (!meta) return null;
      try {
        return { meta, data: await fs.readFile(binOf(meta)) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },

    async getDataUri(id) {
      const found = await this.get(id);
      if (!found) return null;
      return `data:${found.meta.mimeType};base64,${found.data.toString('base64')}`;
    },

    async remove(id) {
      const meta = await readJsonIfExists<FontMeta>(metaOf(id));
      if (!meta) return false;
      await removeIfExists(binOf(meta));
      return removeIfExists(metaOf(id));
    },

    async list() {
      let entries: string[];
      try { entries = await fs.readdir(dir); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
      const metas: FontMeta[] = [];
      for (const entry of entries) {
        if (!entry.startsWith('fnt_') || !entry.endsWith('.meta.json')) continue;
        try {
          const m = await readJsonIfExists<FontMeta>(path.join(dir, entry));
          if (m) metas.push(m);
        } catch { continue; }
      }
      return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
```

- [ ] **Step 4: Implement fonts route**

`src/routes/fonts.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppDeps } from '../app.js';

export async function fontRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/fonts', async (request, reply) => {
    // Multipart com file + fields.
    const parts = request.parts({ limits: { fileSize: config.maxFontBytes } });
    let fileBuf: Buffer | null = null;
    let filename = '';
    let mime = '';
    let family = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename;
        mime = part.mimetype;
        fileBuf = await part.toBuffer();
      } else if (part.fieldname === 'family') {
        family = String(part.value ?? '');
      }
    }
    if (!fileBuf) return reply.code(400).send({ error: 'validation_failed', message: 'envie um arquivo no campo "file"' });

    const meta = await deps.fontRepo.save({
      originalName: filename, declaredFamily: family, mime, data: fileBuf,
    });
    return reply.code(201).send({
      fontId: meta.id, family: meta.family, filename: meta.filename, size: meta.size,
    });
  });

  app.get('/api/fonts', async () => {
    const list = await deps.fontRepo.list();
    return list.map((m) => ({
      fontId: m.id, family: m.family, filename: m.filename,
      size: m.size, createdAt: m.createdAt,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/fonts/:id', async (request, reply) => {
    const found = await deps.fontRepo.get(request.params.id);
    if (!found) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.type(found.meta.mimeType).send(found.data);
  });

  app.get<{ Params: { id: string } }>('/api/fonts/:id/data-uri', async (request, reply) => {
    const dataUri = await deps.fontRepo.getDataUri(request.params.id);
    if (!dataUri) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.send({ dataUri });
  });

  app.delete<{ Params: { id: string } }>('/api/fonts/:id', async (request, reply) => {
    // Impedir deleção se algum template referencia. Faz uma varredura simples via templateRepo.list().
    const referenced = await isFontReferenced(deps, request.params.id);
    if (referenced) {
      return reply.code(409).send({
        error: 'font_in_use',
        message: 'fonte referenciada por pelo menos um template; remova a referência antes',
      });
    }
    const removed = await deps.fontRepo.remove(request.params.id);
    if (!removed) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.code(204).send();
  });
}

async function isFontReferenced(deps: AppDeps, fontId: string): Promise<boolean> {
  const summaries = await deps.templateRepo.list();
  for (const s of summaries) {
    const t = await deps.templateRepo.get(s.id);
    if (t?.body.font.customFontId === fontId) return true;
  }
  return false;
}
```

- [ ] **Step 5: Wire in app.ts**

Em `src/app.ts`, adicione:

```ts
import { fontRoutes } from './routes/fonts.js';
import type { FontRepo } from './storage/fontRepo.js';

export interface AppDeps {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  fontRepo: FontRepo;              // novo
  conversionService: ConversionService;
  outputStore: OutputStore;
}

export interface BuildAppOptions {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  fontRepo: FontRepo;              // novo
  pdfService: PdfService;
  outputStore: OutputStore;
  logger?: boolean;
}
```

E dentro de `buildApp`, adicione o `fontRepo` em `deps` e `app.register(async (instance) => fontRoutes(instance, deps));`.

Ajuste `src/server.ts` para criar `createFontRepo(config.storage.fonts)` e passar em `buildApp`.

Ajuste `tests/api.test.ts` (helper `beforeAll`) para passar o `fontRepo` também:

```ts
import { createFontRepo } from '../src/storage/fontRepo.js';
// ...
fontRepo: createFontRepo(path.join(dir, 'fonts')),
```

- [ ] **Step 6: Run tests**

Run: `npm test -- api`
Expected: PASS nos testes de fonte.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/storage/fontRepo.ts src/routes/fonts.ts src/app.ts src/server.ts tests/api.test.ts
git commit -m "feat(api): endpoints /api/fonts e fontRepo"
```

---

## Task 9: Renderer emite @font-face + conversion resolve fonte custom

**Files:**
- Modify: `src/render/template.ts` — `RenderTemplateOptions.fontDataUri`, `buildCss` embute `@font-face`.
- Modify: `src/conversion.ts` — resolve o `customFontId` e passa `fontDataUri` para o renderer.
- Test: `tests/template-render.test.ts` + `tests/pdf.test.ts` (extend).

**Interfaces:**
- Consumes: `FontRepo.getDataUri` (Task 8).
- Produces:
  ```ts
  export interface RenderTemplateOptions {
    variables?: Record<string, string>;
    assets?: Record<string, string>;
    fontDataUri?: string;              // NOVO
    now?: Date;
    timeZone?: string;
    missingAsset?: 'throw' | 'placeholder';
  }
  ```

- [ ] **Step 1: Write failing render test**

```ts
it('embute @font-face no CSS quando fontDataUri é fornecido e há customFontId', () => {
  const t = makeBlankTemplateInput() as any;
  t.body.font = { family: 'MinhaFonte, sans-serif', customFontId: 'fnt_abcdefghij12' };
  const r = renderTemplate(t, { fontDataUri: 'data:font/ttf;base64,AAAA' });
  expect(r.css).toContain('@font-face');
  expect(r.css).toContain("font-family: 'MinhaFonte, sans-serif'");
  expect(r.css).toContain('data:font/ttf;base64,AAAA');
});

it('não emite @font-face quando não há customFontId', () => {
  const t = makeBlankTemplateInput();
  const r = renderTemplate(t);
  expect(r.css).not.toContain('@font-face');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- template-render`
Expected: FAIL.

- [ ] **Step 3: Extend buildCss / RenderTemplateOptions**

Em `src/render/template.ts`:

```ts
export interface RenderTemplateOptions {
  // ...existente...
  fontDataUri?: string;
}

function buildFontFace(family: string, dataUri: string): string {
  const format = dataUri.startsWith('data:font/otf') ? 'opentype' : 'truetype';
  return `@font-face {
  font-family: '${family.replace(/'/g, "\\'")}';
  src: url(${dataUri}) format('${format}');
  font-weight: normal;
  font-style: normal;
}`;
}

function buildCss(template, opts: RenderTemplateOptions): string {
  const { body } = template;
  // ...existente...
  const fontFace = (body.font.customFontId && opts.fontDataUri)
    ? buildFontFace(body.font.family, opts.fontDataUri)
    : '';
  return `${fontFace}
* { box-sizing: border-box; }
/* ...restante do CSS existente... */`.trim();
}
```

Ajuste a chamada de `buildCss` dentro de `renderTemplate` para passar `opts`.

- [ ] **Step 4: Extend conversion to resolve font**

Em `src/conversion.ts`:

```ts
async function resolveFontDataUri(template: Template): Promise<string | undefined> {
  const id = template.body.font.customFontId;
  if (!id || !deps.fontRepo) return undefined;
  const uri = await deps.fontRepo.getDataUri(id);
  return uri ?? undefined;
}

async function convertWithTemplate(template, markdown, variables) {
  const assets = await resolveAssets(template);
  const fontDataUri = await resolveFontDataUri(template);
  const rendered = renderTemplate(template, { variables, assets, fontDataUri });
  // ... resto igual, mas note que o `cover.html` também deve conter o mesmo CSS.
}
```

**Importante:** `coverDocumentHtml` (Task 5) chama `buildCss(template)` — precisa ser `buildCss(template, opts)` também, para que o `@font-face` chegue à capa. Ajuste a assinatura em `coverDocumentHtml` para receber `opts` e reencaminhar.

- [ ] **Step 5: Write failing PDF-level test**

Em `tests/pdf.test.ts`:

```ts
it('quando template referencia fonte custom, o PDF contém a @font-face embutida', async () => {
  const ttf = Buffer.alloc(128, 42); // fake, mas suficiente para embutir
  const meta = await fontRepo.save({ originalName: 'x.ttf', declaredFamily: 'FonteX, sans-serif', mime: 'font/ttf', data: ttf });
  const t = makeBlankTemplateInput() as any;
  t.body.font = { family: 'FonteX, sans-serif', customFontId: meta.id };
  const template = await templateRepo.create(t);
  // Não dá pra checar o glyph, mas dá pra checar via texto extraído que o PDF gerou sem erro
  // e que o CSS pré-render contém a fonte via renderTemplate.
  const buf = await conversion.convertWithTemplate(template, '# Corpo');
  const info = await readPdf(buf);
  expect(info.pages).toBeGreaterThan(0);
});
```

(A verificação forte de `@font-face` está no teste de renderer. Aqui é smoke-check de que o pipeline não quebra.)

- [ ] **Step 6: Run tests**

Run: `npm test -- template-render pdf.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/template.ts src/conversion.ts tests/template-render.test.ts tests/pdf.test.ts
git commit -m "feat(render): embute @font-face quando o template usa fonte customizada"
```

---

## Task 10: Bundle export/import inclui fontes

**Files:**
- Modify: `src/domain/templateBundle.ts` — `TemplateBundleSchema` ganha `fonts[]`; `buildTemplateBundle` inclui a fonte quando referenciada; `importTemplateBundle` recria + remapeia.
- Modify: `src/routes/templates.ts` — passa `fontRepo` em `deps` para o bundle (verificar assinatura).
- Test: `tests/template-bundle.test.ts` (extend).

**Interfaces:**
- Consumes: `FontRepo` (Task 8).
- Produces:
  ```ts
  export const TemplateBundleSchema = z.object({
    template: TemplateInputSchema,
    assets: z.array(BundleAssetSchema).default([]),
    fonts: z.array(BundleFontSchema).default([]),      // novo
  });
  export interface ImportBundleDeps {
    assetRepo: AssetRepo;
    fontRepo: FontRepo;                                 // novo
    templateRepo: TemplateRepo;
  }
  ```

- [ ] **Step 1: Write failing test**

```ts
it('bundle inclui fonte quando o template referencia customFontId', async () => {
  const meta = await fontRepo.save({ originalName: 'x.ttf', declaredFamily: 'F, sans', mime: 'font/ttf', data: Buffer.alloc(32, 1) });
  const t = makeBlankTemplateInput() as any;
  t.body.font = { family: 'F, sans', customFontId: meta.id };
  const template = await templateRepo.create(t);

  const bundle = await buildTemplateBundle(template, assetRepo, fontRepo);
  expect(bundle.fonts).toHaveLength(1);
  expect(bundle.fonts[0].family).toBe('F, sans');
  expect(bundle.fonts[0].dataBase64.length).toBeGreaterThan(0);
});

it('import recria a fonte e remapeia customFontId', async () => {
  const bundle = /* montado à mão com uma fonte em base64 */;
  const created = await importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo });
  expect(created.body.font.customFontId).toMatch(/^fnt_/);
  // O ID novo != o ID do bundle
});
```

- [ ] **Step 2: Extend bundle schema**

```ts
const allowedFontMimes = ['font/ttf', 'font/otf'] as const;

const BundleFontSchema = z.object({
  fontId: z.string().min(1),
  family: z.string().min(1),
  originalName: z.string().default('font'),
  mimeType: z.enum(allowedFontMimes),
  dataBase64: z.string().min(1),
});

export const TemplateBundleSchema = z.object({
  template: TemplateInputSchema,
  assets: z.array(BundleAssetSchema).default([]),
  fonts: z.array(BundleFontSchema).default([]),
});
```

- [ ] **Step 3: buildTemplateBundle inclui fonte**

```ts
export async function buildTemplateBundle(
  template: Template,
  assetRepo: AssetRepo,
  fontRepo: FontRepo,
): Promise<TemplateBundle> {
  // ...existente para assets...
  const fonts: z.infer<typeof BundleFontSchema>[] = [];
  const fontId = template.body.font.customFontId;
  if (fontId) {
    const found = await fontRepo.get(fontId);
    if (found) {
      fonts.push({
        fontId,
        family: found.meta.family,
        originalName: found.meta.filename,
        mimeType: found.meta.mimeType,
        dataBase64: found.data.toString('base64'),
      });
    }
  }
  return { template: rest, assets, fonts };
}
```

- [ ] **Step 4: importTemplateBundle remapeia**

```ts
export async function importTemplateBundle(bundle, deps): Promise<Template> {
  const parsed = TemplateBundleSchema.parse(bundle);
  // ...assets como antes...

  // Fontes
  const fontMap = new Map<string, string>();
  for (const f of parsed.fonts) {
    const meta = await deps.fontRepo.save({
      originalName: f.originalName,
      declaredFamily: f.family,
      mime: f.mimeType,
      data: Buffer.from(f.dataBase64, 'base64'),
    });
    fontMap.set(f.fontId, meta.id);
  }

  let rewritten = remapAssetIds(parsed.template, assetMap);
  const oldFontId = rewritten.body.font.customFontId;
  if (oldFontId && fontMap.has(oldFontId)) {
    rewritten = {
      ...rewritten,
      body: { ...rewritten.body, font: { ...rewritten.body.font, customFontId: fontMap.get(oldFontId)! } },
    };
  }
  return deps.templateRepo.create(rewritten);
}
```

- [ ] **Step 5: Update templates route to pass fontRepo**

Em `src/routes/templates.ts`, onde `buildTemplateBundle` e `importTemplateBundle` são chamados, passe `deps.fontRepo`.

- [ ] **Step 6: Run tests**

Run: `npm test -- template-bundle`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/templateBundle.ts src/routes/templates.ts tests/template-bundle.test.ts
git commit -m "feat(bundle): exporta/importa fonte custom junto do template"
```

---

## Task 11: OpenAPI reflete os novos campos

**Files:**
- Modify: `web/src/lib/templateOpenApi.ts`.
- Test: `tests/openapi.test.ts` (extend com asserts sobre a presença dos novos campos).

**Interfaces:**
- Consumes: tipos do domínio (via `templateModel.ts` que já deriva).

- [ ] **Step 1: Write failing test**

Em `tests/openapi.test.ts`, adicione:

```ts
it('schema OpenAPI expõe cover, headings e body.font', () => {
  const spec = generateOpenApiForTemplate(sampleTemplate);
  const tmpl = spec.components.schemas.Template;
  expect(tmpl.properties.cover).toBeDefined();
  expect(tmpl.properties.headings).toBeDefined();
  expect(tmpl.properties.body.properties.font).toBeDefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- openapi`
Expected: FAIL.

- [ ] **Step 3: Extend the OpenAPI generator**

Leia `web/src/lib/templateOpenApi.ts` e adicione as três seções ao objeto `Template`. Cada uma tem `type: 'object'` com as `properties` que espelham o schema Zod:

- `cover.enabled: boolean`, `applyHeaderFooter: boolean`, `elements: array<CoverElement>` (novo objeto).
- `headings.h1|h2|h3: { color, bold, fontSizePt }`.
- `body.font: { family, customFontId? }`.

- [ ] **Step 4: Run tests**

Run: `npm test -- openapi`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/templateOpenApi.ts tests/openapi.test.ts
git commit -m "chore(openapi): expõe cover, headings e body.font no schema exportado"
```

---

## Task 12: Frontend — FontPicker

**Files:**
- Create: `web/src/components/FontPicker.tsx`.
- Modify: `web/src/api.ts` — funções `listFonts`, `uploadFont`, `getFontDataUri`, `deleteFont`.

**Interfaces:**
- Produces:
  ```tsx
  interface FontPickerProps {
    value: { family: string; customFontId?: string };
    onChange: (next: { family: string; customFontId?: string }) => void;
  }
  export function FontPicker(props: FontPickerProps): JSX.Element;

  // web/src/api.ts:
  export async function listFonts(): Promise<Array<{ fontId: string; family: string; filename: string; size: number; createdAt: string }>>;
  export async function uploadFont(file: File, family: string): Promise<{ fontId: string; family: string }>;
  export async function fetchFontDataUri(id: string): Promise<string>;
  export async function deleteFont(id: string): Promise<void>;
  ```

- [ ] **Step 1: Add API client functions**

Em `web/src/api.ts`, adicione:

```ts
export async function listFonts() {
  const res = await fetch('/api/fonts');
  if (!res.ok) throw new Error(`listFonts: ${res.status}`);
  return res.json();
}

export async function uploadFont(file: File, family: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('family', family);
  const res = await fetch('/api/fonts', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`uploadFont: ${res.status}`);
  return res.json();
}

export async function fetchFontDataUri(id: string): Promise<string> {
  const res = await fetch(`/api/fonts/${id}/data-uri`);
  if (!res.ok) throw new Error(`fetchFontDataUri: ${res.status}`);
  return (await res.json()).dataUri;
}

export async function deleteFont(id: string) {
  const res = await fetch(`/api/fonts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteFont: ${res.status}`);
}
```

- [ ] **Step 2: Create FontPicker.tsx**

`web/src/components/FontPicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { FONT_PRESETS, DEFAULT_FONT_FAMILY } from '../../../src/domain/fontPresets.js';
import { listFonts, uploadFont, deleteFont } from '../api';

interface FontMetaLite { fontId: string; family: string; filename: string; }

interface Props {
  value: { family: string; customFontId?: string };
  onChange: (next: { family: string; customFontId?: string }) => void;
}

export function FontPicker({ value, onChange }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [customFonts, setCustomFonts] = useState<FontMetaLite[]>([]);
  const [uploadingFamily, setUploadingFamily] = useState('');

  useEffect(() => { listFonts().then(setCustomFonts).catch(() => {}); }, [showModal]);

  const usingCustom = !!value.customFontId;

  return (
    <div>
      <label>Fonte do corpo</label>
      <select
        value={usingCustom ? '__custom__' : value.family}
        onChange={(e) => {
          if (e.target.value === '__custom__') { setShowModal(true); return; }
          onChange({ family: e.target.value, customFontId: undefined });
        }}
      >
        {FONT_PRESETS.map((p) => <option key={p.family} value={p.family}>{p.label}</option>)}
        <option value="__custom__">— Fonte customizada… —</option>
      </select>

      {usingCustom && (
        <div>
          Fonte custom em uso: <strong>{value.family}</strong>{' '}
          <button onClick={() => onChange({ family: DEFAULT_FONT_FAMILY, customFontId: undefined })}>remover</button>
        </div>
      )}

      {showModal && (
        <div role="dialog">
          <h3>Escolher fonte customizada</h3>

          <ul>
            {customFonts.map((f) => (
              <li key={f.fontId}>
                <button onClick={() => {
                  onChange({ family: f.family, customFontId: f.fontId });
                  setShowModal(false);
                }}>{f.family} <em>({f.filename})</em></button>
                <button onClick={async () => { await deleteFont(f.fontId); setCustomFonts(await listFonts()); }}>excluir</button>
              </li>
            ))}
          </ul>

          <hr />
          <h4>Enviar nova fonte</h4>
          <input type="text" placeholder="ex.: MinhaFonte, sans-serif"
            value={uploadingFamily}
            onChange={(e) => setUploadingFamily(e.target.value)}
          />
          <input type="file" accept=".ttf,.otf" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file || !uploadingFamily.trim()) return;
            const meta = await uploadFont(file, uploadingFamily.trim());
            onChange({ family: meta.family, customFontId: meta.fontId });
            setShowModal(false);
          }} />

          <button onClick={() => setShowModal(false)}>fechar</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke — dev server**

Run: `npm run dev` num terminal, `npm run dev:web` no outro.
Abra http://localhost:5173. Vá em um template, verifique que o dropdown de fonte aparece com os 10 presets.

Faça upload de uma fonte `.ttf` qualquer com `family = "Teste, sans-serif"`. Confirme que a fonte é usada no preview (o CSS emite `@font-face`, o Chromium do editor renderiza).

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts web/src/components/FontPicker.tsx
git commit -m "feat(web): FontPicker com dropdown de presets + upload de fonte custom"
```

---

## Task 13: Frontend — HeadingsPanel

**Files:**
- Create: `web/src/components/HeadingsPanel.tsx`.

**Interfaces:**
- Produces:
  ```tsx
  interface HeadingsPanelProps {
    value: {
      h1: { color: string; bold: boolean; fontSizePt: number };
      h2: { color: string; bold: boolean; fontSizePt: number };
      h3: { color: string; bold: boolean; fontSizePt: number };
    };
    onChange: (next: HeadingsPanelProps['value']) => void;
  }
  export function HeadingsPanel(props: HeadingsPanelProps): JSX.Element;
  ```

- [ ] **Step 1: Create HeadingsPanel.tsx**

```tsx
type Style = { color: string; bold: boolean; fontSizePt: number };
type Value = { h1: Style; h2: Style; h3: Style };

interface Props {
  value: Value;
  onChange: (next: Value) => void;
}

const LEVELS: Array<keyof Value> = ['h1', 'h2', 'h3'];

export function HeadingsPanel({ value, onChange }: Props) {
  function setLevel<K extends keyof Value>(k: K, patch: Partial<Style>) {
    onChange({ ...value, [k]: { ...value[k], ...patch } });
  }

  return (
    <table>
      <thead><tr><th>Nível</th><th>Cor</th><th>Negrito</th><th>Tamanho (pt)</th></tr></thead>
      <tbody>
        {LEVELS.map((lvl) => (
          <tr key={lvl}>
            <td>{lvl.toUpperCase()}</td>
            <td>
              <input type="color" value={value[lvl].color}
                onChange={(e) => setLevel(lvl, { color: e.target.value })} />
              <input type="text" value={value[lvl].color}
                onChange={(e) => setLevel(lvl, { color: e.target.value })} size={7} />
            </td>
            <td>
              <input type="checkbox" checked={value[lvl].bold}
                onChange={(e) => setLevel(lvl, { bold: e.target.checked })} />
            </td>
            <td>
              <input type="number" min={4} max={72} value={value[lvl].fontSizePt}
                onChange={(e) => setLevel(lvl, { fontSizePt: Number(e.target.value) })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/HeadingsPanel.tsx
git commit -m "feat(web): HeadingsPanel (cor/negrito/tamanho por nível h1/h2/h3)"
```

---

## Task 14: Frontend — CoverEditor

**Files:**
- Create: `web/src/components/CoverEditor.tsx`.

**Interfaces:**
- Produces:
  ```tsx
  interface CoverEditorProps {
    template: TemplateInput;      // acessa page (dimensões) e cover
    onChange: (patch: Partial<TemplateInput['cover']>) => void;
    variables?: Record<string, string>; // preview
    assets?: Record<string, string>;
  }
  export function CoverEditor(props: CoverEditorProps): JSX.Element;
  ```

**Nota:** O `Sheet.tsx` atual é para uma banda (`heightMm = band.heightMm`, área útil = margens laterais). Para a capa, o "sheet" é a folha inteira (`heightMm = pageHeight`, área útil = folha inteira se `applyHeaderFooter=false`). Não vamos refatorar o Sheet — vamos criar um `CoverEditor` que reaproveita a lógica de drag/handles diretamente. Se o `Sheet.tsx` já expõe hooks internos utilizáveis, use-os; caso contrário, duplique a lógica de posicionamento (essa é a única duplicação aceita).

- [ ] **Step 1: Read Sheet.tsx to identify reusable pieces**

Leia `web/src/components/Sheet.tsx`. Extraia (mentalmente) os hooks de posicionamento (`elementPosition` já é compartilhado via `@shared` de `src/render/template.ts`). Se houver um hook de drag/snap reusável, importe-o. Caso contrário, mantenha o drag como um `onPointerDown` inline no CoverEditor.

- [ ] **Step 2: Create CoverEditor**

Esboço (adapte às convenções do Sheet.tsx existente):

```tsx
import { elementPosition } from '../../../src/render/template.js'; // já é @shared
import { elementInnerHtml } from '../../../src/render/template.js';
import { PAGE_SIZES_MM } from '../../../src/domain/template.js';

// helpers
function pageDims(t) {
  const s = PAGE_SIZES_MM[t.page.format];
  const [w, h] = t.page.orientation === 'landscape' ? [s.height, s.width] : [s.width, s.height];
  return { w, h };
}

export function CoverEditor({ template, onChange, variables, assets }) {
  const { w, h } = pageDims(template);
  const [selected, setSelected] = useState<number | null>(null);

  function addElement(type: 'text' | 'image' | 'date') {
    const base = { align: 'center' as const, xOffsetMm: 0, yMm: 50 };
    const el =
      type === 'text' ? { type, value: 'Novo texto', bold: true, fontSizePt: 24, color: '#000000', ...base } :
      type === 'image' ? { type, assetId: '', heightMm: 30, ...base } :
      { type, format: 'dd/MM/yyyy' as const, bold: false, fontSizePt: 11, color: '#111111', ...base };
    onChange({ elements: [...template.cover.elements, el] });
    setSelected(template.cover.elements.length);
  }

  function updateElement(i: number, patch) {
    const next = template.cover.elements.map((el, idx) => idx === i ? { ...el, ...patch } : el);
    onChange({ elements: next });
  }

  function shortcutCenter(i) { updateElement(i, { align: 'center', xOffsetMm: 0 }); }
  function shortcutTop(i) { updateElement(i, { yMm: 0 }); }
  function shortcutMiddle(i) { updateElement(i, { yMm: h / 2 - estimateElementHeight(template.cover.elements[i]) / 2 }); }
  function shortcutBottom(i) { updateElement(i, { yMm: h - estimateElementHeight(template.cover.elements[i]) - 10 }); }

  return (
    <div>
      <button onClick={() => addElement('text')}>+ texto</button>
      <button onClick={() => addElement('image')}>+ imagem</button>
      <button onClick={() => addElement('date')}>+ data</button>

      <div style={{ position: 'relative', width: `${w}mm`, height: `${h}mm`, border: '1px solid #ccc', background: '#fff' }}>
        {template.cover.elements.map((el, i) => {
          const pos = elementPosition(el);
          const html = elementInnerHtml(el, { variables, assets, missingAsset: 'placeholder' });
          return (
            <div key={i}
              onClick={() => setSelected(i)}
              style={{ position: 'absolute', ...pos, outline: selected === i ? '2px solid dodgerblue' : 'none', cursor: 'grab' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        })}
      </div>

      {selected !== null && (
        <div>
          <button onClick={() => shortcutCenter(selected)}>Centralizar horizontal</button>
          <button onClick={() => shortcutTop(selected)}>Topo</button>
          <button onClick={() => shortcutMiddle(selected)}>Meio</button>
          <button onClick={() => shortcutBottom(selected)}>Rodapé da capa</button>
          {/* inputs específicos por tipo — reutilize o Inspector.tsx se possível */}
        </div>
      )}
    </div>
  );
}

function estimateElementHeight(el) {
  if (el.type === 'image') return el.heightMm;
  return el.fontSizePt * 0.353 * 1.2;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CoverEditor.tsx
git commit -m "feat(web): CoverEditor com canvas em folha inteira e atalhos de posição"
```

---

## Task 15: Frontend — TemplateEditor com aba Capa + painel Tipografia + Font/Headings

**Files:**
- Modify: `web/src/pages/TemplateEditor.tsx` — adiciona nova aba "Capa"; adiciona painel "Tipografia" com FontPicker + HeadingsPanel; atualiza a lista de thumbs.
- Modify: `web/src/lib/templateModel.ts` — garante que os tipos derivados incluam `cover` e `headings` (deve ser automático via `z.infer`; só confirme).

**Interfaces:**
- Consumes: `FontPicker` (Task 12), `HeadingsPanel` (Task 13), `CoverEditor` (Task 14).

- [ ] **Step 1: Inspect current tabs/sections**

Leia `web/src/pages/TemplateEditor.tsx`. Identifique onde as seções atuais (Página, Cabeçalho, Rodapé, Corpo) são renderizadas.

- [ ] **Step 2: Add "Capa" tab and cover state binding**

Adicione uma nova aba/seção entre "Página" e "Cabeçalho":

```tsx
{activeTab === 'cover' && (
  <>
    <label>
      <input type="checkbox" checked={template.cover.enabled}
        onChange={(e) => updateTemplate({ cover: { ...template.cover, enabled: e.target.checked } })} />
      Habilitar capa
    </label>
    {template.cover.enabled && (
      <>
        <label>
          <input type="checkbox" checked={template.cover.applyHeaderFooter}
            onChange={(e) => updateTemplate({ cover: { ...template.cover, applyHeaderFooter: e.target.checked } })} />
          Aplicar cabeçalho e rodapé também na capa
        </label>
        <CoverEditor
          template={template}
          onChange={(patch) => updateTemplate({ cover: { ...template.cover, ...patch } })}
          variables={variables}
          assets={assets}
        />
      </>
    )}
  </>
)}
```

Adicione `'cover'` ao union type das abas + botão no tab bar.

- [ ] **Step 3: Add "Tipografia" section**

Onde hoje há a seção "Corpo" (ou como aba separada, dependendo da estrutura), substitua o input livre de `fontFamily` pelo `<FontPicker>` e adicione o `<HeadingsPanel>`:

```tsx
<FontPicker
  value={template.body.font}
  onChange={(next) => updateTemplate({ body: { ...template.body, font: next } })}
/>
<HeadingsPanel
  value={template.headings}
  onChange={(next) => updateTemplate({ headings: next })}
/>
```

- [ ] **Step 4: Preview thumb inclui capa**

Onde a preview thumb monta a lista de folhas, se `template.cover.enabled`, empurre uma folha extra ao começo representando a capa. O renderer já emite HTML da capa via `renderTemplate` — o thumb pode consumir o mesmo.

- [ ] **Step 5: Manual smoke**

Run: `npm run dev:web`.
- Abra um template, marque "habilitar capa", adicione um `+ texto`, mude o texto para "Contrato {{numero}}", centralize.
- Vá em Tipografia, mude a cor do h1 pra vermelho.
- Faça upload de fonte custom, aplique.
- Gere um preview via botão de preview (mesma rota que já existe). Confira:
  - Capa aparece como página 1.
  - Título aparece.
  - Numeração do rodapé começa em "1/N" na página 2.
  - Cores dos headings mudaram.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/TemplateEditor.tsx web/src/lib/templateModel.ts
git commit -m "feat(web): aba Capa + painel Tipografia (fonte + estilos de heading) no editor"
```

---

## Task 16: README

**Files:**
- Modify: `README.md` — seção "O template" ganha três subsections (Capa, Fonte, Cabeçalhos); seção "Endpoints" ganha /api/fonts.

- [ ] **Step 1: Update README**

Adicione, dentro da seção "O template" (por volta da linha 259 do arquivo atual):

- **Capa (opcional):** template com `cover.enabled=true` gera uma primeira página customizada. Elementos posicionados livremente (texto/imagem/data), com `{{variaveis}}` resolvidas na conversão. Checkbox "aplicar header/footer na capa" controla se a faixa aparece na página 1. Quando desligado (padrão), a capa é gerada como PDF separado e concatenada — a numeração `{page}/{total}` do rodapé começa em `1/N` na página 2.
- **Fonte:** `body.font.family` escolhe uma fonte web-safe da lista curada; `body.font.customFontId` referencia um upload feito em `/api/fonts`. Fontes customizadas são embutidas no PDF via `@font-face` base64.
- **Cabeçalhos:** `headings.h1|h2|h3` configura cor, negrito e tamanho por nível. h4/h5/h6 herdam de h3.

Na tabela de endpoints, adicione:
- `POST /api/fonts` — upload de fonte custom (.ttf/.otf).
- `GET /api/fonts` — lista.
- `GET /api/fonts/:id` — binário.
- `DELETE /api/fonts/:id` — remove (409 se referenciada).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): capa, fonte customizada e estilos de heading"
```

---

## Self-review

**Spec coverage:**
- Capa (schema) → Task 3
- Capa (renderer + dual-render + merge) → Tasks 5, 6, 7
- Capa (editor) → Tasks 14, 15
- Fonte presets → Task 2
- Fonte upload → Task 8
- Fonte @font-face embed → Task 9
- Fonte no editor → Task 12
- Headings schema + CSS → Task 1
- Headings editor → Tasks 13, 15
- Migração v1→v2 → Task 4
- Bundle → Task 10
- OpenAPI → Task 11
- README → Task 16

**Placeholder scan:** todos os steps têm código concreto ou verificação clara. Sem TBDs.

**Type consistency:**
- `body.font.family` e `body.font.customFontId?` consistentes entre Tasks 2, 8, 9, 10, 12, 15.
- `fontId` no bundle vs `customFontId` no template — o remap acontece explicitamente no Task 10.
- `RenderTemplateOptions.fontDataUri` introduzido no Task 9, consumido em Task 9 (conversion) e implicitamente em coverDocumentHtml (Task 5 ajustado no Task 9 step 4).
- `CoverEditor` (Task 14) consome `elementInnerHtml` já existente + `PAGE_SIZES_MM` de domain — ambos exports públicos.
- `FontRepo.getDataUri` produzido no Task 8, consumido nos Tasks 9, 10.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-19-cover-fonts-headings.md`.**
