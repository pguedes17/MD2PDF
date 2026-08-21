import { TemplateInputSchema, BAND_MARGIN_SLACK_MM, type TemplateInput } from '../domain/template.js';
import { DEFAULT_FONT_FAMILY } from '../domain/fontPresets.js';
import type { DocxAnalysis, Warning } from './schema.js';

type BandData = DocxAnalysis['headers'][string];

/** Returns the 'default' band, falling back to 'first', then undefined. */
function pickBand(map: Record<string, BandData>): BandData | undefined {
  return map['default'] ?? map['first'];
}

/** Maps a detected font family to a CSS preset family string, with fallback. */
function mapFamily(font: string, matches: Record<string, string>): string {
  return matches[font] ?? DEFAULT_FONT_FAMILY;
}

/**
 * Casa formatos de paginação em pt, en e es. Word grava o número já resolvido
 * (ex.: "Page 7 of 7", "Página 3 de 10", "Pág. 1/5") — sem esse detector, o
 * texto vira literal no template e imprime sempre o mesmo número em todas as
 * páginas do PDF gerado.
 *
 * Grupos capturados:
 *   1 = prefixo do idioma ("Page ", "Página ", "Pág. ", etc.) — pode estar ausente.
 *   2 = número corrente
 *   3 = separador ("of", "de", "/")
 *   4 = total
 *
 * Só casa quando o total está presente — "Página 3" sozinho é ambíguo demais
 * (pode ser conteúdo tipo "Anexo 3" ou "Página do documento") e fica como texto.
 */
// Grupo 1: prefixo do idioma (opcional). Grupos 2/4: números. Grupo 3: o separador
// completo COM os espaços em volta — preservado literalmente no format final para
// respeitar a formatação exata que o autor escreveu no Word.
const PAGINATION_PATTERN =
  /^\s*(P[aá]g(?:ina|\.)?\s+|Page\s+|Pg\.?\s+)?(\d+)(\s*(?:of|de|\/)\s*)(\d+)\s*$/i;

/**
 * Se `text` for uma paginação, devolve o format string do elemento pageNumber
 * (com `{page}` e `{total}` no lugar dos números). Caso contrário, `null`.
 * Preserva prefixo, separador, caixa e espaçamento originais.
 */
export function detectPaginationFormat(text: string): string | null {
  const match = PAGINATION_PATTERN.exec(text);
  if (!match) return null;
  const [, prefixRaw, , separatorRaw] = match;
  const prefix = prefixRaw ?? '';
  const separator = separatorRaw!;
  return `${prefix}{page}${separator}{total}`;
}

/**
 * Maps BandElements from DocxAnalysis to TemplateElements.
 * Images without a matching assetId are skipped with a warning.
 * Text elements that look like pagination ("Page X of Y", "Página X de Y", ...)
 * are converted to `pageNumber` elements — otherwise the number becomes a
 * literal that shows the same value on every page.
 */
function mapBandElements(
  band: BandData | undefined,
  imageIndex: Record<string, string>,
  warnings: Warning[],
): unknown[] {
  if (!band) return [];
  const out: unknown[] = [];
  for (const el of band.elements) {
    if (el.type === 'text') {
      const paginationFormat = detectPaginationFormat(el.value);
      if (paginationFormat) {
        warnings.push({
          code: 'PAGE_NUMBER_DETECTED',
          message:
            `texto "${el.value}" foi convertido em elemento de paginação dinâmica (formato "${paginationFormat}"). ` +
            'Se estiver errado, edite manualmente no editor.',
        });
        out.push({
          type: 'pageNumber',
          format: paginationFormat,
          align: el.align,
          xOffsetMm: 0,
          yMm: el.yMm,
          bold: el.bold,
          fontSizePt: el.fontSizePt,
          color: el.color,
        });
        continue;
      }
      out.push({
        type: 'text',
        value: el.value,
        align: el.align,
        xOffsetMm: 0,
        yMm: el.yMm,
        bold: el.bold,
        fontSizePt: el.fontSizePt,
        color: el.color,
      });
    } else {
      // type === 'image'
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
        yMm: el.yMm,
      });
    }
  }
  return out;
}

export function toTemplateInput(
  analysis: DocxAnalysis,
  name: string,
): { templateInput: TemplateInput; warnings: Warning[] } {
  const warnings: Warning[] = [];

  // Build image index: docxPath → assetId
  const imageIndex: Record<string, string> = {};
  for (const img of analysis.images) {
    imageIndex[img.docxPath] = img.assetId;
  }

  // Pick header / footer bands
  const headerBand = pickBand(analysis.headers);
  const footerBand = pickBand(analysis.footers);

  // Heights — fall back to 15 for empty/missing bands
  const headerHeight = headerBand && headerBand.heightMm > 0 ? headerBand.heightMm : 15;
  const footerHeight = footerBand && footerBand.heightMm > 0 ? footerBand.heightMm : 15;

  // Auto-adjust margins so bands fit (band + slack ≤ margin)
  const marginTop = Math.max(analysis.page.margins.top, headerHeight + BAND_MARGIN_SLACK_MM);
  const marginBottom = Math.max(analysis.page.margins.bottom, footerHeight + BAND_MARGIN_SLACK_MM);

  // Map band elements
  const headerElements = mapBandElements(headerBand, imageIndex, warnings);
  const footerElements = mapBandElements(footerBand, imageIndex, warnings);

  // POSSIBLE_COVER_IGNORED: first-page header with image elements likely means a cover page
  if (
    analysis.headers['first'] &&
    analysis.headers['first'].elements.some((e) => e.type === 'image')
  ) {
    warnings.push({
      code: 'POSSIBLE_COVER_IGNORED',
      message:
        'primeira página do docx parece ser uma capa (imagem + texto); capa fica desligada e você pode ativar no editor.',
    });
  }

  // Map headings — strip 'family' since TemplateInputSchema.HeadingStyleSchema does not include it
  function mapHeading(h: DocxAnalysis['styles']['headings']['h1']) {
    if (!h) return undefined;
    return { bold: h.bold, fontSizePt: h.fontSizePt, color: h.color };
  }

  const raw = {
    name,
    page: {
      format: analysis.page.format,
      orientation: analysis.page.orientation,
      margins: {
        top: marginTop,
        right: analysis.page.margins.right,
        bottom: marginBottom,
        left: analysis.page.margins.left,
      },
    },
    header: {
      heightMm: headerHeight,
      elements: headerElements,
    },
    footer: {
      heightMm: footerHeight,
      elements: footerElements,
    },
    body: {
      font: { family: mapFamily(analysis.styles.body.family, analysis.fonts.presetMatches) },
      fontSizePt: analysis.styles.body.fontSizePt,
      color: analysis.styles.body.color,
      lineHeight: analysis.styles.body.lineHeight,
    },
    headings: {
      h1: mapHeading(analysis.styles.headings.h1),
      h2: mapHeading(analysis.styles.headings.h2),
      h3: mapHeading(analysis.styles.headings.h3),
    },
    cover: { enabled: false },
  };

  const templateInput = TemplateInputSchema.parse(raw);
  return { templateInput, warnings };
}
