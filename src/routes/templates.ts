import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TemplateInputSchema } from '../domain/template.js';
import {
  buildTemplateBundle,
  importTemplateBundle,
  TemplateBundleSchema,
} from '../domain/templateBundle.js';
import { TemplateNotFoundError } from '../conversion.js';
import type { AppDeps } from '../app.js';
import { parseOrThrow } from './validation.js';

/** Nome do arquivo do bundle a partir do nome do template — só ASCII e - */
function bundleFilename(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `${slug || 'template'}.md2pdf.json`;
}

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

  // Importação de bundle portátil (template + assets). Vem antes de :id nos
  // paths porque a rota é específica; o radix do Fastify já resolve isso mas
  // deixo agrupada para leitura.
  app.post('/api/templates/import', async (request, reply) => {
    const bundle = parseOrThrow(TemplateBundleSchema, request.body);
    const created = await importTemplateBundle(bundle, {
      assetRepo: deps.assetRepo,
      templateRepo: deps.templateRepo,
    });
    return reply.code(201).send(created);
  });

  app.post<{ Params: { id: string } }>('/api/templates/:id/duplicate', async (request, reply) => {
    const source = await deps.templateRepo.get(request.params.id);
    if (!source) throw new TemplateNotFoundError(request.params.id);
    // Assets são imutáveis e endereçados por id — a cópia reusa os mesmos assetIds.
    // Só o metadata do template (id, timestamps, nome) muda.
    const { id: _srcId, version: _v, createdAt: _c, updatedAt: _u, ...input } = source;
    const copy = await deps.templateRepo.create({ ...input, name: `${source.name} (cópia)` });
    return reply.code(201).send(copy);
  });

  app.get<{ Params: { id: string } }>('/api/templates/:id/export', async (request, reply) => {
    const template = await deps.templateRepo.get(request.params.id);
    if (!template) throw new TemplateNotFoundError(request.params.id);
    const bundle = await buildTemplateBundle(template, deps.assetRepo);
    return reply
      .type('application/json')
      .header('content-disposition', `attachment; filename="${bundleFilename(template.name)}"`)
      .send(bundle);
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
