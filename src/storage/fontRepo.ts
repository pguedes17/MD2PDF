import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { assertSafeId, readJsonIfExists, removeIfExists, writeFileAtomic } from './fsUtil.js';

export const ALLOWED_FONT_MIMES = ['font/ttf', 'font/otf'] as const;
export type FontMime = typeof ALLOWED_FONT_MIMES[number];

const EXTS: Record<FontMime, string> = { 'font/ttf': 'ttf', 'font/otf': 'otf' };

export interface FontMeta {
  id: string;
  family: string;
  filename: string;
  mimeType: FontMime;
  size: number;
  createdAt: string;
}

export interface FontRepo {
  save(input: { originalName: string; declaredFamily: string; mime: string; data: Buffer }): Promise<FontMeta>;
  get(id: string): Promise<{ meta: FontMeta; data: Buffer } | null>;
  getDataUri(id: string): Promise<string | null>;
  remove(id: string): Promise<boolean>;
  list(): Promise<FontMeta[]>;
}

function normalizeMime(mime: string, filename: string): FontMime | null {
  if (mime === 'font/ttf' || mime === 'application/font-sfnt') return 'font/ttf';
  if (mime === 'font/otf') return 'font/otf';
  if (mime === 'application/octet-stream') {
    if (filename.toLowerCase().endsWith('.ttf')) return 'font/ttf';
    if (filename.toLowerCase().endsWith('.otf')) return 'font/otf';
  }
  return null;
}

export function createFontRepo(dir: string): FontRepo {
  const metaOf = (id: string) => {
    assertSafeId(id, 'fnt');
    return path.join(dir, `${id}.meta.json`);
  };
  const binOf = (meta: FontMeta) => path.join(dir, `${meta.id}.${EXTS[meta.mimeType]}`);

  return {
    async save({ originalName, declaredFamily, mime, data }) {
      const normalized = normalizeMime(mime, originalName);
      if (!normalized) {
        throw Object.assign(new Error(`tipo de fonte não suportado: ${mime}`), { statusCode: 400 });
      }
      if (!declaredFamily || declaredFamily.trim().length === 0) {
        throw Object.assign(new Error('campo "family" obrigatório'), { statusCode: 400 });
      }
      const meta: FontMeta = {
        id: `fnt_${nanoid(12)}`,
        family: declaredFamily.trim(),
        filename: originalName,
        mimeType: normalized,
        size: data.byteLength,
        createdAt: new Date().toISOString(),
      };
      await writeFileAtomic(binOf(meta), data);
      await writeFileAtomic(metaOf(meta.id), JSON.stringify(meta, null, 2));
      return meta;
    },

    async get(id) {
      const meta = await readJsonIfExists<FontMeta>(metaOf(id));
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
      return `data:${found.meta.mimeType};base64,${found.data.toString('base64')}`;
    },

    async remove(id) {
      const meta = await readJsonIfExists<FontMeta>(metaOf(id));
      if (!meta) return false;
      await removeIfExists(binOf(meta));
      return removeIfExists(metaOf(id));
    },

    async list() {
      let entries: string[];
      try { entries = await fs.readdir(dir); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
      const metas: FontMeta[] = [];
      for (const entry of entries) {
        if (!entry.startsWith('fnt_') || !entry.endsWith('.meta.json')) continue;
        try {
          const m = await readJsonIfExists<FontMeta>(path.join(dir, entry));
          if (m) metas.push(m);
        } catch { continue; }
      }
      return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
