import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { createFontRepo } from '../src/storage/fontRepo.js';
import { createOutputStore } from '../src/storage/outputStore.js';
import { createPdfService } from '../src/render/pdf.js';
import { readPdf } from './helpers/readPdf.js';

let app: FastifyInstance;
let dir: string;

const docxBuf = fsSync.readFileSync('tests/fixtures/docx/sample-requirements.docx');

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

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md2pdf-docx-'));
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

describe('POST /api/templates/analyze-docx', () => {
  it('devolve análise + warnings sem persistir template', async () => {
    const mp = multipart('file', 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const res = await app.inject({ method: 'POST', url: '/api/templates/analyze-docx', payload: mp.payload, headers: mp.headers });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.analysis).toBeTruthy();
    expect(['A4', 'Letter']).toContain(body.analysis.page.format);
    expect(Array.isArray(body.warnings)).toBe(true);

    // template não foi persistido
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json()).toEqual([]);
  });

  it('recusa upload sem arquivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/analyze-docx',
      payload: Buffer.from(''),
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/templates/from-docx via JSON docxPath (agente MCP)', () => {
  it('lê o arquivo do disco quando content-type é application/json', async () => {
    const absPath = path.resolve('tests/fixtures/docx/sample-requirements.docx');
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: { docxPath: absPath, name: 'Sample via path' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.template.id).toMatch(/^tpl_/);
    expect(body.template.name).toBe('Sample via path');
    // Mesmo conteúdo importado — deve ter header não-vazio + assets como no fluxo multipart
    expect(body.template.header.elements.length).toBeGreaterThanOrEqual(1);
    expect(body.assetIds.length).toBeGreaterThanOrEqual(1);
  });

  it('analyze-docx também aceita JSON docxPath', async () => {
    const absPath = path.resolve('tests/fixtures/docx/sample-requirements.docx');
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/analyze-docx',
      payload: { docxPath: absPath },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().analysis).toBeTruthy();
  });

  it('recusa docxPath relativo com 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: { docxPath: 'tests/fixtures/docx/sample-requirements.docx' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.some((i: { message: string }) => i.message.includes('absoluto'))).toBe(true);
  });

  it('recusa docxPath sem extensão .docx com 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: { docxPath: path.resolve('README.md') },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.some((i: { message: string }) => i.message.includes('.docx'))).toBe(true);
  });

  it('devolve 400 com mensagem clara quando arquivo não existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: { docxPath: path.resolve('tests/fixtures/docx/inexistente.docx') },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('docx_read_failed');
    expect(res.json().message).toContain('não encontrado');
  });

  it('content-type sem multipart nem json → 400 com mensagem instrutiva', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: 'lixo',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/multipart|docxPath/);
  });
});

describe('POST /api/templates/from-docx oversize', () => {
  it('rejeita upload acima do limite de tamanho', async () => {
    // 21 MB of zeros — size check should trip before docx parsing
    const oversizeBuf = Buffer.alloc(21 * 1024 * 1024, 0);
    const mp = multipart('file', 'big.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', oversizeBuf);
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx',
      payload: mp.payload,
      headers: mp.headers,
    });
    // Fastify bodyLimit (10 MB) or multipart fileSize limit (20 MB) will reject;
    // accept 413 (multipart FST_REQ_FILE_TOO_LARGE) or 400 (bodyLimit exceeded).
    expect([400, 413]).toContain(res.statusCode);
  });
});

describe('POST /api/templates/from-docx', () => {
  it('cria template a partir do docx real e devolve 201 com warnings', async () => {
    const mp = multipart('file', 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx?name=Sample',
      payload: mp.payload,
      headers: mp.headers,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.template.id).toMatch(/^tpl_/);
    expect(body.template.name).toBe('Sample');
    expect(Array.isArray(body.warnings)).toBe(true);

    // Template aparece na listagem
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json().some((t: { id: string }) => t.id === body.template.id)).toBe(true);
  });

  it('template gerado consegue produzir PDF via /api/convert', async () => {
    const mp = multipart('file', 'x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const created = await app.inject({ method: 'POST', url: '/api/templates/from-docx', payload: mp.payload, headers: mp.headers });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json();

    // sample fixture has a table-based header with logo + text → at least 1 element
    expect(body.template.header.elements.length).toBeGreaterThanOrEqual(1);
    // sample fixture logo image was uploaded as an asset
    expect(body.assetIds.length).toBeGreaterThanOrEqual(1);

    const templateId = body.template.id;
    const conv = await app.inject({
      method: 'POST',
      url: '/api/convert',
      payload: { markdown: '# Doc importado\n\nCorpo em markdown.', templateId },
    });
    expect(conv.statusCode, conv.body).toBe(200);
    expect(conv.headers['content-type']).toBe('application/pdf');
    const pdf = await readPdf(Buffer.from(conv.rawPayload));
    expect(pdf.pages.length).toBeGreaterThanOrEqual(1);
  });
});
