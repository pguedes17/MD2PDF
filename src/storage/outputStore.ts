import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Grava PDFs gerados em disco quando o cliente pede `output: "path"` na
 * conversão — o consumidor (tipicamente uma tool MCP) recebe o caminho
 * absoluto e abre o arquivo diretamente, sem precisar decodificar base64.
 *
 * A limpeza dos arquivos antigos é feita por um scheduler no `server.ts`.
 */

export interface OutputStore {
  /** Diretório onde os PDFs são gravados — exposto para logs e scheduler. */
  readonly dir: string;
  /** Grava o PDF sob um nome único (baseado no filename desejado) e devolve o caminho absoluto. */
  save(desiredFilename: string, pdf: Buffer): Promise<SavedOutput>;
  /** Apaga arquivos `.pdf` do diretório com mtime mais antigo que `ttlMs`. */
  cleanupOlderThan(ttlMs: number): Promise<{ deleted: number; scanned: number }>;
}

export interface SavedOutput {
  path: string;
  filename: string;
}

/** Aceita apenas `[A-Za-z0-9._-]`; troca o resto por `_`. Impede path traversal
 *  e caracteres problemáticos no sistema de arquivos. Sempre termina em `.pdf`. */
export function sanitizeFilename(requested: string | undefined, fallback: string): string {
  const raw = (requested ?? '').trim();
  const clean = raw
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  const base = clean || fallback;
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function timestamp(now = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

/** Sufixo aleatório curto — evita colisão entre duas gravações no mesmo segundo. */
function shortId(): string {
  return crypto.randomBytes(3).toString('hex');
}

export function createOutputStore(dir: string): OutputStore {
  return {
    dir,

    async save(desiredFilename, pdf) {
      const safe = sanitizeFilename(desiredFilename, 'documento.pdf');
      const base = safe.replace(/\.pdf$/i, '');
      const filename = `${base}-${timestamp()}-${shortId()}.pdf`;
      await fs.mkdir(dir, { recursive: true });
      const full = path.resolve(dir, filename);
      // Garante que a normalização não escapou do diretório (paranoia — o
      // sanitize já elimina separadores, mas o custo é zero).
      if (!full.startsWith(path.resolve(dir) + path.sep)) {
        throw new Error(`caminho resolveu para fora do output dir: ${full}`);
      }
      await fs.writeFile(full, pdf);
      return { path: full, filename };
    },

    async cleanupOlderThan(ttlMs) {
      if (ttlMs <= 0) return { deleted: 0, scanned: 0 };
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { deleted: 0, scanned: 0 };
        throw err;
      }

      const cutoff = Date.now() - ttlMs;
      let deleted = 0;
      let scanned = 0;
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.pdf')) continue;
        scanned++;
        const full = path.join(dir, entry);
        try {
          const stat = await fs.stat(full);
          if (!stat.isFile()) continue;
          if (stat.mtimeMs < cutoff) {
            await fs.unlink(full);
            deleted++;
          }
        } catch {
          // Concorrência: outro processo já mexeu no arquivo. Ignora.
        }
      }
      return { deleted, scanned };
    },
  };
}
