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
