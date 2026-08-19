/**
 * Migração de template do formato antigo (`band.zones.{left,center,right}`)
 * para o novo (`band.elements[]` com âncora + offset).
 *
 * Isolada do schema Zod: recebe JSON cru, devolve JSON cru. O repo aplica
 * antes de validar contra o `TemplateSchema` — assim o schema não precisa
 * conhecer o formato antigo.
 */

type Anchor = 'left' | 'center' | 'right';
const ANCHORS: readonly Anchor[] = ['left', 'center', 'right'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bandNeedsMigration(band: unknown): boolean {
  return isObject(band) && 'zones' in band && isObject(band.zones);
}

function migrateBand(band: Record<string, unknown>): Record<string, unknown> {
  const zones = band.zones as Record<Anchor, unknown> | undefined;
  const elements: unknown[] = [];
  if (zones) {
    for (const anchor of ANCHORS) {
      const zone = zones[anchor];
      if (!Array.isArray(zone)) continue;
      for (const el of zone) {
        if (!isObject(el)) continue;
        elements.push({ ...el, align: anchor, xOffsetMm: 0, yMm: 0 });
      }
    }
  }
  // Preserva os demais campos da faixa (heightMm), remove a chave `zones`.
  const { zones: _zones, ...rest } = band;
  return { ...rest, elements };
}

export function migrateTemplateJson(raw: unknown): { data: unknown; changed: boolean } {
  if (!isObject(raw)) return { data: raw, changed: false };

  const headerLegacy = bandNeedsMigration(raw.header);
  const footerLegacy = bandNeedsMigration(raw.footer);
  if (!headerLegacy && !footerLegacy) return { data: raw, changed: false };

  const next: Record<string, unknown> = { ...raw };
  if (headerLegacy) next.header = migrateBand(raw.header as Record<string, unknown>);
  if (footerLegacy) next.footer = migrateBand(raw.footer as Record<string, unknown>);
  return { data: next, changed: true };
}
