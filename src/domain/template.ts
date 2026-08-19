import { z } from 'zod';
import { DEFAULT_FONT_FAMILY } from './fontPresets.js';

/**
 * Fonte da verdade do formato de template. O servidor valida com estes schemas,
 * o editor deriva seus tipos daqui, e o renderer consome os tipos inferidos.
 */

/** Folga mínima entre a faixa (header/footer) e a margem da página, em mm.
 *  Sem essa folga o Chromium corta a faixa em silêncio. */
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

/** Posição do elemento dentro de uma faixa (header/footer). `xOffsetMm` positivo
 *  sempre puxa para dentro da folha. `yMm` é a distância do topo da faixa (0..60). */
const bandPositionProps = {
  align: z.enum(['left', 'center', 'right']).default('left'),
  xOffsetMm: z.number().min(-200).max(200).default(0),
  yMm: z.number().min(0).max(60).default(0),
};

/** Posição do elemento na capa. `yMm` pode ir até 320mm (maior formato suportado). */
const coverPositionProps = {
  align: z.enum(['left', 'center', 'right']).default('left'),
  xOffsetMm: z.number().min(-200).max(200).default(0),
  yMm: z.number().min(0).max(320).default(0),
};

export const ElementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    assetId: z.string().min(1, 'escolha uma imagem para este elemento'),
    /** Altura renderizada; a largura acompanha proporcionalmente. */
    heightMm: z.number().min(1).max(40).default(12),
    ...bandPositionProps,
  }),
  z.object({
    type: z.literal('text'),
    /** Aceita placeholders {{variavel}}, resolvidos na conversão. */
    value: z.string().default(''),
    ...commonTextProps,
    ...bandPositionProps,
  }),
  z.object({
    type: z.literal('pageNumber'),
    /** {page} e {total} são substituídos pelo próprio Chromium. */
    format: z.string().default('{page} / {total}'),
    ...commonTextProps,
    ...bandPositionProps,
  }),
  z.object({
    type: z.literal('date'),
    format: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy HH:mm']).default('dd/MM/yyyy'),
    ...commonTextProps,
    ...bandPositionProps,
  }),
]);

/** Elementos válidos na capa — sem pageNumber (não faz sentido numa capa). */
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

export const BandSchema = z.object({
  heightMm: z.number().min(0).max(60),
  elements: z.array(ElementSchema).default([]),
});

/** Dimensões em mm dos formatos aceitos, em retrato. */
export const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
} as const;

const PageSchema = z.object({
  format: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  /** Todas em milímetros. */
  margins: z.object({
    top: z.number().min(0).max(100),
    right: z.number().min(0).max(100),
    bottom: z.number().min(0).max(100),
    left: z.number().min(0).max(100),
  }),
});

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

const baseTemplateShape = {
  name: z.string().trim().min(1, 'nome é obrigatório').max(120),
  page: PageSchema,
  header: BandSchema,
  footer: BandSchema,
  // prefault (não default): o Zod 4 não aplica defaults internos ao valor de .default()
  body: BodySchema.prefault({}),
  headings: HeadingsSchema.prefault({}),
  cover: CoverSchema.prefault({}),
};

const TemplateInputBase = z.object(baseTemplateShape);
type TemplateBase = z.output<typeof TemplateInputBase>;
type TemplateElementParsed = z.infer<typeof ElementSchema>;

/** A margem precisa acomodar a faixa, senão o Chromium a corta sem avisar. */
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

/** Altura estimada em mm do elemento — texto usa fontSizePt × 0.353 × 1.2. */
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

function estimatedCoverElementHeightMm(el: TemplateCoverElement): number {
  if (el.type === 'image') return el.heightMm;
  return el.fontSizePt * 0.353 * 1.2;
}

function pageHeightMm(t: TemplateBase): number {
  const size = PAGE_SIZES_MM[t.page.format];
  return t.page.orientation === 'landscape' ? size.width : size.height;
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

/** Aceita o tipo base, então serve tanto ao schema de entrada quanto ao persistido. */
function checkBands(t: TemplateBase, ctx: z.RefinementCtx): void {
  checkBandFits(t.header.heightMm, t.page.margins.top, 'top', ctx);
  checkBandFits(t.footer.heightMm, t.page.margins.bottom, 'bottom', ctx);
  checkElementsFit(t.header, 'header', ctx);
  checkElementsFit(t.footer, 'footer', ctx);
  checkCoverFits(t, ctx);
}

/** O que a API aceita em POST/PUT: sem id nem timestamps (o servidor os define). */
export const TemplateInputSchema = TemplateInputBase.superRefine(checkBands);

/** O template como fica persistido em disco. */
export const TemplateSchema = TemplateInputBase.extend({
  id: z.string().min(1),
  version: z.literal(1).default(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).superRefine(checkBands);

export type TemplateElement = z.infer<typeof ElementSchema>;
export type TemplateBand = z.infer<typeof BandSchema>;
export type TemplateInput = z.infer<typeof TemplateInputSchema>;
/** O mesmo template *antes* dos defaults — é o formato que se escreve à mão. */
export type TemplateInputRaw = z.input<typeof TemplateInputSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateSummary = Pick<Template, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

/** Ponto de partida do editor: margens já compatíveis com as faixas. */
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

/** Resolve {{variavel}} em textos de header/footer. Placeholder sem valor vira string vazia. */
export function applyVariables(text: string, variables: Record<string, string> | undefined): string {
  return text.replace(PLACEHOLDER, (_match, key: string) => variables?.[key] ?? '');
}
