import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countPdfPages } from '../render/pdfInfo.js';
import type { AppDeps } from '../app.js';
import { parseOrThrow } from './validation.js';

const ConvertBody = z.object({
  markdown: z.string().trim().min(1, 'markdown não pode ser vazio'),
  templateId: z.string().min(1),
  variables: z.record(z.string(), z.string()).optional(),
  filename: z.string().min(1).max(200).optional(),
});

/** Nome de arquivo seguro para o Content-Disposition. */
function safeFilename(requested: string | undefined, fallback: string): string {
  const base = (requested ?? fallback).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export async function convertRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/convert', async (request, reply) => {
    const body = parseOrThrow(ConvertBody, request.body);
    const { pdf, template } = await deps.conversionService.convert(body);
    const filename = safeFilename(body.filename, template.name);

    // Binário é o caminho comum; base64 só quando o cliente pede JSON, porque
    // ele infla o corpo em cerca de um terço.
    const wantsJson = (request.headers.accept ?? '').includes('application/json');
    if (!wantsJson) {
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(pdf);
    }

    return reply.send({
      filename,
      templateId: template.id,
      pages: await countPdfPages(pdf),
      bytes: pdf.byteLength,
      pdfBase64: pdf.toString('base64'),
    });
  });
}
