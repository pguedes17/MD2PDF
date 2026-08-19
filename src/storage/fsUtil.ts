import fs from 'node:fs/promises';
import path from 'node:path';

/** Ids vão direto para o caminho do arquivo; qualquer coisa fora disso é travessia de diretório. */
export function assertSafeId(id: string, prefix: string): void {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`).test(id)) {
    throw Object.assign(new Error(`id inválido: ${id}`), { statusCode: 400 });
  }
}

/** Grava em .tmp e renomeia: um crash no meio da escrita não deixa JSON pela metade. */
export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function removeIfExists(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
