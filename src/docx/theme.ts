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
