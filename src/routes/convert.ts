import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countPdfPages } from '../render/pdfInfo.js';
import type { AppDeps } from '../app.js';
import { parseOrThrow } from './validation.js';
import { sanitizeFilename } from '../storage/outputStore.js';

const ConvertBody = z.object({
  markdown: z.string().trim().min(1, 'markdown não pode ser vazio'),
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

export async function convertRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/convert', async (request, reply) => {
    const body = parseOrThrow(ConvertBody, request.body);
    const { pdf, template } = await deps.conversionService.convert(body);
    const filename = sanitizeFilename(body.filename, template.name);

    // `output` explícito vence; `accept: application/json` mantém a compatibilidade antiga com base64.
    const acceptJson = (request.headers.accept ?? '').includes('application/json');
    const mode: 'binary' | 'base64' | 'path' = body.output ?? (acceptJson ? 'base64' : 'binary');

    if (mode === 'path') {
      const saved = await deps.outputStore.save(filename, pdf);
      return reply.send({
        path: saved.path,
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
