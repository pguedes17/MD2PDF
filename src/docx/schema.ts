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
  headers: z.record(BandSchema).default({}),
  footers: z.record(BandSchema).default({}),
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
