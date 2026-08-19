import { z } from 'zod';
import {
  TemplateInputSchema,
  type Template,
  type TemplateElement,
  type TemplateInput,
} from './template.js';
import { ALLOWED_IMAGE_MIME, type AssetRepo } from '../storage/assetRepo.js';
import type { TemplateRepo } from '../storage/templateRepo.js';

/**
 * Bundle portátil: um template + os binários dos assets que ele referencia,
 * empacotados como base64 no mesmo JSON. Serve tanto para "levar um template
 * para outra instalação" quanto para backup/versionamento fora do storage.
 *
 * Os `assetId` dentro do bundle são os IDs originais (do ambiente onde o
 * bundle foi gerado). Na importação, a gente cria assets novos, mapeia os
 * IDs antigos para os novos, e reescreve as referências antes de persistir
 * o template.
 */

const allowedMimes = Object.keys(ALLOWED_IMAGE_MIME) as [string, ...string[]];

const BundleAssetSchema = z.object({
  assetId: z.string().min(1),
  mime: z.enum(allowedMimes),
  originalName: z.string().default('asset'),
  dataBase64: z.string().min(1),
});

export const TemplateBundleSchema = z.object({
  template: TemplateInputSchema,
  assets: z.array(BundleAssetSchema).default([]),
});

export type TemplateBundleAsset = z.infer<typeof BundleAssetSchema>;
export type TemplateBundle = z.infer<typeof TemplateBundleSchema>;

/** Percorre header/footer coletando os assetIds referenciados. */
function referencedAssetIds(template: TemplateInput | Template): string[] {
  const ids = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const el of band.elements) {
      if (el.type === 'image' && el.assetId) ids.add(el.assetId);
    }
  }
  return [...ids];
}

/** Constrói o bundle a partir de um template já persistido e do assetRepo.
 *  Assets referenciados mas ausentes são simplesmente omitidos — quem
 *  importar recebe o template com a referência quebrada (mesmo estado em
 *  que ele estaria se salvasse sem enviar a imagem). */
export async function buildTemplateBundle(
  template: Template,
  assetRepo: AssetRepo,
): Promise<TemplateBundle> {
  // Remove id/timestamps: o servidor gera na importação.
  const { id: _id, version: _v, createdAt: _c, updatedAt: _u, ...rest } = template;
  void _id;
  void _v;
  void _c;
  void _u;

  const assets: TemplateBundleAsset[] = [];
  for (const assetId of referencedAssetIds(template)) {
    const found = await assetRepo.get(assetId);
    if (!found) continue;
    assets.push({
      assetId,
      mime: found.meta.mime,
      originalName: found.meta.originalName,
      dataBase64: found.data.toString('base64'),
    });
  }

  return { template: rest, assets };
}

/** Reescreve os assetIds do template segundo o mapa `antigo → novo`. */
function remapAssetIds(template: TemplateInput, map: Map<string, string>): TemplateInput {
  const remap = (el: TemplateElement): TemplateElement => {
    if (el.type !== 'image') return el;
    const next = map.get(el.assetId);
    return next ? { ...el, assetId: next } : el;
  };
  return {
    ...template,
    header: { ...template.header, elements: template.header.elements.map(remap) },
    footer: { ...template.footer, elements: template.footer.elements.map(remap) },
  };
}

export interface ImportBundleDeps {
  assetRepo: AssetRepo;
  templateRepo: TemplateRepo;
}

/** Importa um bundle: valida, recria assets, remapeia referências, cria template. */
export async function importTemplateBundle(
  bundle: TemplateBundle,
  deps: ImportBundleDeps,
): Promise<Template> {
  const parsed = TemplateBundleSchema.parse(bundle);

  // Salva cada asset e monta o mapa antigo→novo.
  const map = new Map<string, string>();
  for (const asset of parsed.assets) {
    const meta = await deps.assetRepo.save({
      originalName: asset.originalName,
      mime: asset.mime,
      data: Buffer.from(asset.dataBase64, 'base64'),
    });
    map.set(asset.assetId, meta.id);
  }

  const rewritten = remapAssetIds(parsed.template, map);
  return deps.templateRepo.create(rewritten);
}
