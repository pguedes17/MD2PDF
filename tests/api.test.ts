import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { createFontRepo } from '../src/storage/fontRepo.js';
import { createOutputStore } from '../src/storage/outputStore.js';
import { createPdfService } from '../src/render/pdf.js';
import { makeBlankTemplateInput } from '../src/domain/template.js';
import { readPdf } from './helpers/readPdf.js';

let app: FastifyInstance;
let dir: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Corpo multipart montado à mão — evita mais uma dependência só para o teste. */
function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----md2pdftest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Multipart com campos de texto ANTES do arquivo (ordem importa em alguns parsers). */
function multipartWithField(
  fileField: string, filename: string, contentType: string, data: Buffer,
  textFields: Record<string, string>,
) {
  const boundary = '----md2pdftest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(textFields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-api-'));
  app = buildApp({
    templateRepo: createTemplateRepo(path.join(dir, 'templates')),
    assetRepo: createAssetRepo(path.join(dir, 'assets')),
    fontRepo: createFontRepo(path.join(dir, 'fonts')),
    outputStore: createOutputStore(path.join(dir, 'outputs')),
    pdfService: createPdfService(),
    logger: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function createTemplate(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/templates',
    payload: { ...makeBlankTemplateInput('Contrato'), ...overrides },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('GET /health', () => {
  it('responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('/api/templates', () => {
  it('cria e devolve 201 com o id gerado', async () => {
    const created = await createTemplate();
    expect(created.id).toMatch(/^tpl_/);
    expect(created.name).toBe('Contrato');
  });

  it('rejeita template inválido com 400 e a lista de problemas', async () => {
    const bad = makeBlankTemplateInput('X');
    bad.page.margins.top = 1; // menor que a faixa do header
    const res = await app.inject({ method: 'POST', url: '/api/templates', payload: bad });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation_failed');
    expect(body.issues.some((i: { path: string }) => i.path === 'page.margins.top')).toBe(true);
  });

  it('lista, lê, atualiza e remove', async () => {
    const created = await createTemplate();

    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json().some((t: { id: string }) => t.id === created.id)).toBe(true);

    const got = await app.inject({ method: 'GET', url: `/api/templates/${created.id}` });
    expect(got.json().id).toBe(created.id);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: makeBlankTemplateInput('Renomeado'),
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe('Renomeado');
    expect(updated.json().createdAt).toBe(created.createdAt);

    const removed = await app.inject({ method: 'DELETE', url: `/api/templates/${created.id}` });
    expect(removed.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/api/templates/${created.id}` });
    expect(after.statusCode).toBe(404);
  });

  it('devolve 400 para id fora do formato em vez de tocar o disco', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/templates/..%2F..%2Fetc' });
    expect(res.statusCode).toBe(400);
  });

  it('preview devolve um PDF', async () => {
    const created = await createTemplate();
    const res = await app.inject({ method: 'POST', url: `/api/templates/${created.id}/preview` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('duplica um template com novo id, timestamps e nome "(cópia)"', async () => {
    const original = await createTemplate({ name: 'Original' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${original.id}/duplicate`,
    });
    expect(res.statusCode, res.body).toBe(201);
    const copy = res.json();
    expect(copy.id).toMatch(/^tpl_/);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Original (cópia)');
    expect(copy.page).toEqual(original.page);
    expect(copy.header).toEqual(original.header);
    expect(copy.footer).toEqual(original.footer);
    // Timestamps novos — não copia dos do original.
    expect(copy.createdAt >= original.createdAt).toBe(true);

    // Ambos aparecem na listagem.
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    const ids = list.json().map((t: { id: string }) => t.id);
    expect(ids).toContain(original.id);
    expect(ids).toContain(copy.id);
  });

  it('duplicate devolve 404 quando template não existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/tpl_naoexiste/duplicate',
    });
    expect(res.statusCode).toBe(404);
  });

  it('exporta como bundle JSON auto-contido', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets',
      ...multipart('file', 'logo.png', 'image/png', PNG),
    });
    const { assetId } = upload.json();

    const created = await createTemplate({
      name: 'Exportável',
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId, heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/templates/${created.id}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toContain('attachment');
    const bundle = res.json();
    expect(bundle.template.name).toBe('Exportável');
    expect(bundle.template.id).toBeUndefined();
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0].assetId).toBe(assetId);
    expect(Buffer.from(bundle.assets[0].dataBase64, 'base64').equals(PNG)).toBe(true);
  });

  it('importa um bundle e cria template com id novo + assets novos', async () => {
    const bundle = {
      template: {
        ...makeBlankTemplateInput('Importado'),
        header: {
          heightMm: 20,
          elements: [
            { type: 'image', assetId: 'ast_old', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
          ],
        },
      },
      assets: [
        { assetId: 'ast_old', mime: 'image/png', originalName: 'l.png', dataBase64: PNG.toString('base64') },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/import',
      payload: bundle,
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json();
    expect(created.id).toMatch(/^tpl_/);
    expect(created.header.elements[0].assetId).toMatch(/^ast_/);
    expect(created.header.elements[0].assetId).not.toBe('ast_old');

    // template importado aparece na listagem
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json().some((t: { id: string }) => t.id === created.id)).toBe(true);
  });

  it('recusa bundle inválido com 400 + issues', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/import',
      payload: { template: { name: '' }, assets: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });
});

