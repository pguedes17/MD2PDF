import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { assertSafeId, readJsonIfExists, removeIfExists, writeFileAtomic } from './fsUtil.js';

/** Só formatos que o Chromium embute com segurança via data: URI. */
export const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface AssetMeta {
  id: string;
  mime: string;
  bytes: number;
  originalName: string;
  createdAt: string;
}

export interface AssetRepo {
  save(input: { originalName: string; mime: string; data: Buffer }): Promise<AssetMeta>;
  get(id: string): Promise<{ meta: AssetMeta; data: Buffer } | null>;
  getDataUri(id: string): Promise<string | null>;
  remove(id: string): Promise<boolean>;
}

/** Cada asset vira dois arquivos: o binário e um .meta.json ao lado. */
export function createAssetRepo(dir: string): AssetRepo {
  const metaOf = (id: string) => {
    assertSafeId(id, 'ast');
    return path.join(dir, `${id}.meta.json`);
  };
  const binOf = (meta: AssetMeta) =>
    path.join(dir, `${meta.id}.${ALLOWED_IMAGE_MIME[meta.mime] ?? 'bin'}`);

  return {
    async save({ originalName, mime, data }) {
      if (!ALLOWED_IMAGE_MIME[mime]) {
        throw Object.assign(new Error(`tipo de imagem não suportado: ${mime}`), { statusCode: 400 });
      }
      const meta: AssetMeta = {
        id: `ast_${nanoid(12)}`,
        mime,
        bytes: data.byteLength,
        originalName,
        createdAt: new Date().toISOString(),
      };
      await writeFileAtomic(binOf(meta), data);
      await writeFileAtomic(metaOf(meta.id), JSON.stringify(meta, null, 2));
      return meta;
    },

    async get(id) {
      const meta = await readJsonIfExists<AssetMeta>(metaOf(id));
      if (!meta) return null;
      try {
        return { meta, data: await fs.readFile(binOf(meta)) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },

    async getDataUri(id) {
      const found = await this.get(id);
      if (!found) return null;
      return `data:${found.meta.mime};base64,${found.data.toString('base64')}`;
    },

    async remove(id) {
      const meta = await readJsonIfExists<AssetMeta>(metaOf(id));
      if (!meta) return false;
      await removeIfExists(binOf(meta));
      return removeIfExists(metaOf(id));
    },
  };
}
