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
