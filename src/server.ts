import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createTemplateRepo } from './storage/templateRepo.js';
import { createAssetRepo } from './storage/assetRepo.js';
import { createPdfService } from './render/pdf.js';

/** Página servida quando a API está de pé mas o editor ainda não foi compilado. */
const EDITOR_NAO_COMPILADO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>MD2PDF — editor não compilado</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0d1620; color:#dbe4ea; font:15px/1.6 system-ui, sans-serif; }
  main { max-width: 46ch; padding: 32px; }
  h1 { font-size:19px; font-weight:600; margin:0 0 10px; letter-spacing:-0.01em; }
  p { color:#8697a3; margin:0 0 16px; }
  pre { background:#1c2a36; border:1px solid #253643; border-radius:7px;
        padding:12px 14px; overflow-x:auto; font-size:13px; color:#dbe4ea; margin:0 0 16px; }
  code { font-family: ui-monospace, Consolas, monospace; }
  a { color:#3fc6d1; }
</style></head>
<body><main>
  <h1>A API está no ar. O editor ainda não foi compilado.</h1>
  <p>Os arquivos do editor são gerados no build e não vêm no repositório. Rode:</p>
  <pre><code>npm run build:web</code></pre>
  <p>Depois recarregue esta página. Para desenvolver o editor com recarga
     automática, use <code>npm run dev:web</code> e abra
     <a href="http://localhost:5173">localhost:5173</a>.</p>
  <p>A API em si já está funcionando — teste com
     <a href="/health">/health</a>.</p>
</main></body></html>`;

const pdfService = createPdfService();

const app = buildApp({
  templateRepo: createTemplateRepo(config.storage.templates),
  assetRepo: createAssetRepo(config.storage.assets),
  pdfService,
});

// Em produção o mesmo processo serve o editor já compilado; em dev o Vite cuida
// disso na porta 5173.
const webDist = path.resolve(process.cwd(), 'web', 'dist');
const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));

if (hasWeb) {
  await app.register(fastifyStatic, { root: webDist });
}

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'not_found', message: 'rota inexistente' });
  }
  if (hasWeb) {
    // SPA: qualquer rota não-API devolve o index e o roteamento acontece no browser.
    return reply.sendFile('index.html');
  }
  // Um 404 seco aqui só gera confusão: o editor não está faltando, está por
  // compilar. A resposta diz o que fazer.
  return reply.code(503).type('text/html; charset=utf-8').send(EDITOR_NAO_COMPILADO);
});

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
