import { z } from 'zod';
import {
  TemplateInputSchema,
  type Template,
  type TemplateElement,
  type TemplateInput,
} from './template.js';
import { ALLOWED_IMAGE_MIME, type AssetRepo } from '../storage/assetRepo.js';
import { ALLOWED_FONT_MIMES, type FontRepo } from '../storage/fontRepo.js';
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

const allowedFontMimes = ALLOWED_FONT_MIMES;

const BundleFontSchema = z.object({
  fontId: z.string().min(1),
  family: z.string().min(1),
  originalName: z.string().default('font'),
  mimeType: z.enum(allowedFontMimes),
  dataBase64: z.string().min(1),
});

export const TemplateBundleSchema = z.object({
  template: TemplateInputSchema,
  assets: z.array(BundleAssetSchema).default([]),
  fonts: z.array(BundleFontSchema).default([]),
});

export type TemplateBundleAsset = z.infer<typeof BundleAssetSchema>;
export type BundleFont = z.infer<typeof BundleFontSchema>;
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
 *  que ele estaria se salvasse sem enviar a imagem).
 *  Fontes referenciadas via customFontId também são incluídas; se a fonte
 *  não for encontrada no repo, é silenciosamente omitida. */
export async function buildTemplateBundle(
  template: Template,
  assetRepo: AssetRepo,
  fontRepo: FontRepo,
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

  const fonts: BundleFont[] = [];
  const fontId = template.body?.font?.customFontId;
  if (fontId) {
    const found = await fontRepo.get(fontId);
    if (found) {
      fonts.push({
        fontId,
        family: found.meta.family,
        originalName: found.meta.filename,
        mimeType: found.meta.mimeType,
        dataBase64: found.data.toString('base64'),
      });
    }
  }

  return { template: rest, assets, fonts };
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
  fontRepo: FontRepo;
  templateRepo: TemplateRepo;
}

/** Importa um bundle: valida, recria assets e fontes, remapeia referências, cria template. */
export async function importTemplateBundle(
  bundle: TemplateBundle,
  deps: ImportBundleDeps,
): Promise<Template> {
  const parsed = TemplateBundleSchema.parse(bundle);

  // Salva cada asset e monta o mapa antigo→novo.
  const assetMap = new Map<string, string>();
  for (const asset of parsed.assets) {
    const meta = await deps.assetRepo.save({
      originalName: asset.originalName,
      mime: asset.mime,
      data: Buffer.from(asset.dataBase64, 'base64'),
    });
    assetMap.set(asset.assetId, meta.id);
  }

  // Salva cada fonte e monta o mapa antigo→novo.
  const fontMap = new Map<string, string>();
  for (const f of parsed.fonts) {
    const meta = await deps.fontRepo.save({
      originalName: f.originalName,
      declaredFamily: f.family,
      mime: f.mimeType,
      data: Buffer.from(f.dataBase64, 'base64'),
    });
    fontMap.set(f.fontId, meta.id);
  }

  let rewritten = remapAssetIds(parsed.template, assetMap);

  // Remapeia customFontId se necessário.
  const oldFontId = rewritten.body?.font?.customFontId;
  if (oldFontId && fontMap.has(oldFontId)) {
    rewritten = {
      ...rewritten,
      body: {
        ...rewritten.body,
        font: { ...rewritten.body.font, customFontId: fontMap.get(oldFontId)! },
      },
    };
  }

  return deps.templateRepo.create(rewritten);
}
