import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TemplateInputSchema } from '../domain/template.js';
import { TemplateNotFoundError } from '../conversion.js';
import type { AppDeps } from '../app.js';
import { parseOrThrow } from './validation.js';

const PreviewBody = z.object({ markdown: z.string().optional() }).optional();

/** Markdown de demonstração do preview: exercita título, tabela e quebra de página. */
const SAMPLE_MARKDOWN = `# Documento de exemplo

Este texto existe só para você conferir a **identidade visual** do template:
cabeçalho, rodapé, numeração e margens.

## Uma tabela

| Item | Quantidade | Valor |
|------|-----------:|------:|
| Alfa | 12 | R$ 1.200,00 |
| Beta | 3 | R$ 450,00 |

> Uma citação, para ver o espaçamento do corpo.

<!-- pagebreak -->

## Segunda página

O comentário \`<!-- pagebreak -->\` força a quebra. Sem ele, o conteúdo
simplesmente flui até encher a página.
`;

export async function templateRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/templates', async () => deps.templateRepo.list());

  app.get<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const template = await deps.templateRepo.get(request.params.id);
    if (!template) throw new TemplateNotFoundError(request.params.id);
    return reply.send(template);
  });

  app.post('/api/templates', async (request, reply) => {
    const input = parseOrThrow(TemplateInputSchema, request.body);
    return reply.code(201).send(await deps.templateRepo.create(input));
  });

  app.put<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const input = parseOrThrow(TemplateInputSchema, request.body);
    const updated = await deps.templateRepo.update(request.params.id, input);
    if (!updated) throw new TemplateNotFoundError(request.params.id);
    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const removed = await deps.templateRepo.remove(request.params.id);
    if (!removed) throw new TemplateNotFoundError(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/templates/:id/preview', async (request, reply) => {
    const template = await deps.templateRepo.get(request.params.id);
    if (!template) throw new TemplateNotFoundError(request.params.id);

    const body = parseOrThrow(PreviewBody, request.body ?? undefined);
    const markdown = body?.markdown?.trim() ? body.markdown : SAMPLE_MARKDOWN;
    const pdf = await deps.conversionService.convertWithTemplate(template, markdown);

    return reply
      .type('application/pdf')
      .header('content-disposition', 'inline; filename="preview.pdf"')
      .send(pdf);
  });
}
