import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppDeps } from '../app.js';

export async function fontRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/fonts', async (request, reply) => {
    const parts = request.parts({ limits: { fileSize: config.maxFontBytes } });
    let fileBuf: Buffer | null = null;
    let filename = '';
    let mime = '';
    let family = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename;
        mime = part.mimetype;
        fileBuf = await part.toBuffer();
      } else if (part.fieldname === 'family') {
        family = String(part.value ?? '');
      }
    }
    if (!fileBuf) return reply.code(400).send({ error: 'validation_failed', message: 'envie um arquivo no campo "file"' });

    const meta = await deps.fontRepo.save({
      originalName: filename, declaredFamily: family, mime, data: fileBuf,
    });
    return reply.code(201).send({
      fontId: meta.id, family: meta.family, filename: meta.filename, size: meta.size,
    });
  });

  app.get('/api/fonts', async () => {
    const list = await deps.fontRepo.list();
    return list.map((m) => ({
      fontId: m.id, family: m.family, filename: m.filename,
      size: m.size, createdAt: m.createdAt,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/fonts/:id', async (request, reply) => {
    const found = await deps.fontRepo.get(request.params.id);
    if (!found) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.type(found.meta.mimeType).send(found.data);
  });

  app.get<{ Params: { id: string } }>('/api/fonts/:id/data-uri', async (request, reply) => {
    const dataUri = await deps.fontRepo.getDataUri(request.params.id);
    if (!dataUri) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.send({ dataUri });
  });

  app.delete<{ Params: { id: string } }>('/api/fonts/:id', async (request, reply) => {
    const referenced = await isFontReferenced(deps, request.params.id);
    if (referenced) {
      return reply.code(409).send({
        error: 'font_in_use',
        message: 'fonte referenciada por pelo menos um template; remova a referência antes',
      });
    }
    const removed = await deps.fontRepo.remove(request.params.id);
    if (!removed) return reply.code(404).send({ error: 'font_not_found', message: 'fonte não encontrada' });
    return reply.code(204).send();
  });
}

async function isFontReferenced(deps: AppDeps, fontId: string): Promise<boolean> {
  const summaries = await deps.templateRepo.list();
  for (const s of summaries) {
    const t = await deps.templateRepo.get(s.id);
    if (t?.body.font?.customFontId === fontId) return true;
  }
  return false;
}
