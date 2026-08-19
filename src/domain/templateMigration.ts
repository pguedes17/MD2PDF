/**
 * Migração de template do formato antigo (`band.zones.{left,center,right}`)
 * para o novo (`band.elements[]` com âncora + offset), e de v1 para v2
 * (body.fontFamily → body.font, + cover, + headings).
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

// ─── v0 → v1: zones → elements ────────────────────────────────────────────────

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

// ─── v1 → v2: body.fontFamily → body.font, + cover, + headings ───────────────

function bodyNeedsMigration(body: unknown): boolean {
  return isObject(body) && 'fontFamily' in body && !('font' in body);
}

function migrateBody(body: Record<string, unknown>): Record<string, unknown> {
  const { fontFamily, ...rest } = body as { fontFamily?: unknown } & Record<string, unknown>;
  const family =
    typeof fontFamily === 'string' && fontFamily.length > 0
      ? fontFamily
      : "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return { ...rest, font: { family } };
}

function needsV1toV2(raw: Record<string, unknown>): boolean {
  const isV1 = raw.version === 1 || raw.version === undefined;
  const missingSection =
    !('cover' in raw) || !('headings' in raw) || bodyNeedsMigration(raw.body);
  return isV1 && missingSection;
}

function migrateV1toV2(raw: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw, version: 2 };
  if (bodyNeedsMigration(raw.body)) {
    next.body = migrateBody(raw.body as Record<string, unknown>);
  }
  if (!('cover' in raw)) {
    next.cover = { enabled: false, applyHeaderFooter: false, elements: [] };
  }
  if (!('headings' in raw)) {
    next.headings = {
      h1: { color: '#111111', bold: true, fontSizePt: 20 },
      h2: { color: '#111111', bold: true, fontSizePt: 16 },
      h3: { color: '#111111', bold: true, fontSizePt: 13 },
    };
  }
  return next;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function migrateTemplateJson(raw: unknown): { data: unknown; changed: boolean } {
  if (!isObject(raw)) return { data: raw, changed: false };

  let current: Record<string, unknown> = raw;
  let changed = false;

  // v0 (zones) → v1 (elements) — passo original
  const headerLegacy = bandNeedsMigration(current.header);
  const footerLegacy = bandNeedsMigration(current.footer);
  if (headerLegacy || footerLegacy) {
    current = { ...current };
    if (headerLegacy) current.header = migrateBand(current.header as Record<string, unknown>);
    if (footerLegacy) current.footer = migrateBand(current.footer as Record<string, unknown>);
    changed = true;
  }

  // v1 → v2 (body.font, cover, headings)
  if (needsV1toV2(current)) {
    current = migrateV1toV2(current);
    changed = true;
  }

  return { data: current, changed };
}
