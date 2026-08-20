/** OOXML usa twips (1/20pt), EMU (English Metric Unit, 914400/inch)
 *  e half-points (font size). Este módulo isola essa aritmética. */
export function twipsToMm(twips: number): number {
  return (twips * 25.4) / 1440;
}

export function emuToMm(emu: number): number {
  return (emu * 25.4) / 914400;
}

export function halfPointsToPt(halfPt: number): number {
  return halfPt / 2;
}
