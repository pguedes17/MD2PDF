import path from 'node:path';
import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
import { analyzeDocx } from '../docx/analyze.js';
import { toTemplateInput } from '../docx/toTemplate.js';

/** JSON body shape aceito pelas rotas de import — usado por agentes MCP que preferem
 *  passar um caminho absoluto no host da API em vez de fazer upload multipart. */
const DocxPathBody = z.object({
  docxPath: z
    .string()
    .min(1, 'docxPath é obrigatório')
    .refine((p) => path.isAbsolute(p), 'docxPath precisa ser absoluto (ex.: C:/... ou /...)')
    .refine((p) => p.toLowerCase().endsWith('.docx'), 'docxPath precisa terminar em .docx'),
  name: z.string().trim().min(1).max(120).optional(),
});

/** Resolve o docx a partir de multipart OU JSON body. Devolve buffer + nome sugerido. */
async function readDocxFromRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ buf: Buffer; suggestedName: string; explicitName?: string } | null> {
  const contentType = request.headers['content-type'] ?? '';

  if (contentType.startsWith('multipart/')) {
    const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) {
      reply.code(400).send({ error: 'validation_failed', message: 'envie o docx no campo "file"' });
      return null;
    }
    const buf = await file.toBuffer();
    return { buf, suggestedName: file.filename.replace(/\.docx$/i, '') || 'Template importado' };
  }

  if (contentType.startsWith('application/json')) {
    const body = parseOrThrow(DocxPathBody, request.body);
    try {
      const buf = await fs.readFile(body.docxPath);
      const base = path.basename(body.docxPath).replace(/\.docx$/i, '') || 'Template importado';
      return { buf, suggestedName: base, explicitName: body.name };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      const msg = e.code === 'ENOENT' ? 'arquivo não encontrado' : e.code === 'EACCES' ? 'sem permissão de leitura' : `falha ao ler o arquivo (${e.code ?? 'IO'})`;
      reply.code(400).send({ error: 'docx_read_failed', message: `${msg}: ${body.docxPath}` });
      return null;
    }
  }

  reply.code(400).send({
    error: 'validation_failed',
    message: 'envie o docx como multipart/form-data (campo "file") ou application/json ({docxPath})',
  });
  return null;
}

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

  // Importação de docx — aceita multipart (browser) OU JSON com docxPath (agente MCP).
  app.post('/api/templates/analyze-docx', async (request, reply) => {
    const input = await readDocxFromRequest(request, reply);
    if (!input) return;
    const { analysis, warnings } = await analyzeDocx(input.buf, deps.assetRepo);
    return reply.send({ analysis, warnings });
  });

  app.post<{ Querystring: { name?: string } }>('/api/templates/from-docx', async (request, reply) => {
    const input = await readDocxFromRequest(request, reply);
    if (!input) return;
    const { analysis, warnings: analyzeWarnings } = await analyzeDocx(input.buf, deps.assetRepo);
    const name =
      input.explicitName?.trim() ||
      request.query.name?.trim() ||
      input.suggestedName;
    const { templateInput, warnings: mapWarnings } = toTemplateInput(analysis, name);
    const template = await deps.templateRepo.create(templateInput);
    return reply.code(201).send({
      template,
      warnings: [...analyzeWarnings, ...mapWarnings],
      assetIds: analysis.images.map((i) => i.assetId),
    });
  });

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
      fontRepo: deps.fontRepo,
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
    const bundle = await buildTemplateBundle(template, deps.assetRepo, deps.fontRepo);
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
