import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppDeps } from '../app.js';

export async function assetRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/assets', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: config.maxAssetBytes } });
    if (!file) {
      return reply.code(400).send({ error: 'validation_failed', message: 'envie um arquivo no campo "file"' });
    }

    const data = await file.toBuffer();
    const meta = await deps.assetRepo.save({
      originalName: file.filename,
      mime: file.mimetype,
      data,
    });

    return reply.code(201).send({
      assetId: meta.id,
      mime: meta.mime,
      bytes: meta.bytes,
      originalName: meta.originalName,
      url: `/api/assets/${meta.id}`,
    });
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const asset = await deps.assetRepo.get(request.params.id);
    if (!asset) {
      return reply.code(404).send({ error: 'asset_not_found', message: 'asset não encontrado' });
    }
    return reply
      .type(asset.meta.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(asset.data);
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const removed = await deps.assetRepo.remove(request.params.id);
    if (!removed) {
      return reply.code(404).send({ error: 'asset_not_found', message: 'asset não encontrado' });
    }
    return reply.code(204).send();
  });
}
