# Editor: posicionamento livre — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o modelo de zonas (esquerda/centro/direita) de header/footer por posicionamento livre por arrasto com âncora horizontal + offset, mantendo alinhamento como conceito first-class e suportando empilhamento vertical.

**Architecture:** Elementos passam a ter `align: 'left'|'center'|'right'`, `xOffsetMm` e `yMm`. A faixa vira `{ heightMm, elements }`. O renderer emite os elementos como `<div>` absolutamente posicionados via uma função pura `elementPosition` que o editor no browser também usa (via `@shared`). Migração de templates antigos (com `zones`) fica isolada no `templateRepo` — o restante do sistema só vê o formato novo.

**Tech Stack:** TypeScript 7, Zod 4, Node 22, Fastify, Vitest, Playwright (chromium), React 19, Vite 8.

**Spec:** [docs/superpowers/specs/2026-08-19-editor-posicionamento-livre-design.md](../specs/2026-08-19-editor-posicionamento-livre-design.md)

## Global Constraints

- Backend usa `noUncheckedIndexedAccess: true` — acesso a arrays sempre pode ser `undefined`. Nunca dereferencie `arr[i].campo` sem checar.
- Testes de PDF usam Chromium real (Playwright) e rodam em série (`fileParallelism: false`) — cuidado com fixtures que passam por `pdf.test.ts`.
- Todo texto no header/footer PRECISA ter `font-size` explícito no style inline — o Chromium injeta com `font-size: 0`.
- Imagens em header/footer SEMPRE via `data:` URI (não URL) — regra existente que continua valendo.
- `xOffsetMm` positivo = para dentro da folha (para longe da borda de âncora em `left`/`right`, para a direita em `center`).
- No editor, `mmPerCssPx = 96 / 25.4` (constante `MM_TO_PX` em `useFitScale.ts`).
- Tolerância de snap horizontal para âncora: 2mm. Vertical (topo/base da faixa): 1mm.
- Textos em português (Brasil), mesmo estilo/tom dos comentários existentes.

## File Structure

**Modificados no backend:**
- `src/domain/template.ts` — schema do elemento (com `align`/`xOffsetMm`/`yMm`), schema da faixa (`elements` no lugar de `zones`), superRefine de overflow, `makeBlankTemplateInput` atualizado, `ZONE_NAMES`/`ZoneName` removidos.
- `src/render/template.ts` — `bandHtml` reescrito com posicionamento absoluto, `zoneHtml`/`ZONE_ALIGN` removidos, nova função exportada `elementPosition`.
- `src/storage/templateRepo.ts` — chama `migrateTemplateJson` antes do `parse` em `get` e `list`; se migração alterou algo, grava de volta (self-healing).

**Criado no backend:**
- `src/domain/templateMigration.ts` — função pura `migrateTemplateJson(raw): { data: unknown; changed: boolean }` que achata `zones` em `elements`.

**Modificados no frontend:**
- `web/src/lib/templateModel.ts` — `Selection` novo, sem `ZoneName`; `makeElement` com defaults de posição; `updateBand` no lugar de `updateZone`; `replaceElement` ajustado; `collectAssetIds` percorre `elements`; nova função `applyDragDelta`; `ZONE_LABEL` removido.
- `web/src/components/Sheet.tsx` — remove markup `.slot/.slot__zone`; renderiza cada elemento como handle absolutamente posicionado via `elementPosition`; drag com pointer events; guia de snap; chip de posição.
- `web/src/components/Inspector.tsx` — título sem "zona"; bloco novo "posição" com 3 botões de âncora + inputs numéricos; teclado (setas/Delete/Esc); ajuste no botão "adicionar".
- `web/src/pages/TemplateEditor.tsx` — importa `Selection` novo e passa adiante.
- `web/src/styles.css` — remove `.slot`/`.slot__zone`; adiciona `.el-handle`, `.el-handle--selected`, `.snap-guide`, `.pos-badge`, `.align-shortcut`.

**Testes:**
- `tests/template-schema.test.ts` — todos os fixtures atualizados do formato `zones` para `elements`; novos testes para overflow (`yMm + altura > band.heightMm`) e para defaults de posição.
- `tests/template-render.test.ts` — fixtures atualizados; novos testes para o CSS emitido por cada âncora; teste de ordem no HTML por âncora.
- `tests/pdf.test.ts` — fixture `templateWithBands` atualizado.
- `tests/api.test.ts` — apenas indireto (usa `makeBlankTemplateInput`, que muda sozinho).
- `tests/storage.test.ts` — teste novo: um JSON gravado no formato antigo é lido, migrado e re-gravado no formato novo.
- `tests/template-migration.test.ts` (novo) — a função pura de migração isolada.

---

## Task 1: Schema — novo shape de elemento, faixa, superRefine e defaults

**Files:**
- Modify: `src/domain/template.ts`
- Modify: `tests/template-schema.test.ts`
- Modify: `tests/template-render.test.ts` (só o fixture `templateWith` para não quebrar a compilação)
- Modify: `tests/pdf.test.ts` (só o fixture `templateWithBands`)

**Interfaces produzidas:**
- `TemplateElement` inclui campos `align: 'left'|'center'|'right'` (default `'left'`), `xOffsetMm: number` (default `0`), `yMm: number` (default `0`).
- `TemplateBand` vira `{ heightMm: number; elements: TemplateElement[] }`.
- `makeBlankTemplateInput(name?)` retorna o novo shape (footer com um `pageNumber` `align='right'`).
- Exports `ZONE_NAMES` e `ZoneName` **removidos**.

- [ ] **Step 1: Escrever testes RED para os novos campos e superRefine**

Substituir o fixture `validInput` em `tests/template-schema.test.ts` pelo shape novo e adicionar os casos abaixo. Todo o arquivo:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TemplateInputSchema,
  TemplateSchema,
  makeBlankTemplateInput,
  applyVariables,
} from '../src/domain/template.js';

const validInput = () => ({
  name: 'Contrato Padrão',
  page: {
    format: 'A4' as const,
    orientation: 'portrait' as const,
    margins: { top: 35, right: 20, bottom: 25, left: 20 },
  },
  header: {
    heightMm: 25,
    elements: [
      { type: 'image' as const, assetId: 'ast_logo', heightMm: 12, align: 'left' as const, xOffsetMm: 0, yMm: 0 },
      { type: 'text' as const, value: 'ACME S/A', align: 'center' as const, xOffsetMm: 0, yMm: 0 },
    ],
  },
  footer: {
    heightMm: 15,
    elements: [
      { type: 'text' as const, value: 'Confidencial', align: 'left' as const, xOffsetMm: 0, yMm: 0 },
      { type: 'pageNumber' as const, format: 'Página {page} de {total}', align: 'right' as const, xOffsetMm: 0, yMm: 0 },
    ],
  },
});