describe('/api/assets', () => {
  it('sobe uma imagem e devolve depois', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets',
      ...multipart('file', 'logo.png', 'image/png', PNG),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const { assetId, mime, bytes } = upload.json();
    expect(assetId).toMatch(/^ast_/);
    expect(mime).toBe('image/png');
    expect(bytes).toBe(PNG.byteLength);

    const get = await app.inject({ method: 'GET', url: `/api/assets/${assetId}` });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(Buffer.from(get.rawPayload).equals(PNG)).toBe(true);
  });

  it('recusa arquivo que não é imagem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      ...multipart('file', 'x.exe', 'application/octet-stream', PNG),
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 para asset inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/assets/ast_naoexiste' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/convert', () => {
  let templateId: string;

  beforeEach(async () => {
    if (templateId) return;
    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets',
      ...multipart('file', 'logo.png', 'image/png', PNG),
    });
    const { assetId } = upload.json();

    const template = await createTemplate({
      name: 'Papel timbrado',
      header: {
        heightMm: 22,
        elements: [
          { type: 'image', assetId, heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
          { type: 'text', value: 'Cliente {{cliente}}', align: 'center', xOffsetMm: 0, yMm: 0 },
        ],
      },
      footer: {
        heightMm: 15,
        elements: [
          { type: 'pageNumber', format: 'Pag {page} de {total}', align: 'right', xOffsetMm: 0, yMm: 0 },
        ],
      },
      page: { format: 'A4', orientation: 'portrait', margins: { top: 32, right: 20, bottom: 25, left: 20 } },
    });
    templateId = template.id;
  });

  it('devolve o PDF binário por padrão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Oi\n\nCorpo.', templateId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('usa o filename informado no Content-Disposition', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Oi', templateId, filename: 'contrato-2026.pdf' },
    });
    expect(res.headers['content-disposition']).toContain('contrato-2026.pdf');
  });

  it('devolve JSON com base64 e metadados quando pedido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers: { accept: 'application/json' },
      payload: { markdown: 'Um\n\n<!-- pagebreak -->\n\nDois', templateId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pages).toBe(2);
    expect(body.templateId).toBe(templateId);
    expect(body.bytes).toBeGreaterThan(0);
    const pdf = Buffer.from(body.pdfBase64, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBe(body.bytes);
  });

  it('aplica as variáveis do request no header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Doc', templateId, variables: { cliente: 'ACME LOGISTICA' } },
    });
    const parsed = await readPdf(Buffer.from(res.rawPayload));
    expect(parsed.text).toContain('Cliente ACME LOGISTICA');
  });

  it('404 quando o template não existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Oi', templateId: 'tpl_naoexiste' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('template_not_found');
  });

  it('400 quando o markdown está vazio', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '   ', templateId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('grava em disco quando `output: "path"` e devolve o caminho absoluto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: {
        markdown: '# Doc\n\nCorpo.',
        templateId,
        output: 'path',
        filename: 'contrato.pdf',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.templateId).toBe(templateId);
    expect(body.pages).toBeGreaterThanOrEqual(1);
    expect(body.bytes).toBeGreaterThan(0);
    expect(body.filename).toMatch(/^contrato-\d{8}T\d{6}-[0-9a-f]{6}\.pdf$/);
    expect(path.isAbsolute(body.path)).toBe(true);
    // O arquivo existe e é um PDF de verdade.
    const buf = await fs.readFile(body.path);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.byteLength).toBe(body.bytes);
    // E fica dentro do outputs dir do server.
    expect(path.dirname(body.path)).toBe(path.resolve(dir, 'outputs'));
  });

  it('resposta com `output: "path"` inclui `fileUri` no formato file:// apontando pro mesmo arquivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: {
        markdown: '# Doc\n\nCorpo.',
        templateId,
        output: 'path',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(typeof body.fileUri).toBe('string');
    expect(body.fileUri.startsWith('file://')).toBe(true);
    // fileURLToPath do fileUri precisa bater exatamente com o path.
    const { fileURLToPath } = await import('node:url');
    expect(fileURLToPath(body.fileUri)).toBe(body.path);
  });

  it('aceita `markdownPath` como alternativa a `markdown` e lê o arquivo do disco', async () => {
    const mdFile = path.join(dir, 'inline-test.md');
    await fs.writeFile(mdFile, '# Do disco\n\nEste texto veio de um arquivo lido pelo servidor.', 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: {
        markdownPath: mdFile,
        templateId,
        output: 'path',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.pages).toBeGreaterThanOrEqual(1);
    expect(body.bytes).toBeGreaterThan(0);
  });

  it('recusa quando faltam `markdown` e `markdownPath` — validation_failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { templateId, output: 'path' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });

  it('recusa quando os dois vêm juntos — validation_failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: {
        templateId,
        output: 'path',
        markdown: '# oi',
        markdownPath: '/tmp/qualquer.md',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });

  it('`markdownPath` inexistente devolve 400 com markdown_read_failed', async () => {
    const missing = path.join(dir, 'nao-existe.md');
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { templateId, output: 'path', markdownPath: missing },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('markdown_read_failed');
    expect(res.json().message).toContain('não encontrado');
  });

  it('`markdownPath` relativo é rejeitado antes de tentar ler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { templateId, output: 'path', markdownPath: 'relativo.md' },
    });
    expect(res.statusCode).toBe(400);
    // Vem da validação Zod (validation_failed via app.ts error handler).
    expect(res.json().error).toBe('validation_failed');
  });

  it('422 quando o template aponta para um asset que sumiu', async () => {
    const orphan = await createTemplate({
      name: 'Órfão',
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_sumiu', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Oi', templateId: orphan.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('asset_not_found');
  });
});

