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
 * Maps BandElements from DocxAnalysis to TemplateElements.
 * Images without a matching assetId are skipped with a warning.
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
        yMm: 0,
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