describe('TemplateInputSchema', () => {
  it('aceita um template válido e aplica os defaults', () => {
    const parsed = TemplateInputSchema.parse(validInput());
    const text = parsed.header.elements[1]!;
    expect(text).toMatchObject({
      type: 'text',
      bold: false,
      fontSizePt: 9,
      color: '#444',
      align: 'center',
      xOffsetMm: 0,
      yMm: 0,
    });
    expect(parsed.body.fontSizePt).toBe(11);
  });

  it('aplica defaults de posição quando o elemento não os traz', () => {
    const input = validInput();
    // remove campos de posição
    (input.header.elements[0] as any).align = undefined;
    (input.header.elements[0] as any).xOffsetMm = undefined;
    (input.header.elements[0] as any).yMm = undefined;
    const parsed = TemplateInputSchema.parse(input);
    expect(parsed.header.elements[0]).toMatchObject({ align: 'left', xOffsetMm: 0, yMm: 0 });
  });

  it('rejeita margem superior menor que a altura do header', () => {
    const input = validInput();
    input.page.margins.top = 20; // header tem 25mm -> não cabe
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'page.margins.top');
    expect(issue?.message).toMatch(/30mm/);
  });

  it('rejeita margem inferior menor que a altura do footer', () => {
    const input = validInput();
    input.page.margins.bottom = 10; // footer tem 15mm
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.') === 'page.margins.bottom')).toBe(true);
  });

  it('aceita header de altura zero sem exigir margem', () => {
    const input = validInput();
    input.header = { heightMm: 0, elements: [] };
    input.page.margins.top = 15;
    expect(TemplateInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const input = { ...validInput(), name: '  ' };
    expect(TemplateInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejeita tipo de elemento desconhecido', () => {
    const input = validInput();
    (input.header.elements as unknown[]).push({ type: 'qrcode', align: 'left', xOffsetMm: 0, yMm: 0 });
    expect(TemplateInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejeita elemento que estoura a faixa (yMm + altura estimada > heightMm)', () => {
    const input = validInput();
    // texto 9pt ≈ 3.8mm × 1.2 line-height ≈ 4.6mm. Com yMm=25 numa faixa de 25mm, estoura.
    input.header.elements.push({
      type: 'text' as const,
      value: 'baixo demais',
      align: 'left' as const,
      xOffsetMm: 0,
      yMm: 24,
    });
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.').startsWith('header.elements'))).toBe(true);
  });

  it('aceita imagem posicionada no limite exato', () => {
    const input = validInput();
    input.header.elements.length = 0;
    input.header.elements.push({
      type: 'image' as const,
      assetId: 'ast_ok',
      heightMm: 10,
      align: 'right' as const,
      xOffsetMm: 0,
      yMm: 15, // 15 + 10 = 25 = heightMm exato
    });
    expect(TemplateInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('TemplateSchema', () => {
  it('exige id e timestamps', () => {
    expect(TemplateSchema.safeParse(validInput()).success).toBe(false);
    const full = {
      ...TemplateInputSchema.parse(validInput()),
      id: 'tpl_abc123',
      version: 1,
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    expect(TemplateSchema.safeParse(full).success).toBe(true);
  });
});

describe('makeBlankTemplateInput', () => {
  it('produz um template que passa na própria validação', () => {
    const blank = makeBlankTemplateInput('Novo');
    expect(TemplateInputSchema.safeParse(blank).success).toBe(true);
  });

  it('inicia com paginação alinhada à direita no rodapé', () => {
    const blank = makeBlankTemplateInput();
    expect(blank.header.elements).toEqual([]);
    expect(blank.footer.elements).toHaveLength(1);
    expect(blank.footer.elements[0]).toMatchObject({
      type: 'pageNumber',
      align: 'right',
      xOffsetMm: 0,
      yMm: 0,
    });
  });
});

describe('applyVariables', () => {
  it('substitui placeholders conhecidos', () => {
    expect(applyVariables('Cliente: {{cliente}}', { cliente: 'ACME' })).toBe('Cliente: ACME');
  });

  it('tolera espaços dentro das chaves', () => {
    expect(applyVariables('{{ cliente }}', { cliente: 'ACME' })).toBe('ACME');
  });

  it('troca placeholder sem valor por string vazia', () => {
    expect(applyVariables('X{{ausente}}Y', { cliente: 'ACME' })).toBe('XY');
  });

  it('não quebra sem variáveis', () => {
    expect(applyVariables('{{a}}', undefined)).toBe('');
    expect(applyVariables('texto puro', undefined)).toBe('texto puro');
  });
});
```

Também substituir em `tests/template-render.test.ts` o helper `templateWith` para gerar o novo shape (a implementação dos outros casos vem na Task 3; aqui só ajuste o esqueleto para o arquivo compilar):

```typescript
// no topo do arquivo — apenas o helper e os fixtures, o resto continua
function templateWith(over: Partial<TemplateInputRaw> = {}): TemplateInput {
  return TemplateInputSchema.parse({ ...makeBlankTemplateInput('T'), ...over });
}
// (deixe TODOS os testes existentes como estão — eles vão quebrar até a Task 3.
// se algum caso não conseguir sequer compilar depois do schema mudar, dê skip via
// `.skip` na descrição — a Task 3 vai reativar e reescrever.)
```

E em `tests/pdf.test.ts`, atualizar o único fixture:

```typescript
const templateWithBands = (): TemplateInput =>
  TemplateInputSchema.parse({
    name: 'Contrato',
    page: {
      format: 'A4',
      orientation: 'portrait',
      margins: { top: 32, right: 20, bottom: 25, left: 20 },
    },
    header: {
      heightMm: 22,
      elements: [
        { type: 'image', assetId: 'ast_logo', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        { type: 'text', value: 'ACME LOGISTICA', align: 'center', xOffsetMm: 0, yMm: 0 },
      ],
    },
    footer: {
      heightMm: 15,
      elements: [
        { type: 'text', value: 'Confidencial', align: 'left', xOffsetMm: 0, yMm: 0 },
        // ... (preserve o restante conforme já existia, adicionando os 3 campos de posição em cada elemento)
      ],
    },
  });
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm test -- template-schema`
Expected: FAIL — o schema atual ainda tem `zones`, então quase todos os testes falham no parse.

- [ ] **Step 3: Implementar o schema novo**

Reescrever `src/domain/template.ts` substituindo `ZONE_NAMES`, `BandSchema` e o export de tipos:

```typescript
import { z } from 'zod';

export const BAND_MARGIN_SLACK_MM = 5;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'cor precisa ser hexadecimal, ex.: #444 ou #444444');

const fontSizePt = z.number().min(4).max(72);

const commonTextProps = {
  bold: z.boolean().default(false),
  fontSizePt: fontSizePt.default(9),
  color: hexColor.default('#444'),
};

/** Posição do elemento dentro da faixa. `xOffsetMm` positivo sempre puxa para
 *  dentro da folha (para longe da borda de âncora em left/right; para a direita
 *  em center). `yMm` é a distância do topo da faixa. */
const positionProps = {
  align: z.enum(['left', 'center', 'right']).default('left'),
  xOffsetMm: z.number().min(-200).max(200).default(0),
  yMm: z.number().min(0).max(60).default(0),
};

export const ElementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    assetId: z.string().min(1, 'escolha uma imagem para este elemento'),
    heightMm: z.number().min(1).max(40).default(12),
    ...positionProps,
  }),
  z.object({
    type: z.literal('text'),
    value: z.string().default(''),
    ...commonTextProps,
    ...positionProps,
  }),
  z.object({
    type: z.literal('pageNumber'),
    format: z.string().default('{page} / {total}'),
    ...commonTextProps,
    ...positionProps,
  }),
  z.object({
    type: z.literal('date'),
    format: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy HH:mm']).default('dd/MM/yyyy'),
    ...commonTextProps,
    ...positionProps,
  }),
]);

export const BandSchema = z.object({
  heightMm: z.number().min(0).max(60),
  elements: z.array(ElementSchema).default([]),
});

export const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
} as const;

const PageSchema = z.object({
  format: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z.object({
    top: z.number().min(0).max(100),
    right: z.number().min(0).max(100),
    bottom: z.number().min(0).max(100),
    left: z.number().min(0).max(100),
  }),
});

const BodySchema = z.object({
  fontFamily: z.string().default("system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"),
  fontSizePt: fontSizePt.default(11),
  color: hexColor.default('#111111'),
  lineHeight: z.number().min(1).max(3).default(1.5),
});

const baseTemplateShape = {
  name: z.string().trim().min(1, 'nome é obrigatório').max(120),
  page: PageSchema,
  header: BandSchema,
  footer: BandSchema,
  body: BodySchema.prefault({}),
};

const TemplateInputBase = z.object(baseTemplateShape);
type TemplateBase = z.output<typeof TemplateInputBase>;
type TemplateElementParsed = z.infer<typeof ElementSchema>;

function checkBandFits(
  bandHeightMm: number,
  marginMm: number,
  marginPath: 'top' | 'bottom',
  ctx: z.RefinementCtx,
) {
  if (bandHeightMm <= 0) return;
  const required = bandHeightMm + BAND_MARGIN_SLACK_MM;
  if (marginMm < required) {
    ctx.addIssue({
      code: 'custom',
      path: ['page', 'margins', marginPath],
      message: `margem ${marginPath === 'top' ? 'superior' : 'inferior'} precisa ser de pelo menos ${required}mm para caber a faixa de ${bandHeightMm}mm`,
    });
  }
}

/** Altura estimada em mm do elemento, para checar overflow vertical. Texto
 *  usa fontSizePt × 0.353 (pt→mm) × 1.2 (line-height). Imagem tem heightMm. */
function estimatedElementHeightMm(el: TemplateElementParsed): number {
  if (el.type === 'image') return el.heightMm;
  return el.fontSizePt * 0.353 * 1.2;
}

function checkElementsFit(
  band: TemplateBase['header'],
  bandKey: 'header' | 'footer',
  ctx: z.RefinementCtx,
) {
  band.elements.forEach((el, i) => {
    const h = estimatedElementHeightMm(el);
    if (el.yMm + h > band.heightMm + 0.001) {
      ctx.addIssue({
        code: 'custom',
        path: [bandKey, 'elements', i, 'yMm'],
        message: `elemento não cabe na faixa: yMm (${el.yMm}) + altura (${h.toFixed(1)}) excede ${band.heightMm}mm`,
      });
    }
  });
}

function checkBands(t: TemplateBase, ctx: z.RefinementCtx): void {
  checkBandFits(t.header.heightMm, t.page.margins.top, 'top', ctx);
  checkBandFits(t.footer.heightMm, t.page.margins.bottom, 'bottom', ctx);
  checkElementsFit(t.header, 'header', ctx);
  checkElementsFit(t.footer, 'footer', ctx);
}

export const TemplateInputSchema = TemplateInputBase.superRefine(checkBands);

export const TemplateSchema = TemplateInputBase.extend({
  id: z.string().min(1),
  version: z.literal(1).default(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).superRefine(checkBands);

export type TemplateElement = z.infer<typeof ElementSchema>;
export type TemplateBand = z.infer<typeof BandSchema>;
export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export type TemplateInputRaw = z.input<typeof TemplateInputSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateSummary = Pick<Template, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

export function makeBlankTemplateInput(name = 'Novo template'): TemplateInput {
  return TemplateInputSchema.parse({
    name,
    page: {
      format: 'A4',
      orientation: 'portrait',
      margins: { top: 30, right: 20, bottom: 25, left: 20 },
    },
    header: { heightMm: 20, elements: [] },
    footer: {
      heightMm: 15,
      elements: [
        { type: 'pageNumber', format: '{page} / {total}', align: 'right', xOffsetMm: 0, yMm: 0 },
      ],
    },
    body: {},
  });
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function applyVariables(text: string, variables: Record<string, string> | undefined): string {
  return text.replace(PLACEHOLDER, (_match, key: string) => variables?.[key] ?? '');
}
```

- [ ] **Step 4: Rodar os testes do schema e ver passar**

Run: `npm test -- template-schema`
Expected: PASS (todos os testes de `template-schema.test.ts`).
Os testes de `template-render.test.ts` e `pdf.test.ts` **vão continuar quebrados** — isso é esperado; a Task 3 os conserta. Rode só o alvo do schema aqui.

- [ ] **Step 5: Type-check completo**

Run: `npx tsc --noEmit -p .`
Expected: apenas erros vindos de `src/render/template.ts` (usa `ZONE_NAMES` e `band.zones`) e do frontend/tests que ainda não migraram. Não pode haver erro em `src/domain/template.ts` ou em `tests/template-schema.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/domain/template.ts tests/template-schema.test.ts tests/template-render.test.ts tests/pdf.test.ts
git commit -m "Schema: elemento com âncora + offset, faixa com elements[]"
```

---

## Task 2: Migração `zones → elements` (função pura + hook no repo)

**Files:**
- Create: `src/domain/templateMigration.ts`
- Create: `tests/template-migration.test.ts`
- Modify: `src/storage/templateRepo.ts`
- Modify: `tests/storage.test.ts` (adiciona um teste de leitura de JSON no formato antigo)

**Interfaces consumidas:**
- `TemplateSchema` (Task 1).

**Interfaces produzidas:**
- `migrateTemplateJson(raw: unknown): { data: unknown; changed: boolean }` — se `raw.header.zones` ou `raw.footer.zones` existir, produz `{ header, footer }` com `elements` no lugar. Preserva id/timestamps/name/page/body. Se nada mudar, retorna `{ data: raw, changed: false }` para o repo evitar reescrita.

- [ ] **Step 1: Escrever teste RED para a função de migração**

Criar `tests/template-migration.test.ts`:

```typescript
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

  it('preserva id, timestamps, name, page, body', () => {
    const { data } = migrateTemplateJson(legacy());
    const t = data as any;
    expect(t.id).toBe('tpl_x');
    expect(t.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(t.name).toBe('T');
    expect(t.page.margins.top).toBe(30);
    expect(t.body.fontSizePt).toBe(11);
  });

  it('é idempotente: JSON já no formato novo passa direto', () => {
    const modern = {
      id: 'tpl_y',
      name: 'M',
      header: { heightMm: 20, elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }] },
      footer: { heightMm: 0, elements: [] },
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
      name: 'P',
      header: { heightMm: 20, zones: { left: [], center: [], right: [{ type: 'text', value: 'D' }] } },
      footer: { heightMm: 0, elements: [] },
    } as any;
    const { data, changed } = migrateTemplateJson(partial);
    expect(changed).toBe(true);
    const t = data as any;
    expect(t.header.elements[0]).toMatchObject({ type: 'text', align: 'right' });
    expect(t.footer.elements).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test -- template-migration`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar a função de migração**

Criar `src/domain/templateMigration.ts`:

```typescript
/**
 * Migração de template do formato antigo (`band.zones.{left,center,right}`)
 * para o novo (`band.elements[]` com âncora + offset).
 *
 * Isolada do schema Zod: recebe JSON cru, devolve JSON cru. O repo aplica
 * antes de validar contra o `TemplateSchema` — assim o schema não precisa
 * conhecer o formato antigo.
 */

type LegacyBand = {
  heightMm: number;
  zones: {
    left?: unknown[];
    center?: unknown[];
    right?: unknown[];
  };
};

type MigratedBand = {
  heightMm: number;
  elements: unknown[];
};

const ANCHORS: Array<{ key: 'left' | 'center' | 'right' }> = [
  { key: 'left' },
  { key: 'center' },
  { key: 'right' },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bandNeedsMigration(band: unknown): band is LegacyBand {
  return isObject(band) && 'zones' in band && isObject(band.zones);
}

function migrateBand(band: LegacyBand): MigratedBand {
  const elements: unknown[] = [];
  for (const { key } of ANCHORS) {
    const zone = band.zones[key];
    if (!Array.isArray(zone)) continue;
    for (const el of zone) {
      if (!isObject(el)) continue;
      elements.push({ ...el, align: key, xOffsetMm: 0, yMm: 0 });
    }
  }
  return { heightMm: band.heightMm, elements };
}

export function migrateTemplateJson(raw: unknown): { data: unknown; changed: boolean } {
  if (!isObject(raw)) return { data: raw, changed: false };

  const headerLegacy = bandNeedsMigration(raw.header);
  const footerLegacy = bandNeedsMigration(raw.footer);
  if (!headerLegacy && !footerLegacy) return { data: raw, changed: false };

  const next: Record<string, unknown> = { ...raw };
  if (headerLegacy) next.header = migrateBand(raw.header as LegacyBand);
  if (footerLegacy) next.footer = migrateBand(raw.footer as LegacyBand);
  return { data: next, changed: true };
}
```

- [ ] **Step 4: Rodar os testes de migração e ver passar**

Run: `npm test -- template-migration`
Expected: PASS.

- [ ] **Step 5: Hook no repo — RED**

Adicionar em `tests/storage.test.ts`, dentro do `describe('templateRepo', ...)`, o teste abaixo:

```typescript
it('migra JSON legado no formato de zones para elements na leitura', async () => {
  const legacyId = 'tpl_legacy00000';
  const legacyPath = path.join(dir, `${legacyId}.json`);
  const legacyJson = JSON.stringify({
    id: legacyId,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    name: 'Legado',
    page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
    header: {
      heightMm: 20,
      zones: {
        left: [],
        center: [],
        right: [{ type: 'text', value: 'legado', bold: false, fontSizePt: 9, color: '#444' }],
      },
    },
    footer: { heightMm: 0, zones: { left: [], center: [], right: [] } },
    body: {
      fontFamily: 'system-ui',
      fontSizePt: 11,
      color: '#111111',
      lineHeight: 1.5,
    },
  });
  await fs.writeFile(legacyPath, legacyJson, 'utf8');

  const repo = createTemplateRepo(dir);
  const loaded = await repo.get(legacyId);
  expect(loaded).not.toBeNull();
  expect(loaded!.header.elements).toHaveLength(1);
  expect(loaded!.header.elements[0]).toMatchObject({ type: 'text', align: 'right' });

  // self-healing: o arquivo em disco foi reescrito no formato novo
  const disk = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
  expect(disk.header.zones).toBeUndefined();
  expect(disk.header.elements).toHaveLength(1);
});
```

- [ ] **Step 6: Rodar o teste e ver falhar**

Run: `npm test -- storage`
Expected: FAIL — o repo ainda não conhece a migração.

- [ ] **Step 7: Ligar a migração no repo**

Editar `src/storage/templateRepo.ts` — importar `migrateTemplateJson` e chamar antes do `parse` em `get` e `list`. Também gravar de volta se migrou. Substituir o corpo por:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  TemplateSchema,
  type Template,
  type TemplateInput,
  type TemplateSummary,
} from '../domain/template.js';
import { migrateTemplateJson } from '../domain/templateMigration.js';
import { assertSafeId, readJsonIfExists, removeIfExists, writeFileAtomic } from './fsUtil.js';

export interface TemplateRepo {
  create(input: TemplateInput): Promise<Template>;
  get(id: string): Promise<Template | null>;
  list(): Promise<TemplateSummary[]>;
  update(id: string, input: TemplateInput): Promise<Template | null>;
  remove(id: string): Promise<boolean>;
}

export function createTemplateRepo(dir: string): TemplateRepo {
  const fileOf = (id: string) => {
    assertSafeId(id, 'tpl');
    return path.join(dir, `${id}.json`);
  };

  async function save(template: Template): Promise<Template> {
    const validated = TemplateSchema.parse(template);
    await writeFileAtomic(fileOf(validated.id), JSON.stringify(validated, null, 2));
    return validated;
  }

  /** Lê o arquivo, migra se preciso, valida, e grava de volta se a migração
   *  mudou algo — assim o disco converge para o formato novo na primeira leitura. */
  async function readAndMigrate(file: string): Promise<Template | null> {
    const raw = await readJsonIfExists<unknown>(file);
    if (raw === null) return null;
    const { data, changed } = migrateTemplateJson(raw);
    const validated = TemplateSchema.parse(data);
    if (changed) {
      await writeFileAtomic(file, JSON.stringify(validated, null, 2));
    }
    return validated;
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      return save({ ...input, id: `tpl_${nanoid(12)}`, version: 1, createdAt: now, updatedAt: now });
    },

    async get(id) {
      return readAndMigrate(fileOf(id));
    },

    async list() {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }

      const summaries: TemplateSummary[] = [];
      for (const entry of entries) {
        if (!entry.startsWith('tpl_') || !entry.endsWith('.json')) continue;
        try {
          const template = await readAndMigrate(path.join(dir, entry));
          if (!template) continue;
          const { id, name, createdAt, updatedAt } = template;
          summaries.push({ id, name, createdAt, updatedAt });
        } catch {
          continue;
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async update(id, input) {
      const existing = await this.get(id);
      if (!existing) return null;
      return save({
        ...input,
        id: existing.id,
        version: 1,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
    },

    async remove(id) {
      return removeIfExists(fileOf(id));
    },
  };
}
```

- [ ] **Step 8: Rodar os testes de storage e ver passar**

Run: `npm test -- storage template-migration`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/templateMigration.ts src/storage/templateRepo.ts tests/template-migration.test.ts tests/storage.test.ts
git commit -m "Storage: migração self-healing de zones para elements"
```

---

## Task 3: Renderer — `elementPosition` + `bandHtml` absoluto

**Files:**
- Modify: `src/render/template.ts`
- Modify: `tests/template-render.test.ts` (todos os testes agora com fixtures novos)

**Interfaces consumidas:**
- `TemplateElement` com `align`/`xOffsetMm`/`yMm` (Task 1).

**Interfaces produzidas:**
- `elementPosition(el: Pick<TemplateElement, 'align'|'xOffsetMm'|'yMm'>): { top: string; left?: string; right?: string; transform?: string }` — função pura exportada, consumida também pelo editor.
- `bandHtml` continua interno, mas agora emite elementos absolutamente posicionados.
- `zoneHtml` e `ZONE_ALIGN` **removidos**.

- [ ] **Step 1: Reescrever `tests/template-render.test.ts` com o novo shape (RED)**

Substituir o arquivo inteiro:

```typescript
import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  buildDocumentHtml,
  MissingAssetError,
  elementPosition,
} from '../src/render/template.js';
import {
  TemplateInputSchema,
  makeBlankTemplateInput,
  type TemplateInput,
  type TemplateInputRaw,
} from '../src/domain/template.js';

const DATA_URI = 'data:image/png;base64,AAAB';

function templateWith(over: Partial<TemplateInputRaw> = {}): TemplateInput {
  return TemplateInputSchema.parse({ ...makeBlankTemplateInput('T'), ...over });
}

describe('elementPosition', () => {
  it('align=left aplica left e sem transform', () => {
    expect(elementPosition({ align: 'left', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      left: '0mm',
    });
    expect(elementPosition({ align: 'left', xOffsetMm: 5, yMm: 3 })).toEqual({
      top: '3mm',
      left: '5mm',
    });
  });

  it('align=right aplica right, e offset positivo afasta da borda', () => {
    expect(elementPosition({ align: 'right', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      right: '0mm',
    });
    expect(elementPosition({ align: 'right', xOffsetMm: 5, yMm: 0 })).toEqual({
      top: '0mm',
      right: '5mm',
    });
  });

  it('align=center usa calc(50% + offset) com translateX(-50%)', () => {
    expect(elementPosition({ align: 'center', xOffsetMm: 0, yMm: 0 })).toEqual({
      top: '0mm',
      left: 'calc(50% + 0mm)',
      transform: 'translateX(-50%)',
    });
    expect(elementPosition({ align: 'center', xOffsetMm: -4, yMm: 2 })).toEqual({
      top: '2mm',
      left: 'calc(50% + -4mm)',
      transform: 'translateX(-50%)',
    });
  });
});

describe('renderTemplate — header/footer', () => {
  it('todo texto carrega font-size explícito (o Chromium usa 0 por padrão)', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'ACME', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toContain('ACME');
    expect(headerHtml).toMatch(/font-size:\s*9pt/);
  });

  it('emite CSS de posição correto para cada âncora', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: 'ESQ', align: 'left', xOffsetMm: 0, yMm: 0 },
          { type: 'text', value: 'MEIO', align: 'center', xOffsetMm: 0, yMm: 0 },
          { type: 'text', value: 'DIR', align: 'right', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t);
    // ordem no HTML segue ordem no array (a posição visual sai do CSS)
    expect(headerHtml.indexOf('ESQ')).toBeLessThan(headerHtml.indexOf('MEIO'));
    expect(headerHtml.indexOf('MEIO')).toBeLessThan(headerHtml.indexOf('DIR'));
    expect(headerHtml).toContain('position: absolute');
    expect(headerHtml).toMatch(/left:\s*0mm[^;]*;[^>]*>[^<]*ESQ/);
    expect(headerHtml).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(headerHtml).toMatch(/right:\s*0mm/);
  });

  it('respeita xOffsetMm e yMm no CSS emitido', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: 'A', align: 'left', xOffsetMm: 7, yMm: 4 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/top:\s*4mm/);
    expect(headerHtml).toMatch(/left:\s*7mm/);
  });

  it('usa as classes mágicas do Chromium para a paginação', () => {
    const t = templateWith({
      footer: {
        heightMm: 15,
        elements: [
          { type: 'pageNumber', format: 'Página {page} de {total}', align: 'right', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { footerHtml } = renderTemplate(t);
    expect(footerHtml).toContain('<span class="pageNumber"></span>');
    expect(footerHtml).toContain('<span class="totalPages"></span>');
  });

  it('embute a imagem como data URI, nunca como URL', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_logo', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { assets: { ast_logo: DATA_URI } });
    expect(headerHtml).toContain(`src="${DATA_URI}"`);
    expect(headerHtml).toMatch(/height:\s*12mm/);
  });

  it('falha explicitamente quando o asset referenciado sumiu', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_sumiu', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    expect(() => renderTemplate(t, { assets: {} })).toThrow(MissingAssetError);
  });

  it('desenha um espaço reservado quando o editor pede placeholder', () => {
    const base = templateWith();
    const t: TemplateInput = {
      ...base,
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: '', heightMm: 12, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    };
    const { headerHtml } = renderTemplate(t, { assets: {}, missingAsset: 'placeholder' });
    expect(headerHtml).toContain('escolha uma imagem');
    expect(headerHtml).not.toContain('<img');
  });

  it('resolve {{variaveis}} nos textos', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: 'Cliente: {{cliente}}', align: 'center', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { variables: { cliente: 'ACME S/A' } });
    expect(headerHtml).toContain('Cliente: ACME S/A');
  });

  it('escapa HTML vindo de texto e de variável', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [
          { type: 'text', value: '{{x}}', align: 'center', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const { headerHtml } = renderTemplate(t, { variables: { x: '<img src=x onerror=alert(1)>' } });
    expect(headerHtml).not.toContain('<img src=x');
    expect(headerHtml).toContain('&lt;img');
  });

  it('formata a data conforme o template', () => {
    const now = new Date('2026-08-18T15:04:00.000Z');
    const build = (format: 'dd/MM/yyyy' | 'yyyy-MM-dd') =>
      renderTemplate(
        templateWith({
          footer: {
            heightMm: 15,
            elements: [{ type: 'date', format, align: 'left', xOffsetMm: 0, yMm: 0 }],
          },
        }),
        { now, timeZone: 'UTC' },
      ).footerHtml;
    expect(build('dd/MM/yyyy')).toContain('18/08/2026');
    expect(build('yyyy-MM-dd')).toContain('2026-08-18');
  });

  it('mantém o padding lateral alinhado com as margens da página', () => {
    const t = templateWith({
      page: { format: 'A4', orientation: 'portrait', margins: { top: 30, right: 25, bottom: 25, left: 18 } },
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/padding:\s*0\s+25mm\s+0\s+18mm/);
  });

  it('emite a faixa com position: relative para servir de contexto absoluto', () => {
    const t = templateWith({
      header: {
        heightMm: 20,
        elements: [{ type: 'text', value: 'x', align: 'left', xOffsetMm: 0, yMm: 0 }],
      },
    });
    const { headerHtml } = renderTemplate(t);
    expect(headerHtml).toMatch(/position:\s*relative/);
  });
});

describe('renderTemplate — pdfOptions', () => {
  it('traduz formato, orientação e margens', () => {
    const t = templateWith({
      page: { format: 'Letter', orientation: 'landscape', margins: { top: 30, right: 20, bottom: 25, left: 20 } },
    });
    const { pdfOptions } = renderTemplate(t);
    expect(pdfOptions.format).toBe('Letter');
    expect(pdfOptions.landscape).toBe(true);
    expect(pdfOptions.margin).toEqual({ top: '30mm', right: '20mm', bottom: '25mm', left: '20mm' });
    expect(pdfOptions.printBackground).toBe(true);
  });

  it('desliga header/footer quando as duas faixas estão vazias', () => {
    const t = templateWith({
      header: { heightMm: 0, elements: [] },
      footer: { heightMm: 0, elements: [] },
      page: { format: 'A4', orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 } },
    });
    expect(renderTemplate(t).pdfOptions.displayHeaderFooter).toBe(false);
  });

  it('liga header/footer quando há qualquer elemento', () => {
    expect(renderTemplate(templateWith()).pdfOptions.displayHeaderFooter).toBe(true);
  });
});

describe('renderTemplate — css', () => {
  it('declara as regras de quebra de página', () => {
    const { css } = renderTemplate(templateWith());
    expect(css).toMatch(/\.page-break\s*\{[^}]*break-after:\s*page/);
    expect(css).toMatch(/break-after:\s*avoid/);
    expect(css).toMatch(/break-inside:\s*avoid/);
    expect(css).toMatch(/thead\s*\{[^}]*table-header-group/);
  });

  it('aplica a tipografia do corpo', () => {
    const { css } = renderTemplate(templateWith({ body: { fontFamily: 'Georgia', fontSizePt: 13, color: '#222222', lineHeight: 1.7 } }));
    expect(css).toContain('Georgia');
    expect(css).toContain('13pt');
    expect(css).toContain('#222222');
    expect(css).toContain('1.7');
  });
});

describe('buildDocumentHtml', () => {
  it('monta um documento completo com o css e o corpo', () => {
    const { css } = renderTemplate(templateWith());
    const html = buildDocumentHtml({ css, bodyHtml: '<h1>Oi</h1>' });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<h1>Oi</h1>');
    expect(html).toContain(css);
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm test -- template-render`
Expected: FAIL — `elementPosition` não existe, e `bandHtml` ainda usa `zones`.

- [ ] **Step 3: Reescrever `src/render/template.ts`**

Substituir o arquivo inteiro:

```typescript
import {
  applyVariables,
  type Template,
  type TemplateBand,
  type TemplateElement,
  type TemplateInput,
} from '../domain/template.js';

export interface PdfOptions {
  format: 'A4' | 'Letter';
  landscape: boolean;
  printBackground: boolean;
  displayHeaderFooter: boolean;
  margin: { top: string; right: string; bottom: string; left: string };
}

export interface RenderedTemplate {
  headerHtml: string;
  footerHtml: string;
  css: string;
  pdfOptions: PdfOptions;
}

export interface RenderTemplateOptions {
  variables?: Record<string, string>;
  assets?: Record<string, string>;
  now?: Date;
  timeZone?: string;
  missingAsset?: 'throw' | 'placeholder';
}

export class MissingAssetError extends Error {
  readonly statusCode = 422;
  constructor(readonly assetId: string) {
    super(`asset não encontrado: ${assetId}`);
    this.name = 'MissingAssetError';
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

function formatDate(format: string, now: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const dd = get('day');
  const MM = get('month');
  const yyyy = get('year');
  const HH = get('hour');
  const mm = get('minute');

  switch (format) {
    case 'yyyy-MM-dd':
      return `${yyyy}-${MM}-${dd}`;
    case 'dd/MM/yyyy HH:mm':
      return `${dd}/${MM}/${yyyy} ${HH}:${mm}`;
    default:
      return `${dd}/${MM}/${yyyy}`;
  }
}

function pageNumberHtml(format: string): string {
  return escapeHtml(format)
    .replace(/\{page\}/g, '<span class="pageNumber"></span>')
    .replace(/\{total\}/g, '<span class="totalPages"></span>');
}

function textStyle(el: Extract<TemplateElement, { fontSizePt: number }>): string {
  return [
    `font-size: ${el.fontSizePt}pt`,
    `color: ${el.color}`,
    `font-weight: ${el.bold ? 700 : 400}`,
    'white-space: pre-wrap',
  ].join('; ');
}

/** CSS de posicionamento derivado da âncora e do offset — função pura,
 *  também consumida pelo editor no browser (via alias @shared). */
export function elementPosition(
  el: Pick<TemplateElement, 'align' | 'xOffsetMm' | 'yMm'>,
): { top: string; left?: string; right?: string; transform?: string } {
  const top = `${el.yMm}mm`;
  switch (el.align) {
    case 'left':
      return { top, left: `${el.xOffsetMm}mm` };
    case 'right':
      return { top, right: `${el.xOffsetMm}mm` };
    case 'center':
      return {
        top,
        left: `calc(50% + ${el.xOffsetMm}mm)`,
        transform: 'translateX(-50%)',
      };
  }
}

function positionInlineStyle(el: TemplateElement): string {
  const pos = elementPosition(el);
  const parts = [`top: ${pos.top}`];
  if (pos.left) parts.push(`left: ${pos.left}`);
  if (pos.right) parts.push(`right: ${pos.right}`);
  if (pos.transform) parts.push(`transform: ${pos.transform}`);
  return parts.join('; ');
}

function elementInnerHtml(el: TemplateElement, opts: RenderTemplateOptions): string {
  switch (el.type) {
    case 'image': {
      const dataUri = el.assetId ? opts.assets?.[el.assetId] : undefined;
      if (!dataUri) {
        if (opts.missingAsset !== 'placeholder') throw new MissingAssetError(el.assetId);
        return `<span style="display: inline-flex; align-items: center; justify-content: center; height: ${el.heightMm}mm; min-width: ${el.heightMm * 2.4}mm; border: 1px dashed #9aa5ad; border-radius: 1mm; color: #8b98a1; font-size: 6pt; letter-spacing: 0.08em; text-transform: uppercase;">escolha uma imagem</span>`;
      }
      return `<img src="${escapeHtml(dataUri)}" style="height: ${el.heightMm}mm; width: auto; display: block;" alt="">`;
    }
    case 'text':
      return `<span style="${textStyle(el)}">${escapeHtml(applyVariables(el.value, opts.variables))}</span>`;
    case 'pageNumber':
      return `<span style="${textStyle(el)}">${pageNumberHtml(el.format)}</span>`;
    case 'date':
      return `<span style="${textStyle(el)}">${escapeHtml(formatDate(el.format, opts.now ?? new Date(), opts.timeZone))}</span>`;
  }
}

function elementHtml(el: TemplateElement, opts: RenderTemplateOptions): string {
  const wrapperStyle = `position: absolute; ${positionInlineStyle(el)};`;
  return `<div style="${wrapperStyle}">${elementInnerHtml(el, opts)}</div>`;
}

function bandHtml(
  band: TemplateBand,
  template: TemplateInput,
  opts: RenderTemplateOptions,
): string {
  const { margins } = template.page;
  const bandStyle = [
    'position: relative',
    'box-sizing: border-box',
    'width: 100%',
    `height: ${band.heightMm}mm`,
    `padding: 0 ${margins.right}mm 0 ${margins.left}mm`,
    `font-family: ${template.body.fontFamily}`,
    'font-size: 9pt',
    'line-height: 1.2',
    '-webkit-print-color-adjust: exact',
    'print-color-adjust: exact',
  ].join('; ');

  const inner = band.elements.map((el) => elementHtml(el, opts)).join('');
  return `<div style="${bandStyle}"><div style="position: absolute; inset: 0 ${margins.right}mm 0 ${margins.left}mm;">${inner}</div></div>`;
}

function bandIsEmpty(band: TemplateBand): boolean {
  return band.elements.length === 0;
}

function buildCss(template: TemplateInput): string {
  const { body } = template;
  const codeSizePt = Math.max(7, body.fontSizePt - 2);
  return `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${body.fontFamily};
  font-size: ${body.fontSizePt}pt;
  color: ${body.color};
  line-height: ${body.lineHeight};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page-break { break-after: page; }

h1, h2, h3, h4, h5, h6 { break-after: avoid; margin: 1.2em 0 0.5em; line-height: 1.25; }
h1:first-child, h2:first-child { margin-top: 0; }

table, img, pre, blockquote, figure { break-inside: avoid; }
tr { break-inside: avoid; }
thead { display: table-header-group; }

p, ul, ol { margin: 0 0 0.8em; }
li { margin-bottom: 0.25em; }
img { max-width: 100%; height: auto; }
a { color: #0b5cad; text-decoration: none; }

table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
th, td { border: 1px solid #d8d8d8; padding: 5pt 7pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 600; }

pre {
  background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 3pt;
  padding: 7pt; white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: ${codeSizePt}pt;
}
code { font-family: Consolas, 'Courier New', monospace; font-size: 0.92em; }
pre code { font-size: inherit; }
blockquote { margin: 0 0 1em; padding-left: 10pt; border-left: 2pt solid #d8d8d8; color: #555; }
hr { border: none; border-top: 1px solid #d8d8d8; margin: 1.2em 0; }
`.trim();
}

export function renderTemplate(
  template: TemplateInput | Template,
  opts: RenderTemplateOptions = {},
): RenderedTemplate {
  const { page, header, footer } = template;
  return {
    headerHtml: bandHtml(header, template, opts),
    footerHtml: bandHtml(footer, template, opts),
    css: buildCss(template),
    pdfOptions: {
      format: page.format,
      landscape: page.orientation === 'landscape',
      printBackground: true,
      displayHeaderFooter: !(bandIsEmpty(header) && bandIsEmpty(footer)),
      margin: {
        top: `${page.margins.top}mm`,
        right: `${page.margins.right}mm`,
        bottom: `${page.margins.bottom}mm`,
        left: `${page.margins.left}mm`,
      },
    },
  };
}

export function buildDocumentHtml({
  css,
  bodyHtml,
}: {
  css: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
```

Nota sobre a estrutura da faixa: envolvi os elementos num container interno com `inset: 0 <margin>mm` para que os elementos posicionados absolutamente respeitem o padding lateral da faixa (senão `left: 0mm` ficaria na borda esquerda da página, não na margem). Isso preserva o comportamento existente onde "elemento na esquerda" fica exatamente na margem esquerda.

- [ ] **Step 4: Rodar todos os testes de renderer e ver passar**

Run: `npm test -- template-render`
Expected: PASS.

- [ ] **Step 5: Rodar o PDF end-to-end para validar o Chromium**

Run: `npm test -- pdf`
Expected: PASS. Este é o momento em que descobrimos se `transform: translateX(-50%)` embaça texto centralizado no Chromium. Se algum teste do PDF que verifica conteúdo centralizado falhar por texto ausente/borrado (`Contain('ACME LOGISTICA')` etc), abrir o PDF gerado manualmente (`node -e "..."` para escrever `out.pdf`) e inspecionar. **Se ficar borrado**, aplicar o fallback: calcular a largura estimada do texto e usar `left: <bandUsableWidth/2 - estimatedWidth/2>mm` sem transform. Como isso exigiria estimar largura de texto (imprecisa), documentar no commit e voltar para brainstorming — não implemente esse fallback nesta task sem alinhamento.

- [ ] **Step 6: Rodar toda a suíte (agora esperamos tudo verde exceto o frontend)**

Run: `npm test`
Expected: PASS. Api/storage devem estar OK porque usam `makeBlankTemplateInput` que já foi atualizado.

- [ ] **Step 7: Commit**

```bash
git add src/render/template.ts tests/template-render.test.ts
git commit -m "Renderer: elementos absolutamente posicionados por âncora + offset"
```

---

## Task 4: Frontend — `templateModel.ts` (Selection novo + helpers)

**Files:**
- Modify: `web/src/lib/templateModel.ts`

**Interfaces consumidas:**
- `TemplateElement`, `ElementSchema`, `BandSchema` do backend via `@shared` (Task 1).

**Interfaces produzidas:**
- `type Selection = { band: BandName; index: number | null } | null` — `index: null` = a faixa está selecionada mas nenhum elemento específico.
- `updateBand(template, band, updater)` (substitui `updateZone`).
- `replaceElement(template, sel: { band, index }, next)` — assume `index != null`.
- `makeElement(type)` retorna elemento com defaults de posição (`align='left', xOffsetMm=0, yMm=0`).
- `collectAssetIds` percorre `band.elements`.
- `applyDragDelta(el, dxScreenMm, dyMm, bandUsableWidthMm): TemplateElement` — aplica delta com snap para âncoras.
- Constantes `SNAP_ANCHOR_MM = 2`, `SNAP_EDGE_MM = 1`, `NUDGE_MM = 1`, `NUDGE_FINE_MM = 0.25`.
- Exports removidos: `ZONE_LABEL`, `Selection` antigo, `updateZone`.

- [ ] **Step 1: Reescrever `web/src/lib/templateModel.ts`**

Substituir o arquivo inteiro:

```typescript
import {
  BAND_MARGIN_SLACK_MM,
  ElementSchema,
  PAGE_SIZES_MM,
  type Template,
  type TemplateElement,
  type TemplateInput,
} from '@shared/domain/template.js';

export type BandName = 'header' | 'footer';

/** Seleção corrente do editor. `index: null` significa "faixa selecionada,
 *  nenhum elemento em foco" — abre a lista de elementos no inspector. */
export type Selection = { band: BandName; index: number | null } | null;

export const BAND_LABEL: Record<BandName, string> = {
  header: 'cabeçalho',
  footer: 'rodapé',
};

export const ELEMENT_LABEL: Record<TemplateElement['type'], string> = {
  image: 'imagem',
  text: 'texto',
  pageNumber: 'paginação',
  date: 'data',
};

export const SNAP_ANCHOR_MM = 2;
export const SNAP_EDGE_MM = 1;
export const NUDGE_MM = 1;
export const NUDGE_FINE_MM = 0.25;

export function sheetSizeMm(page: TemplateInput['page']) {
  const base = PAGE_SIZES_MM[page.format];
  return page.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

export function bandClashes(template: TemplateInput, band: BandName): boolean {
  const height = template[band].heightMm;
  if (height <= 0) return false;
  const margin = band === 'header' ? template.page.margins.top : template.page.margins.bottom;
  return margin < height + BAND_MARGIN_SLACK_MM;
}

export function requiredMarginMm(template: TemplateInput, band: BandName): number {
  return template[band].heightMm + BAND_MARGIN_SLACK_MM;
}

/** Área horizontal útil de uma faixa (largura da folha menos margens laterais). */
export function bandUsableWidthMm(template: TemplateInput): number {
  const { width } = sheetSizeMm(template.page);
  return Math.max(0, width - template.page.margins.left - template.page.margins.right);
}

/** Elemento novo com defaults de posição. Imagem nasce sem arquivo (o schema
 *  rejeita assetId vazio, mas o elemento existe no editor até você escolher). */
export function makeElement(type: TemplateElement['type'], assetId?: string): TemplateElement {
  const position = { align: 'left' as const, xOffsetMm: 0, yMm: 0 };
  if (type === 'image') {
    return { type, assetId: assetId ?? '', heightMm: 12, ...position };
  }
  const raw = type === 'text' ? { type, value: 'Texto', ...position } : { type, ...position };
  return ElementSchema.parse(raw);
}

export function describeElement(el: TemplateElement): string {
  switch (el.type) {
    case 'image':
      return el.assetId ? `${el.heightMm}mm de altura` : 'sem imagem';
    case 'text':
      return el.value || '(vazio)';
    case 'pageNumber':
      return el.format;
    case 'date':
      return el.format;
  }
}

export function collectAssetIds(template: TemplateInput | Template): string[] {
  const ids = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const el of band.elements) {
      if (el.type === 'image' && el.assetId) ids.add(el.assetId);
    }
  }
  return [...ids];
}

type BandUpdater = (elements: TemplateElement[]) => TemplateElement[];

export function updateBand(
  template: TemplateInput,
  band: BandName,
  update: BandUpdater,
): TemplateInput {
  return {
    ...template,
    [band]: { ...template[band], elements: update(template[band].elements) },
  };
}

export function replaceElement(
  template: TemplateInput,
  selection: { band: BandName; index: number },
  next: TemplateElement,
): TemplateInput {
  return updateBand(template, selection.band, (elements) =>
    elements.map((el, i) => (i === selection.index ? next : el)),
  );
}

/**
 * Aplica um delta de arrasto ao elemento. `dxScreenMm` é o deslocamento
 * na direção da tela (positivo = direita). Para `align='right'` o offset é
 * invertido (positivo puxa para dentro, então dragging pra direita diminui
 * o offset). Snap para as âncoras acontece dentro de `SNAP_ANCHOR_MM`.
 */
export function applyDragDelta(
  origin: TemplateElement,
  dxScreenMm: number,
  dyMm: number,
  usableWidthMm: number,
): TemplateElement {
  const dxOffsetMm = origin.align === 'right' ? -dxScreenMm : dxScreenMm;
  let align = origin.align;
  let xOffsetMm = origin.xOffsetMm + dxOffsetMm;
  const yMm = Math.max(0, origin.yMm + dyMm);

  // Posição absoluta atual do elemento na área útil (em mm a partir da esquerda).
  const absoluteXMm = anchorAbsoluteX(origin.align, origin.xOffsetMm, usableWidthMm) + dxScreenMm;
  const clamped = Math.max(0, Math.min(usableWidthMm, absoluteXMm));

  const distToLeft = clamped;
  const distToCenter = Math.abs(clamped - usableWidthMm / 2);
  const distToRight = usableWidthMm - clamped;

  if (distToLeft <= SNAP_ANCHOR_MM && distToLeft <= distToCenter && distToLeft <= distToRight) {
    align = 'left';
    xOffsetMm = 0;
  } else if (
    distToRight <= SNAP_ANCHOR_MM &&
    distToRight <= distToLeft &&
    distToRight <= distToCenter
  ) {
    align = 'right';
    xOffsetMm = 0;
  } else if (distToCenter <= SNAP_ANCHOR_MM) {
    align = 'center';
    xOffsetMm = 0;
  } else {
    // Sem snap: mantém o align original e o offset novo.
    xOffsetMm = clampOffset(align, clamped, usableWidthMm);
  }

  return { ...origin, align, xOffsetMm, yMm } as TemplateElement;
}

function anchorAbsoluteX(
  align: TemplateElement['align'],
  xOffsetMm: number,
  usableWidthMm: number,
): number {
  switch (align) {
    case 'left':
      return xOffsetMm;
    case 'right':
      return usableWidthMm - xOffsetMm;
    case 'center':
      return usableWidthMm / 2 + xOffsetMm;
  }
}

function clampOffset(
  align: TemplateElement['align'],
  absoluteXMm: number,
  usableWidthMm: number,
): number {
  switch (align) {
    case 'left':
      return absoluteXMm;
    case 'right':
      return usableWidthMm - absoluteXMm;
    case 'center':
      return absoluteXMm - usableWidthMm / 2;
  }
}
```

- [ ] **Step 2: Type-check do frontend**

Run: `cd web && npx tsc --noEmit -p .`
Expected: erros só em `Sheet.tsx`, `Inspector.tsx`, `TemplateEditor.tsx` (que ainda referenciam `ZONE_LABEL`, `updateZone`, etc). Nenhum erro em `templateModel.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/templateModel.ts
git commit -m "Editor: modelo de seleção plano, sem zones; drag delta com snap"
```

---

## Task 5: `Sheet.tsx` — elementos como handles + seleção (sem drag ainda)

**Files:**
- Modify: `web/src/components/Sheet.tsx`

**Interfaces consumidas:**
- `Selection`, `BandName`, `bandClashes`, `sheetSizeMm`, `BAND_LABEL` (Task 4).
- `elementPosition` do renderer via `@shared/render/template.js` (Task 3).

**Interfaces produzidas:**
- `<Sheet>` continua com a mesma prop signature, mas o `Selection` é o novo.
- Cada elemento renderiza um handle transparente sobre o HTML gerado pelo renderer, com click → `onSelect({ band, index })`.
- Click no fundo da faixa (não em elemento) → `onSelect({ band, index: null })`.

- [ ] **Step 1: Reescrever `web/src/components/Sheet.tsx`**

Substituir o arquivo inteiro:

```tsx
import type { TemplateInput, TemplateElement } from '@shared/domain/template.js';
import { renderTemplate, elementPosition } from '@shared/render/template.js';
import { mm, useFitScale } from '../hooks/useFitScale.js';
import {
  bandClashes,
  BAND_LABEL,
  sheetSizeMm,
  type BandName,
  type Selection,
} from '../lib/templateModel.js';

interface SheetProps {
  template: TemplateInput;
  assets: Record<string, string>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

function Rulers({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  const ticks = (total: number) =>
    Array.from({ length: Math.floor(total / 10) + 1 }, (_, i) => i * 10);
  return (
    <>
      <div className="ruler ruler--top" aria-hidden="true">
        {ticks(widthMm).map((value) => (
          <span key={value}>
            <i
              className="ruler__tick"
              style={{ left: `${value}mm`, bottom: 0, width: 1, height: value % 50 === 0 ? 7 : 3 }}
            />
            {value % 50 === 0 && (
              <em className="ruler__num" style={{ left: `${value}mm`, top: 0 }}>
                {value}
              </em>
            )}
          </span>
        ))}
      </div>
      <div className="ruler ruler--left" aria-hidden="true">
        {ticks(heightMm).map((value) => (
          <i
            key={value}
            className="ruler__tick"
            style={{ top: `${value}mm`, right: 0, height: 1, width: value % 50 === 0 ? 7 : 3 }}
          />
        ))}
      </div>
    </>
  );
}

function ElementHandle({
  el,
  band,
  index,
  selected,
  onSelect,
}: {
  el: TemplateElement;
  band: BandName;
  index: number;
  selected: boolean;
  onSelect: (selection: Selection) => void;
}) {
  const pos = elementPosition(el);
  const style: React.CSSProperties = {
    position: 'absolute',
    top: pos.top,
    left: pos.left,
    right: pos.right,
    transform: pos.transform,
    // dimensões do handle: como o preview visual sai do HTML injetado pelo
    // renderer (abaixo, em .band__render), o handle é só a área clicável —
    // um pequeno "padding" ao redor da posição do elemento. Ajustamos com
    // padding negativo para pegar o elemento inteiro. Simplificação inicial:
    // o handle é um quadrado de 8mm centralizado no ponto de âncora.
    padding: '2mm',
    cursor: 'move',
  };
  const className = `el-handle ${selected ? 'el-handle--selected' : ''}`;
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={`elemento ${index + 1}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ band, index });
      }}
    />
  );
}

function Band({
  band,
  template,
  html,
  selection,
  onSelect,
}: {
  band: BandName;
  template: TemplateInput;
  html: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const heightMm = template[band].heightMm;
  if (heightMm <= 0) return null;

  const clash = bandClashes(template, band);
  const selectedBand = selection?.band === band && selection.index === null;
  const classes = [
    'band',
    `band--${band}`,
    clash ? 'band--clash' : '',
    selectedBand ? 'band--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { margins } = template.page;

  return (
    <div
      className={classes}
      style={{ height: `${heightMm}mm` }}
      onClick={() => onSelect({ band, index: null })}
    >
      <div className="band__render" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="band__tag">
        {BAND_LABEL[band]} · {heightMm}mm{clash ? ' · não cabe na margem' : ''}
      </span>
      <div
        className="band__handles"
        style={{
          position: 'absolute',
          inset: `0 ${margins.right}mm 0 ${margins.left}mm`,
          pointerEvents: 'none',
        }}
      >
        {template[band].elements.map((el, index) => (
          <div key={index} style={{ pointerEvents: 'auto' }}>
            <ElementHandle
              el={el}
              band={band}
              index={index}
              selected={selection?.band === band && selection.index === index}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sheet({ template, assets, selection, onSelect }: SheetProps) {
  const size = sheetSizeMm(template.page);
  const sheetWidthPx = mm(size.width);
  const { ref, scale } = useFitScale(sheetWidthPx, {
    padding: 64,
    paddingY: 56,
    contentHeightPx: mm(size.height),
  });

  let headerHtml = '';
  let footerHtml = '';
  try {
    const rendered = renderTemplate(template, { assets, missingAsset: 'placeholder' });
    headerHtml = rendered.headerHtml;
    footerHtml = rendered.footerHtml;
  } catch {
    headerHtml = '';
    footerHtml = '';
  }

  const { margins } = template.page;
  const bodyHeight = Math.max(0, size.height - margins.top - margins.bottom);

  return (
    <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          width: sheetWidthPx * scale,
          height: mm(size.height) * scale,
          marginTop: 20,
        }}
      >
        <div className="stage" style={{ transform: `scale(${scale})`, width: `${size.width}mm` }}>
          <div className="sheet" style={{ width: `${size.width}mm`, height: `${size.height}mm` }}>
            <Rulers widthMm={size.width} heightMm={size.height} />
            <Band band="header" template={template} html={headerHtml} selection={selection} onSelect={onSelect} />
            <div
              className={`guide ${bandClashes(template, 'header') ? 'guide--clash' : ''}`}
              style={{ top: `${margins.top}mm` }}
            />
            <div
              className={`guide ${bandClashes(template, 'footer') ? 'guide--clash' : ''}`}
              style={{ top: `${size.height - margins.bottom}mm` }}
            />
            <div
              className="bodyghost"
              style={{
                top: `${margins.top}mm`,
                left: `${margins.left}mm`,
                right: `${margins.right}mm`,
                height: `${bodyHeight}mm`,
              }}
            >
              <span className="bodyghost__note">corpo · seu markdown entra aqui</span>
              {Array.from({ length: Math.max(0, Math.floor(bodyHeight / 6)) }, (_, i) => (
                <span
                  key={i}
                  className="bodyghost__line"
                  style={{ width: i % 5 === 4 ? '58%' : '100%' }}
                />
              ))}
            </div>
            <Band band="footer" template={template} html={footerHtml} selection={selection} onSelect={onSelect} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ajustar `web/src/pages/TemplateEditor.tsx` — só o import de Selection**

Nada muda no comportamento — só o tipo. Como o `Selection` agora é `{ band, index: number | null } | null`, o local no `TemplateEditor.tsx` que trata `selection` continua igual (é opaco). Certifique-se de que o import ainda funciona: nenhuma mudança de código é necessária no arquivo, exceto se `Inspector` ainda estiver na assinatura antiga — este será resolvido na Task 7.

Nesse ponto, `Inspector.tsx` ainda usa `Selection` antigo (com `kind: 'zone' | 'element'`), então o build **quebra**. É esperado; a Task 7 resolve.

- [ ] **Step 3: Verificação parcial**

Run: `cd web && npx tsc --noEmit -p .`
Expected: erros em `Inspector.tsx` (esperado — próxima task). `Sheet.tsx` e `templateModel.ts` sem erros.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Sheet.tsx
git commit -m "Sheet: elementos como handles selecionáveis, sem zones"
```

---

## Task 6: `Sheet.tsx` — drag + snap + guia + chip de posição

**Files:**
- Modify: `web/src/components/Sheet.tsx`
- Modify: `web/src/lib/templateModel.ts` (só se precisar exportar helper adicional)

**Interfaces consumidas:**
- `applyDragDelta`, `bandUsableWidthMm`, `SNAP_ANCHOR_MM` (Task 4).
- `MM_TO_PX` de `useFitScale.ts`.

**Interfaces produzidas:**
- `ElementHandle` ganha `onChange` para persistir o elemento arrastado.
- Sheet passa `onElementChange` (novo callback) que os handles invocam.
- Novo overlay `.snap-guide` desenhado durante drag.
- Novo chip `.pos-badge` com valores de x/y durante drag.

- [ ] **Step 1: Adicionar `onElementChange` ao props de `Sheet`**

Editar a interface no topo de `Sheet.tsx`:

```tsx
import { useState, useRef } from 'react';
import { MM_TO_PX } from '../hooks/useFitScale.js';
import {
  applyDragDelta,
  bandUsableWidthMm,
  SNAP_ANCHOR_MM,
  // ...outros
} from '../lib/templateModel.js';

interface SheetProps {
  template: TemplateInput;
  assets: Record<string, string>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onElementChange: (band: BandName, index: number, next: TemplateElement) => void;
}
```

- [ ] **Step 2: Reescrever `ElementHandle` para arrastar**

Substituir o componente inteiro por (dentro do mesmo arquivo):

```tsx
type DragState = {
  originClientX: number;
  originClientY: number;
  originEl: TemplateElement;
  usableWidthMm: number;
  bandHeightMm: number;
} | null;

function ElementHandle({
  el,
  band,
  index,
  selected,
  usableWidthMm,
  bandHeightMm,
  scale,
  onSelect,
  onChange,
}: {
  el: TemplateElement;
  band: BandName;
  index: number;
  selected: boolean;
  usableWidthMm: number;
  bandHeightMm: number;
  scale: number;
  onSelect: (selection: Selection) => void;
  onChange: (next: TemplateElement) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState>(null);
  const [snapAnchor, setSnapAnchor] = useState<'left' | 'center' | 'right' | null>(null);

  const pos = elementPosition(el);
  const style: React.CSSProperties = {
    position: 'absolute',
    top: pos.top,
    left: pos.left,
    right: pos.right,
    transform: pos.transform,
    padding: '2mm',
    cursor: dragging ? 'grabbing' : 'move',
  };

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      originClientX: event.clientX,
      originClientY: event.clientY,
      originEl: el,
      usableWidthMm,
      bandHeightMm,
    };
    setDragging(true);
    onSelect({ band, index });
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.originClientX;
    const dyPx = event.clientY - drag.originClientY;
    // /scale porque a folha inteira está escalada em CSS.
    const dxScreenMm = dxPx / (MM_TO_PX * scale);
    const dyMm = dyPx / (MM_TO_PX * scale);
    const next = applyDragDelta(drag.originEl, dxScreenMm, dyMm, drag.usableWidthMm);
    onChange(next);
    // Snap ativo se o align mudou vs. o original ou se o offset é 0 e antes não era.
    setSnapAnchor(
      next.align !== drag.originEl.align || (next.xOffsetMm === 0 && drag.originEl.xOffsetMm !== 0)
        ? next.align
        : null,
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    setDragging(false);
    setSnapAnchor(null);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  const className = `el-handle ${selected ? 'el-handle--selected' : ''} ${dragging ? 'el-handle--dragging' : ''}`;

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        aria-label={`elemento ${index + 1}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {dragging && (
        <div
          className="pos-badge"
          style={{
            position: 'absolute',
            top: `${el.yMm + 5}mm`,
            ...(el.align === 'right'
              ? { right: `${el.xOffsetMm}mm` }
              : el.align === 'center'
                ? { left: `calc(50% + ${el.xOffsetMm}mm)`, transform: 'translateX(-50%)' }
                : { left: `${el.xOffsetMm}mm` }),
          }}
        >
          <span className="measure">x: {el.xOffsetMm >= 0 ? '+' : ''}{el.xOffsetMm.toFixed(1)}mm</span>
          <span className="measure">y: {el.yMm.toFixed(1)}mm</span>
        </div>
      )}
      {snapAnchor && (
        <div
          className="snap-guide"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 0,
            ...(snapAnchor === 'left'
              ? { left: 0 }
              : snapAnchor === 'right'
                ? { right: 0 }
                : { left: '50%' }),
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Passar `usableWidthMm`, `bandHeightMm`, `scale` e `onChange` do `Band` para o handle**

Ajustar o componente `Band`:

```tsx
function Band({
  band,
  template,
  html,
  selection,
  scale,
  onSelect,
  onElementChange,
}: {
  band: BandName;
  template: TemplateInput;
  html: string;
  selection: Selection;
  scale: number;
  onSelect: (selection: Selection) => void;
  onElementChange: (band: BandName, index: number, next: TemplateElement) => void;
}) {
  const heightMm = template[band].heightMm;
  if (heightMm <= 0) return null;

  const clash = bandClashes(template, band);
  const selectedBand = selection?.band === band && selection.index === null;
  const classes = ['band', `band--${band}`, clash ? 'band--clash' : '', selectedBand ? 'band--selected' : '']
    .filter(Boolean)
    .join(' ');

  const { margins } = template.page;
  const usableWidthMm = bandUsableWidthMm(template);

  return (
    <div
      className={classes}
      style={{ height: `${heightMm}mm` }}
      onClick={() => onSelect({ band, index: null })}
    >
      <div className="band__render" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="band__tag">
        {BAND_LABEL[band]} · {heightMm}mm{clash ? ' · não cabe na margem' : ''}
      </span>
      <div
        className="band__handles"
        style={{ position: 'absolute', inset: `0 ${margins.right}mm 0 ${margins.left}mm` }}
      >
        {template[band].elements.map((el, index) => (
          <ElementHandle
            key={index}
            el={el}
            band={band}
            index={index}
            selected={selection?.band === band && selection.index === index}
            usableWidthMm={usableWidthMm}
            bandHeightMm={heightMm}
            scale={scale}
            onSelect={onSelect}
            onChange={(next) => onElementChange(band, index, next)}
          />
        ))}
      </div>
    </div>
  );
}
```

Passar as novas props no `Sheet`:

```tsx
<Band band="header" template={template} html={headerHtml} selection={selection} scale={scale} onSelect={onSelect} onElementChange={onElementChange} />
// ... e no footer.
```

- [ ] **Step 4: Ajustar `TemplateEditor.tsx` para injetar `onElementChange`**

Editar `web/src/pages/TemplateEditor.tsx` — na chamada de `<Sheet ...>` (por volta da linha 198), acrescentar:

```tsx
<Sheet
  template={template}
  assets={assets}
  selection={selection}
  onSelect={setSelection}
  onElementChange={(band, index, next) =>
    edit({
      ...template,
      [band]: {
        ...template[band],
        elements: template[band].elements.map((e, i) => (i === index ? next : e)),
      },
    })
  }
/>
```

- [ ] **Step 5: Type-check**

Run: `cd web && npx tsc --noEmit -p .`
Expected: erros só em `Inspector.tsx` (próxima task).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Sheet.tsx web/src/pages/TemplateEditor.tsx
git commit -m "Sheet: arrasto com snap para âncora, guia visual e chip de posição"
```

---

## Task 7: `Inspector.tsx` — bloco "posição" + atalhos + teclado

**Files:**
- Modify: `web/src/components/Inspector.tsx`

**Interfaces consumidas:**
- `Selection`, `BAND_LABEL`, `ELEMENT_LABEL`, `makeElement`, `replaceElement`, `updateBand`, `describeElement` (Task 4).
- `TemplateElement`, `TemplateInput` do backend.

- [ ] **Step 1: Reescrever `web/src/components/Inspector.tsx`**

Substituir o arquivo inteiro:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { api, assetUrl } from '../api.js';
import {
  BAND_LABEL,
  describeElement,
  ELEMENT_LABEL,
  makeElement,
  NUDGE_FINE_MM,
  NUDGE_MM,
  replaceElement,
  updateBand,
  type Selection,
} from '../lib/templateModel.js';

interface InspectorProps {
  template: TemplateInput;
  selection: Selection;
  onChange: (next: TemplateInput) => void;
  onSelect: (selection: Selection) => void;
}

const PAGE_FORMATS = ['{page}', '{page} / {total}', 'Página {page} de {total}'];
const ELEMENT_TYPES: TemplateElement['type'][] = ['text', 'image', 'pageNumber', 'date'];

function PositionBlock({
  element,
  onChange,
}: {
  element: TemplateElement;
  onChange: (next: TemplateElement) => void;
}) {
  const setAlign = (align: TemplateElement['align']) =>
    onChange({ ...element, align, xOffsetMm: 0 } as TemplateElement);
  return (
    <>
      <span className="label pane__title">posição</span>
      <div className="align-shortcut" role="group" aria-label="alinhamento">
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'left' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('left')}
        >
          ⇤ esq.
        </button>
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'center' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('center')}
        >
          ↔ centro
        </button>
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'right' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('right')}
        >
          ⇥ dir.
        </button>
      </div>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <label className="field">
          <span className="label">x offset (mm)</span>
          <input
            type="number"
            className="measure"
            step={0.5}
            value={element.xOffsetMm}
            onChange={(event) => onChange({ ...element, xOffsetMm: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="label">y (mm)</span>
          <input
            type="number"
            className="measure"
            step={0.5}
            min={0}
            value={element.yMm}
            onChange={(event) => onChange({ ...element, yMm: Number(event.target.value) })}
          />
        </label>
      </div>
    </>
  );
}

function TextProps({
  element,
  onChange,
}: {
  element: Extract<TemplateElement, { fontSizePt: number }>;
  onChange: (next: TemplateElement) => void;
}) {
  return (
    <>
      <div className="grid-2">
        <label className="field">
          <span className="label">tamanho (pt)</span>
          <input
            type="number"
            className="measure"
            min={4}
            max={72}
            value={element.fontSizePt}
            onChange={(event) => onChange({ ...element, fontSizePt: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="label">cor</span>
          <input
            type="color"
            value={element.color}
            onChange={(event) => onChange({ ...element, color: event.target.value })}
          />
        </label>
      </div>
      <label className="field--row">
        <input
          type="checkbox"
          checked={element.bold}
          onChange={(event) => onChange({ ...element, bold: event.target.checked })}
        />
        <span>Negrito</span>
      </label>
    </>
  );
}

function ImageProps({
  element,
  onChange,
}: {
  element: Extract<TemplateElement, { type: 'image' }>;
  onChange: (next: TemplateElement) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { assetId } = await api.uploadAsset(file);
      onChange({ ...element, assetId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível enviar a imagem');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {element.assetId ? (
        <img className="preview-img" src={assetUrl(element.assetId)} alt="" />
      ) : (
        <p className="hint">Nenhuma imagem escolhida.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Enviando...' : element.assetId ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
      </div>
      {error && <div className="notice notice--warn" style={{ marginTop: 8 }}>{error}</div>}
      <label className="field" style={{ marginTop: 10 }}>
        <span className="label">altura (mm)</span>
        <input
          type="number"
          className="measure"
          min={1}
          max={40}
          value={element.heightMm}
          onChange={(event) => onChange({ ...element, heightMm: Number(event.target.value) })}
        />
      </label>
    </>
  );
}

function ElementProps({
  element,
  onChange,
}: {
  element: TemplateElement;
  onChange: (next: TemplateElement) => void;
}) {
  switch (element.type) {
    case 'image':
      return <ImageProps element={element} onChange={onChange} />;
    case 'text':
      return (
        <>
          <label className="field">
            <span className="label">texto</span>
            <input
              type="text"
              value={element.value}
              onChange={(event) => onChange({ ...element, value: event.target.value })}
            />
          </label>
          <p className="hint">
            Use <code className="code">{'{{nome}}'}</code> para um valor que muda a cada conversão. A
            API preenche pelo campo <code className="code">variables</code>.
          </p>
          <TextProps element={element} onChange={onChange} />
        </>
      );
    case 'pageNumber':
      return (
        <>
          <label className="field">
            <span className="label">formato</span>
            <input
              type="text"
              value={element.format}
              onChange={(event) => onChange({ ...element, format: event.target.value })}
            />
          </label>
          <div className="chips">
            {PAGE_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                className="chip"
                onClick={() => onChange({ ...element, format })}
              >
                {format}
              </button>
            ))}
          </div>
          <p className="hint">
            <code className="code">{'{page}'}</code> e <code className="code">{'{total}'}</code> são
            preenchidos na impressão, página a página.
          </p>
          <div style={{ marginTop: 10 }}>
            <TextProps element={element} onChange={onChange} />
          </div>
        </>
      );
    case 'date':
      return (
        <>
          <label className="field">
            <span className="label">formato</span>
            <select
              value={element.format}
              onChange={(event) =>
                onChange({ ...element, format: event.target.value as typeof element.format })
              }
            >
              <option value="dd/MM/yyyy">31/12/2026</option>
              <option value="yyyy-MM-dd">2026-12-31</option>
              <option value="dd/MM/yyyy HH:mm">31/12/2026 14:05</option>
            </select>
          </label>
          <p className="hint">A data é a do momento da conversão.</p>
          <TextProps element={element} onChange={onChange} />
        </>
      );
  }
}

export function Inspector({ template, selection, onChange, onSelect }: InspectorProps) {
  const selectedIndex =
    selection && selection.index !== null ? selection.index : null;
  const selected =
    selection && selectedIndex !== null ? template[selection.band].elements[selectedIndex] : null;

  // Teclado: nudge, remover, esc.
  useEffect(() => {
    if (!selection || selectedIndex === null || !selected) return;
    const step = (event: KeyboardEvent) => {
      // Ignora se o foco está num campo de texto (deixa o input processar as setas).
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const amount = event.shiftKey ? NUDGE_FINE_MM : NUDGE_MM;
      const dxScreen = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      if (dxScreen !== 0 || dy !== 0) {
        event.preventDefault();
        const dxOffset = selected.align === 'right' ? -dxScreen : dxScreen;
        const next: TemplateElement = {
          ...selected,
          xOffsetMm: selected.xOffsetMm + dxOffset,
          yMm: Math.max(0, selected.yMm + dy),
        } as TemplateElement;
        onChange(replaceElement(template, { band: selection.band, index: selectedIndex }, next));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onChange(
          updateBand(template, selection.band, (list) => list.filter((_, i) => i !== selectedIndex)),
        );
        onSelect({ band: selection.band, index: null });
        return;
      }
      if (event.key === 'Escape') {
        onSelect(null);
      }
    };
    window.addEventListener('keydown', step);
    return () => window.removeEventListener('keydown', step);
  }, [selection, selectedIndex, selected, template, onChange, onSelect]);

  if (!selection) {
    return (
      <div className="pane pane--right">
        <span className="label pane__title">elemento</span>
        <p className="hint">
          Clique num elemento na folha para editá-lo, ou numa faixa para adicionar novos.
        </p>
      </div>
    );
  }

  const { band } = selection;
  const elements = template[band].elements;

  const addElement = (type: TemplateElement['type']) => {
    onChange(updateBand(template, band, (list) => [...list, makeElement(type)]));
    onSelect({ band, index: elements.length });
  };

  const removeSelected = () => {
    if (selectedIndex === null) return;
    onChange(updateBand(template, band, (list) => list.filter((_, i) => i !== selectedIndex)));
    onSelect({ band, index: null });
  };

  return (
    <div className="pane pane--right">
      <span className="label pane__title">{BAND_LABEL[band]}</span>

      {elements.length === 0 ? (
        <p className="hint">Faixa vazia.</p>
      ) : (
        <div className="stack">
          {elements.map((element, index) => (
            <button
              key={index}
              type="button"
              className={`elrow ${index === selectedIndex ? 'elrow--selected' : ''}`}
              onClick={() => onSelect({ band, index })}
            >
              <span className="elrow__kind">{ELEMENT_LABEL[element.type]}</span>
              <span className="elrow__desc">{describeElement(element)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="addmenu">
        <span className="label addmenu__title">adicionar</span>
        {ELEMENT_TYPES.map((type) => (
          <button key={type} type="button" className="btn btn--sm btn--ghost" onClick={() => addElement(type)}>
            <span className="addmenu__plus">+</span>
            {ELEMENT_LABEL[type]}
          </button>
        ))}
      </div>

      {selected && selectedIndex !== null && (
        <section className="pane__section">
          <span className="label pane__title">{ELEMENT_LABEL[selected.type]}</span>
          <ElementProps
            element={selected}
            onChange={(next) =>
              onChange(replaceElement(template, { band, index: selectedIndex }, next))
            }
          />
          <div style={{ marginTop: 14 }}>
            <PositionBlock
              element={selected}
              onChange={(next) =>
                onChange(replaceElement(template, { band, index: selectedIndex }, next))
              }
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn btn--sm btn--danger" onClick={removeSelected}>
              Remover elemento
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check completo do frontend**

Run: `cd web && npx tsc --noEmit -p .`
Expected: PASS (sem erros).

- [ ] **Step 3: Build do frontend**

Run: `cd web && npm run build`
Expected: build sucesso.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Inspector.tsx
git commit -m "Inspector: bloco de posição, atalhos de alinhamento e teclado"
```

---

## Task 8: Estilos — remover `.slot`, adicionar handles + guia + chip + atalhos

**Files:**
- Modify: `web/src/styles.css`

- [ ] **Step 1: Remover regras obsoletas de `.slot`**

Em `web/src/styles.css`, apagar o bloco:

```css
.slot {
  position: absolute;
  inset: 0;
  display: flex;
}

.slot__zone {
  flex: 1 1 0;
  border: none;
  background: transparent;
  border-right: 1px dashed rgb(11 118 131 / 0.22);
  transition: background var(--fast);
}

.slot__zone:last-child {
  border-right: none;
}

.slot__zone:hover {
  background: rgb(63 198 209 / 0.14);
}

.slot__zone--selected {
  background: rgb(63 198 209 / 0.2);
  box-shadow: inset 0 0 0 1px var(--accent);
}
```

- [ ] **Step 2: Adicionar novas regras — handles, guia, chip, atalhos**

Adicionar no final da seção "bancada e folha" (antes de `/* ══ inspector ══` ...):

```css
/* handle de elemento — sobrepõe o HTML impresso e captura arrasto */
.el-handle {
  border: none;
  border-radius: 1mm;
  background: transparent;
  outline: 1px solid transparent;
  transition: outline-color var(--fast), background var(--fast);
}

.el-handle:hover {
  outline-color: rgb(63 198 209 / 0.35);
  background: rgb(63 198 209 / 0.06);
}

.el-handle--selected {
  outline: 1px solid var(--accent);
  outline-offset: 0.4mm;
  background: rgb(63 198 209 / 0.09);
}

.el-handle--dragging {
  outline-color: var(--accent-bright);
  background: rgb(63 198 209 / 0.15);
  cursor: grabbing;
}

/* linha guia vertical que aparece durante o snap para uma âncora */
.snap-guide {
  border-left: 1px dashed var(--accent-bright);
  pointer-events: none;
  animation: guide-in 120ms var(--ease);
}

@keyframes guide-in {
  from { opacity: 0; }
}

/* chip de coordenadas durante o drag */
.pos-badge {
  display: inline-flex;
  gap: 8px;
  padding: 3px 7px;
  background: var(--chrome);
  color: var(--chrome-text);
  border-radius: var(--r-sm);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.02em;
  pointer-events: none;
  box-shadow: var(--shadow-sm);
  white-space: nowrap;
}

/* grupo dos 3 botões de alinhamento no inspector */
.align-shortcut {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.align-shortcut .btn {
  justify-content: center;
  padding-inline: 6px;
}

.align-shortcut__active,
.align-shortcut__active:hover:not(:disabled) {
  --btn-bg: var(--chrome-3);
  --btn-fg: var(--accent-bright);
  --btn-bd: var(--accent);
}
```

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: sucesso.

- [ ] **Step 4: Smoke manual — dev server**

Run: `cd web && npm run dev` (em outra aba: `npm start` na raiz para ter a API).

Abrir `http://localhost:5173`, entrar num template, e testar:
1. Nenhum divisor de zona visível na faixa.
2. Adicionar um elemento (via inspector) e vê-lo aparecer alinhado à esquerda.
3. Arrastar o elemento livre: outline muda para acento durante o drag, chip com x/y aparece.
4. Arrastar para perto do centro: guia vertical acende e o elemento gruda no centro.
5. Clicar em "⇥ dir." no inspector: elemento pula para a direita.
6. Adicionar um segundo elemento na mesma faixa e mover para `yMm=6` — deve ficar por baixo.
7. Salvar e Gerar PDF de exemplo — verificar que o PDF sai com o layout correspondente ao preview.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css
git commit -m "Estilos: handles arrastáveis, guia de snap, chip de posição, atalhos"
```

---

## Self-Review

### 1. Spec coverage

Cada seção do spec mapeia a tarefas:

| Seção do spec | Task |
|---|---|
| Modelo de dados (align/xOffsetMm/yMm; elements[]) | 1 |
| Regra de sanidade yMm + altura > band.heightMm | 1 |
| Template inicial (pageNumber na direita) | 1 |
| Migração zones→elements | 2 |
| Repo self-healing | 2 |
| `elementPosition` (função pura) | 3 |
| bandHtml com position:absolute | 3 |
| Frontend `Selection` novo | 4 |
| `applyDragDelta` com snap | 4 |
| Sheet: elementos como handles | 5 |
| Drag + snap + guia + chip | 6 |
| Inspector: bloco "posição" + atalhos | 7 |
| Teclado (setas, Delete, Esc) | 7 |
| Estilos (handles, guia, chip, atalhos) | 8 |

### 2. Placeholder scan

Nenhum "TBD", "implement later", "handle appropriately" no plano. Cada step tem código concreto.

### 3. Type consistency

- `Selection = { band: BandName; index: number | null } | null` — usado consistentemente em Sheet, Inspector, TemplateEditor.
- `applyDragDelta(origin, dxScreenMm, dyMm, usableWidthMm)` — mesma assinatura em Task 4 e Task 6.
- `elementPosition(el): { top, left?, right?, transform? }` — assinatura idêntica em Task 3 (backend export) e Task 5 (consumo no frontend).
- `onElementChange(band, index, next)` — mesma assinatura em Task 6 (Sheet prop) e Task 6 (TemplateEditor injeta).

### 4. Riscos identificados

- **Chromium + translateX blur**: Task 3 Step 5 detecta; se ocorrer, task paralisa e volta ao brainstorm (não implementa fallback à revelia).
- **Handle vs. HTML do renderer**: Task 5 usa handle transparente sobreposto ao HTML impresso — simplificação inicial com padding fixo de 2mm. Isso pode dar hit-target pequeno para elementos maiores (imagem grande). Aceito para a primeira versão; refinar em iteração.
- **Testes de frontend**: sem infra. O plano se apoia em type-check + smoke manual no Task 8 Step 4. Registrado.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-editor-posicionamento-livre.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