describe('/api/fonts', () => {
  it('POST + GET fluxo básico', async () => {
    const ttf = Buffer.alloc(64, 0);
    const mp = multipartWithField('file', 'MinhaFonte.ttf', 'font/ttf', ttf, { family: 'MinhaFonte, sans-serif' });
    const create = await app.inject({ method: 'POST', url: '/api/fonts', payload: mp.payload, headers: mp.headers });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.fontId).toMatch(/^fnt_/);

    const list = await app.inject({ method: 'GET', url: '/api/fonts' });
    expect(list.statusCode).toBe(200);
    expect(list.json().find((f: any) => f.fontId === created.fontId)).toBeDefined();

    const data = await app.inject({ method: 'GET', url: `/api/fonts/${created.fontId}/data-uri` });
    expect(data.statusCode).toBe(200);
    expect(data.json().dataUri.startsWith('data:font/ttf;base64,')).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/api/fonts/${created.fontId}` });
    expect(del.statusCode).toBe(204);
  });

  it('POST recusa tipo inválido', async () => {
    const mp = multipartWithField('file', 'x.exe', 'application/octet-stream', Buffer.from('lixo'), { family: 'X' });
    const res = await app.inject({ method: 'POST', url: '/api/fonts', payload: mp.payload, headers: mp.headers });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE devolve 409 quando a fonte está referenciada por um template', async () => {
    // 1. Upload da fonte
    const ttf = Buffer.alloc(64, 0);
    const mp = multipartWithField('file', 'FonteReferenciada.ttf', 'font/ttf', ttf, { family: 'FonteReferenciada, sans-serif' });
    const create = await app.inject({ method: 'POST', url: '/api/fonts', payload: mp.payload, headers: mp.headers });
    expect(create.statusCode, create.body).toBe(201);
    const { fontId } = create.json();

    // 2. Cria template que referencia a fonte via body.font.customFontId
    const tpl = await createTemplate({ body: { font: { customFontId: fontId, family: 'FonteReferenciada, sans-serif' } } });
    expect(tpl.id).toMatch(/^tpl_/);

    // 3. Tenta apagar a fonte — deve receber 409 font_in_use
    const del = await app.inject({ method: 'DELETE', url: `/api/fonts/${fontId}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('font_in_use');

    // 4. Verifica que a fonte ainda existe
    const list = await app.inject({ method: 'GET', url: '/api/fonts' });
    expect(list.json().find((f: any) => f.fontId === fontId)).toBeDefined();
  });
});
