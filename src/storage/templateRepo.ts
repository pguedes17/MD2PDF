import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  TemplateSchema,
  type Template,
  type TemplateInput,
  type TemplateSummary,
} from '../domain/template.js';
import { migrateTemplateJson } from '../domain/templateMigration.js';
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

  /** Lê, migra (se preciso), valida, e grava de volta se a migração alterou algo —
   *  o disco converge para o formato novo na primeira leitura. */
  async function readAndMigrate(file: string): Promise<Template | null> {
    const raw = await readJsonIfExists<unknown>(file);
    if (raw === null) return null;
    const { data, changed } = migrateTemplateJson(raw);
    const validated = TemplateSchema.parse(data);
    if (changed) {
      await writeFileAtomic(file, JSON.stringify(validated, null, 2));
    }
    return validated;
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      return save({ ...input, id: `tpl_${nanoid(12)}`, version: 1, createdAt: now, updatedAt: now });
    },

    async get(id) {
      return readAndMigrate(fileOf(id));
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
          const template = await readAndMigrate(path.join(dir, entry));
          if (!template) continue;
          const { id, name, createdAt, updatedAt } = template;
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
