import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createTemplateRepo } from './storage/templateRepo.js';
import { createAssetRepo } from './storage/assetRepo.js';
import { createPdfService } from './render/pdf.js';

const pdfService = createPdfService();

const app = buildApp({
  templateRepo: createTemplateRepo(config.storage.templates),
  assetRepo: createAssetRepo(config.storage.assets),
  pdfService,
});

// Em produção o mesmo processo serve o editor já compilado; em dev o Vite cuida
// disso na porta 5173 e este bloco simplesmente não existe.
const webDist = path.resolve(process.cwd(), 'web', 'dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found', message: 'rota inexistente' });
    }
    return reply.sendFile('index.html');
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info('encerrando...');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
