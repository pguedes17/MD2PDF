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

function imageOfParagraph(
  p: unknown,
  rels: Record<string, string>,
): { docxPath: string; heightMm: number } | null {
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
      elements.push({
        type: 'image',
        imageDocxPath: image.docxPath,
        align,
        heightMm: Math.round(image.heightMm * 10) / 10,
      });
      continue;
    }
    const text = textOfParagraph(p).trim();
    if (!text) continue;
    const typo = typographyOfFirstRun(p);
    elements.push({ type: 'text', value: text, align, ...typo });
  }

  return { elements, warnings };
}
