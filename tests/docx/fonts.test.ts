import { describe, it, expect } from 'vitest';
import { mapFontsToPresets } from '../../src/docx/fonts.js';

describe('mapFontsToPresets', () => {
  it('bate exato: Arial → Arial preset', () => {
    const r = mapFontsToPresets(['Arial']);
    expect(r.presetMatches['Arial']).toContain('Arial');
    expect(r.unmatched).toHaveLength(0);
  });

  it('case-insensitive: verdana', () => {
    const r = mapFontsToPresets(['verdana']);
    expect(r.presetMatches['verdana']).toContain('Verdana');
  });

  it('mapa manual: Calibri → sistema', () => {
    const r = mapFontsToPresets(['Calibri']);
    expect(r.presetMatches['Calibri']).toContain('system-ui');
  });

  it('mapa manual: Cambria → Georgia', () => {
    const r = mapFontsToPresets(['Cambria']);
    expect(r.presetMatches['Cambria']).toContain('Georgia');
  });

  it('fonte desconhecida cai em unmatched + warning', () => {
    const r = mapFontsToPresets(['BionexoSans']);
    expect(r.presetMatches['BionexoSans']).toBeUndefined();
    expect(r.unmatched).toContain('BionexoSans');
    expect(r.warnings.some((w) => w.code === 'FONT_NOT_MATCHED')).toBe(true);
  });
});
