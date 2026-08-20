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

const docxBuf = fsSync.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');

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
    const mp = multipart('file', 'bionexo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
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

describe('POST /api/templates/from-docx', () => {
  it('cria template a partir do docx real e devolve 201 com warnings', async () => {
    const mp = multipart('file', 'bionexo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/from-docx?name=Bionexo',
      payload: mp.payload,
      headers: mp.headers,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.template.id).toMatch(/^tpl_/);
    expect(body.template.name).toBe('Bionexo');
    expect(Array.isArray(body.warnings)).toBe(true);

    // Template aparece na listagem
    const list = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(list.json().some((t: { id: string }) => t.id === body.template.id)).toBe(true);
  });

  it('template gerado consegue produzir PDF via /api/convert', async () => {
    const mp = multipart('file', 'x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf);
    const created = await app.inject({ method: 'POST', url: '/api/templates/from-docx', payload: mp.payload, headers: mp.headers });
    const templateId = created.json().template.id;

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
