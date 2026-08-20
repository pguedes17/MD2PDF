import { describe, it, expect } from 'vitest';
import { twipsToMm, emuToMm, halfPointsToPt } from '../../src/docx/units.js';

describe('units', () => {
  it('twipsToMm: 1440 twips = 25.4 mm', () => {
    expect(twipsToMm(1440)).toBeCloseTo(25.4, 3);
  });
  it('twipsToMm: 11906 twips ≈ 210mm (largura A4)', () => {
    expect(Math.round(twipsToMm(11906))).toBe(210);
  });
  it('emuToMm: 914400 EMU = 25.4 mm', () => {
    expect(emuToMm(914400)).toBeCloseTo(25.4, 3);
  });
  it('halfPointsToPt: 22 = 11pt', () => {
    expect(halfPointsToPt(22)).toBe(11);
  });
});
