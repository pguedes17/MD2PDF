import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { makeBlankTemplateInput } from '../src/domain/template.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('templateRepo', () => {
  it('cria com id prefixado e timestamps', async () => {
    const repo = createTemplateRepo(dir);
    const t = await repo.create(makeBlankTemplateInput('Contrato'));
    expect(t.id).toMatch(/^tpl_[A-Za-z0-9_-]+$/);
    expect(t.name).toBe('Contrato');
    expect(Date.parse(t.createdAt)).not.toBeNaN();
    expect(t.updatedAt).toBe(t.createdAt);
  });

  it('lê de volta o que gravou', async () => {
    const repo = createTemplateRepo(dir);
    const created = await repo.create(makeBlankTemplateInput('Relatório'));
    expect(await repo.get(created.id)).toEqual(created);
  });

  it('devolve null para id inexistente', async () => {
    const repo = createTemplateRepo(dir);
    expect(await repo.get('tpl_naoexiste')).toBeNull();
  });

  it('lista resumos ordenados pelo mais recente', async () => {
    const repo = createTemplateRepo(dir);
    const a = await repo.create(makeBlankTemplateInput('A'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.create(makeBlankTemplateInput('B'));
    const list = await repo.list();
    expect(list.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(list[0]).not.toHaveProperty('header');
  });

  it('preserva id e createdAt no update, e avança updatedAt', async () => {
    const repo = createTemplateRepo(dir);
    const created = await repo.create(makeBlankTemplateInput('Antigo'));
    await new Promise((r) => setTimeout(r, 5));
    const updated = await repo.update(created.id, makeBlankTemplateInput('Novo'));
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(created.id);
    expect(updated!.name).toBe('Novo');
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(created.createdAt));
  });

  it('update em id inexistente devolve null', async () => {
    const repo = createTemplateRepo(dir);
    expect(await repo.update('tpl_nada', makeBlankTemplateInput())).toBeNull();
  });

  it('remove e some da listagem', async () => {
    const repo = createTemplateRepo(dir);
    const t = await repo.create(makeBlankTemplateInput());
    expect(await repo.remove(t.id)).toBe(true);
    expect(await repo.get(t.id)).toBeNull();
    expect(await repo.list()).toEqual([]);
    expect(await repo.remove(t.id)).toBe(false);
  });

  it('recusa id com travessia de diretório em vez de ler fora da pasta', async () => {
    const repo = createTemplateRepo(dir);
    await expect(repo.get('../../etc/passwd')).rejects.toThrow(/id inválido/i);
    await expect(repo.remove('tpl_a/../../b')).rejects.toThrow(/id inválido/i);
  });

  it('ignora arquivo corrompido na listagem em vez de derrubar tudo', async () => {
    const repo = createTemplateRepo(dir);
    const ok = await repo.create(makeBlankTemplateInput('Bom'));
    await fs.writeFile(path.join(dir, 'tpl_quebrado.json'), '{ nao é json', 'utf8');
    const list = await repo.list();
    expect(list.map((t) => t.id)).toEqual([ok.id]);
  });
});

describe('assetRepo', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('salva e relê o binário', async () => {
    const repo = createAssetRepo(dir);
    const meta = await repo.save({ originalName: 'logo.png', mime: 'image/png', data: png });
    expect(meta.id).toMatch(/^ast_[A-Za-z0-9_-]+$/);
    expect(meta.bytes).toBe(png.byteLength);

    const found = await repo.get(meta.id);
    expect(found!.data.equals(png)).toBe(true);
    expect(found!.meta.mime).toBe('image/png');
  });

  it('monta data URI embutível no header do PDF', async () => {
    const repo = createAssetRepo(dir);
    const meta = await repo.save({ originalName: 'logo.png', mime: 'image/png', data: png });
    const uri = await repo.getDataUri(meta.id);
    expect(uri!.startsWith('data:image/png;base64,')).toBe(true);
    expect(uri!.endsWith(png.toString('base64'))).toBe(true);
  });

  it('devolve null para asset inexistente', async () => {
    const repo = createAssetRepo(dir);
    expect(await repo.get('ast_nada')).toBeNull();
    expect(await repo.getDataUri('ast_nada')).toBeNull();
  });

  it('recusa mime fora da allowlist', async () => {
    const repo = createAssetRepo(dir);
    await expect(
      repo.save({ originalName: 'x.exe', mime: 'application/octet-stream', data: png }),
    ).rejects.toThrow(/tipo de imagem/i);
  });

  it('recusa id com travessia de diretório', async () => {
    const repo = createAssetRepo(dir);
    await expect(repo.get('../secret')).rejects.toThrow(/id inválido/i);
  });
});
