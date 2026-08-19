import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  TemplateSchema,
  type Template,
  type TemplateInput,
  type TemplateSummary,
} from '../domain/template.js';
import { assertSafeId, readJsonIfExists, removeIfExists, writeFileAtomic } from './fsUtil.js';

export interface TemplateRepo {
  create(input: TemplateInput): Promise<Template>;
  get(id: string): Promise<Template | null>;
  list(): Promise<TemplateSummary[]>;
  update(id: string, input: TemplateInput): Promise<Template | null>;
  remove(id: string): Promise<boolean>;
}

/** Persistência de templates como um JSON por arquivo. */
export function createTemplateRepo(dir: string): TemplateRepo {
  const fileOf = (id: string) => {
    assertSafeId(id, 'tpl');
    return path.join(dir, `${id}.json`);
  };

  async function save(template: Template): Promise<Template> {
    const validated = TemplateSchema.parse(template);
    await writeFileAtomic(fileOf(validated.id), JSON.stringify(validated, null, 2));
    return validated;
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      return save({ ...input, id: `tpl_${nanoid(12)}`, version: 1, createdAt: now, updatedAt: now });
    },

    async get(id) {
      const raw = await readJsonIfExists<unknown>(fileOf(id));
      if (raw === null) return null;
      return TemplateSchema.parse(raw);
    },

    async list() {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }

      const summaries: TemplateSummary[] = [];
      for (const entry of entries) {
        if (!entry.startsWith('tpl_') || !entry.endsWith('.json')) continue;
        // Um arquivo corrompido (JSON inválido ou fora do schema) não deve
        // impedir de listar os demais.
        try {
          const raw = await readJsonIfExists<unknown>(path.join(dir, entry));
          const parsed = TemplateSchema.safeParse(raw);
          if (!parsed.success) continue;
          const { id, name, createdAt, updatedAt } = parsed.data;
          summaries.push({ id, name, createdAt, updatedAt });
        } catch {
          continue;
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async update(id, input) {
      const existing = await this.get(id);
      if (!existing) return null;
      return save({
        ...input,
        id: existing.id,
        version: 1,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
    },

    async remove(id) {
      return removeIfExists(fileOf(id));
    },
  };
}
