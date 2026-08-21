import type { Template } from './template.js';

/**
 * Todos os assetIds que um template referencia — header, footer e capa.
 * Fonte única para GC pós-delete e futuras auditorias de integridade.
 */
export function collectTemplateAssetIds(template: Template): Set<string> {
  const ids = new Set<string>();
  for (const el of template.header.elements) if (el.type === 'image') ids.add(el.assetId);
  for (const el of template.footer.elements) if (el.type === 'image') ids.add(el.assetId);
  for (const el of template.cover.elements) if (el.type === 'image') ids.add(el.assetId);
  return ids;
}
