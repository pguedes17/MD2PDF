import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countPdfPages } from '../render/pdfInfo.js';
import type { AppDeps } from '../app.js';
import { parseOrThrow } from './validation.js';
import { sanitizeFilename } from '../storage/outputStore.js';

/**
 * Ou `markdown` inline, ou `markdownPath` — caminho absoluto para um `.md` no
 * host da API. `markdownPath` é a variante feita para agentes MCP que já têm
 * o conteúdo em disco (evita transferir arquivos grandes pelo pipeline do LLM).
 * A validação de "um dos dois" acontece no handler porque OpenAPI 3.0.3 / MCP
 * clients não conseguem expressar `oneOf` sem quebrar o mapper do oas2mcp.
 */
const ConvertBody = z.object({
  markdown: z.string().trim().min(1).optional(),
  markdownPath: z
    .string()
    .trim()
    .min(1)
    .refine((p) => path.isAbsolute(p), 'markdownPath precisa ser absoluto (ex.: C:/... ou /...)')
    .optional(),
  templateId: z.string().min(1),
  variables: z.record(z.string(), z.string()).optional(),
  filename: z.string().min(1).max(200).optional(),
  /**
   * Modo de resposta:
   * - `binary` (default): devolve o PDF direto — `application/pdf`.
   * - `base64`: devolve JSON com o PDF em base64. Também acionado pelo header `accept: application/json`.
   * - `path`: grava o PDF em `MD2PDF_OUTPUT_DIR` e devolve o caminho absoluto —
   *   feito para consumidores MCP que não conseguem lidar com binário na resposta.
   */
  output: z.enum(['binary', 'base64', 'path']).optional(),
});

/** Lê o `.md` do disco no host da API. Erros viram 400 com códigos estáveis. */
async function readMarkdownFromPath(mdPath: string): Promise<string> {
  try {
    const content = await fs.readFile(mdPath, 'utf8');
    if (!content.trim()) {
      throw Object.assign(new Error(`arquivo vazio: ${mdPath}`), {
        statusCode: 400,
        code: 'markdown_read_failed',
      });
    }
    return content;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { statusCode?: number; code?: string };
    if (e.statusCode) throw e; // já é um HttpishError nosso
    const detail =
      e.code === 'ENOENT' ? 'arquivo não encontrado'
      : e.code === 'EACCES' ? 'sem permissão de leitura'
      : e.code === 'EISDIR' ? 'o caminho é um diretório'
      : `falha ao ler o arquivo (${e.code ?? 'IO'})`;
    throw Object.assign(new Error(`${detail}: ${mdPath}`), {
      statusCode: 400,
      code: 'markdown_read_failed',
    });
  }
}

export async function convertRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/convert', async (request, reply) => {
    const body = parseOrThrow(ConvertBody, request.body);

    if (!body.markdown && !body.markdownPath) {
      throw Object.assign(new Error('informe `markdown` inline ou `markdownPath` (caminho absoluto no host da API)'), {
        statusCode: 400,
        code: 'validation_failed',
      });
    }
    if (body.markdown && body.markdownPath) {
      throw Object.assign(new Error('use apenas um: `markdown` OU `markdownPath` — não os dois'), {
        statusCode: 400,
        code: 'validation_failed',
      });
    }

    const markdown = body.markdown ?? (await readMarkdownFromPath(body.markdownPath!));
    const { pdf, template } = await deps.conversionService.convert({ ...body, markdown });
    const filename = sanitizeFilename(body.filename, template.name);

    // `output` explícito vence; `accept: application/json` mantém a compatibilidade antiga com base64.
    const acceptJson = (request.headers.accept ?? '').includes('application/json');
    const mode: 'binary' | 'base64' | 'path' = body.output ?? (acceptJson ? 'base64' : 'binary');

    if (mode === 'path') {
      const saved = await deps.outputStore.save(filename, pdf);
      return reply.send({
        path: saved.path,
        // `fileUri` complementa `path`: alguns harnesses MCP (Claude Code, Cursor)
        // auto-linkificam `file://` no output textual, virando um clique pra abrir.
        fileUri: pathToFileURL(saved.path).href,
        filename: saved.filename,
        templateId: template.id,
        pages: await countPdfPages(pdf),
        bytes: pdf.byteLength,
      });
    }

    if (mode === 'base64') {
      return reply.send({
        filename,
        templateId: template.id,
        pages: await countPdfPages(pdf),
        bytes: pdf.byteLength,
        pdfBase64: pdf.toString('base64'),
      });
    }

    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  });
}
