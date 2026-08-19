import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOutputStore, sanitizeFilename } from '../src/storage/outputStore.js';

const PDF = Buffer.from('%PDF-1.4\n...\n%%EOF');

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-outputs-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('sanitizeFilename', () => {
  it('mantém letras, dígitos, ponto, hífen e underline', () => {
    expect(sanitizeFilename('Contrato_2026-01.pdf', 'x.pdf')).toBe('Contrato_2026-01.pdf');
  });

  it('troca separadores e caracteres perigosos por underline', () => {
    expect(sanitizeFilename('../etc/passwd.pdf', 'x.pdf')).toMatch(/^etc_passwd\.pdf$/);
    expect(sanitizeFilename('C:\\a\\b.pdf', 'x.pdf')).toMatch(/^C_a_b\.pdf$/);
  });

  it('força extensão .pdf sem duplicar quando já existe', () => {
    expect(sanitizeFilename('sem-extensao', 'x.pdf')).toBe('sem-extensao.pdf');
    // .PDF em caixa-alta já satisfaz a extensão, não deve virar .PDF.pdf
    expect(sanitizeFilename('contrato.PDF', 'x.pdf')).toBe('contrato.PDF');
  });

  it('cai no fallback quando vazio/inválido', () => {
    expect(sanitizeFilename('', 'documento.pdf')).toBe('documento.pdf');
    expect(sanitizeFilename('   ', 'documento.pdf')).toBe('documento.pdf');
    expect(sanitizeFilename(undefined, 'documento.pdf')).toBe('documento.pdf');
  });

  it('não deixa começar com ponto (arquivo escondido em unix)', () => {
    expect(sanitizeFilename('.htaccess', 'x.pdf').startsWith('.')).toBe(false);
  });
});

describe('createOutputStore.save', () => {
  it('grava o PDF e devolve caminho absoluto + filename único', async () => {
    const store = createOutputStore(dir);
    const first = await store.save('Contrato.pdf', PDF);
    const second = await store.save('Contrato.pdf', PDF);
    expect(path.isAbsolute(first.path)).toBe(true);
    expect(first.filename).not.toBe(second.filename); // sufixo aleatório evita colisão
    expect(await fs.readFile(first.path)).toEqual(PDF);
    expect(await fs.readFile(second.path)).toEqual(PDF);
  });

  it('cria o diretório se ainda não existir', async () => {
    const nested = path.join(dir, 'a', 'b', 'c');
    const store = createOutputStore(nested);
    const saved = await store.save('doc.pdf', PDF);
    expect(saved.path.startsWith(path.resolve(nested))).toBe(true);
  });

  it('rejeita filename que tenta escapar do dir (via sanitize)', async () => {
    const store = createOutputStore(dir);
    const saved = await store.save('../../../etc/passwd.pdf', PDF);
    // O sanitize troca separadores por underline, então o arquivo cai DENTRO do dir.
    expect(path.dirname(saved.path)).toBe(path.resolve(dir));
  });
});

describe('createOutputStore.cleanupOlderThan', () => {
  async function touch(file: string, mtime: Date) {
    await fs.utimes(file, mtime, mtime);
  }

  it('apaga só os arquivos com mtime além do TTL', async () => {
    const store = createOutputStore(dir);
    const old1 = await store.save('velho-a.pdf', PDF);
    const old2 = await store.save('velho-b.pdf', PDF);
    const fresh = await store.save('novo.pdf', PDF);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await touch(old1.path, twoHoursAgo);
    await touch(old2.path, twoHoursAgo);

    const oneHourTtl = 60 * 60 * 1000;
    const result = await store.cleanupOlderThan(oneHourTtl);
    expect(result.deleted).toBe(2);
    expect(result.scanned).toBe(3);

    await expect(fs.access(old1.path)).rejects.toThrow();
    await expect(fs.access(old2.path)).rejects.toThrow();
    await expect(fs.access(fresh.path)).resolves.toBeUndefined();
  });

  it('ignora arquivos que não são .pdf', async () => {
    const store = createOutputStore(dir);
    await fs.mkdir(dir, { recursive: true });
    const notPdf = path.join(dir, 'nota.txt');
    await fs.writeFile(notPdf, 'oi');
    await fs.utimes(notPdf, new Date(0), new Date(0));

    const result = await store.cleanupOlderThan(1000);
    expect(result.deleted).toBe(0);
    expect(result.scanned).toBe(0);
    await expect(fs.access(notPdf)).resolves.toBeUndefined();
  });

  it('devolve zero quando o dir não existe (ainda não gravamos nada)', async () => {
    const store = createOutputStore(path.join(dir, 'inexistente'));
    const result = await store.cleanupOlderThan(1000);
    expect(result).toEqual({ deleted: 0, scanned: 0 });
  });

  it('ttl 0 ou negativo desliga a limpeza (não apaga nada)', async () => {
    const store = createOutputStore(dir);
    const saved = await store.save('a.pdf', PDF);
    await fs.utimes(saved.path, new Date(0), new Date(0));
    expect((await store.cleanupOlderThan(0)).deleted).toBe(0);
    expect((await store.cleanupOlderThan(-1)).deleted).toBe(0);
    await expect(fs.access(saved.path)).resolves.toBeUndefined();
  });
});
