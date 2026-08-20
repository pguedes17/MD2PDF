import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTemplateRepo } from '../src/storage/templateRepo.js';
import { createAssetRepo } from '../src/storage/assetRepo.js';
import { createFontRepo } from '../src/storage/fontRepo.js';
import { makeBlankTemplateInput } from '../src/domain/template.js';
import {
  buildTemplateBundle,
  importTemplateBundle,
  TemplateBundleSchema,
  type TemplateBundle,
} from '../src/domain/templateBundle.js';

let dir: string;
let assetRepo: ReturnType<typeof createAssetRepo>;
let fontRepo: ReturnType<typeof createFontRepo>;
let templateRepo: ReturnType<typeof createTemplateRepo>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-'));
  assetRepo = createAssetRepo(path.join(dir, 'a'));
  fontRepo = createFontRepo(path.join(dir, 'f'));
  templateRepo = createTemplateRepo(path.join(dir, 't'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('TemplateBundleSchema', () => {
  it('aceita bundle mínimo (sem assets)', () => {
    const bundle: TemplateBundle = {
      template: makeBlankTemplateInput('X'),
      assets: [],
    };
    expect(TemplateBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it('rejeita bundle sem template', () => {
    expect(TemplateBundleSchema.safeParse({ assets: [] }).success).toBe(false);
  });

  it('rejeita asset com mime não suportado', () => {
    const bundle = {
      template: makeBlankTemplateInput('X'),
      assets: [{ assetId: 'ast_x', mime: 'application/pdf', originalName: 'x.pdf', dataBase64: 'AA' }],
    };
    expect(TemplateBundleSchema.safeParse(bundle).success).toBe(false);
  });
});

describe('buildTemplateBundle', () => {
  it('empacota template e assets referenciados', async () => {
    const asset = await assetRepo.save({ originalName: 'logo.png', mime: 'image/png', data: PNG });
    const template = await templateRepo.create({
      ...makeBlankTemplateInput('Com logo'),
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: asset.id, heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });

    const bundle = await buildTemplateBundle(template, assetRepo, fontRepo);
    expect(bundle.template.name).toBe('Com logo');
    // id/timestamps não aparecem no template do bundle (o servidor gera na importação)
    expect((bundle.template as Record<string, unknown>).id).toBeUndefined();
    expect((bundle.template as Record<string, unknown>).createdAt).toBeUndefined();

    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0]).toMatchObject({
      assetId: asset.id,
      mime: 'image/png',
      originalName: 'logo.png',
    });
    expect(Buffer.from(bundle.assets[0]!.dataBase64, 'base64').equals(PNG)).toBe(true);
  });

  it('omite assets que sumiram do repo em vez de estourar', async () => {
    const template = await templateRepo.create({
      ...makeBlankTemplateInput('Órfão'),
      header: {
        heightMm: 20,
        elements: [
          { type: 'image', assetId: 'ast_naoexiste', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
        ],
      },
    });

    const bundle = await buildTemplateBundle(template, assetRepo, fontRepo);
    expect(bundle.assets).toEqual([]);
    // a referência quebrada continua no template — quem importar vai receber
    // um assetId que ainda precisa ser resolvido.
    const el = bundle.template.header.elements[0]!;
    expect(el.type === 'image' && el.assetId).toBe('ast_naoexiste');
  });

  it('bundle sem imagens tem assets vazio', async () => {
    const template = await templateRepo.create(makeBlankTemplateInput('Sem imagem'));
    const bundle = await buildTemplateBundle(template, assetRepo, fontRepo);
    expect(bundle.assets).toEqual([]);
  });

  it('bundle inclui fonte quando o template referencia customFontId', async () => {
    const meta = await fontRepo.save({ originalName: 'x.ttf', declaredFamily: 'F, sans', mime: 'font/ttf', data: Buffer.alloc(32, 1) });
    const t = makeBlankTemplateInput() as any;
    t.body.font = { family: 'F, sans', customFontId: meta.id };
    const template = await templateRepo.create(t);

    const bundle = await buildTemplateBundle(template, assetRepo, fontRepo);
    expect(bundle.fonts).toHaveLength(1);
    expect(bundle.fonts[0]!.family).toBe('F, sans');
    expect(bundle.fonts[0]!.dataBase64.length).toBeGreaterThan(0);
  });
});

describe('importTemplateBundle', () => {
  it('cria assets com ids novos e reescreve as referências', async () => {
    const bundle: TemplateBundle = {
      template: {
        ...makeBlankTemplateInput('Portado'),
        header: {
          heightMm: 20,
          elements: [
            { type: 'image', assetId: 'ast_original', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
          ],
        },
      },
      assets: [
        { assetId: 'ast_original', mime: 'image/png', originalName: 'logo.png', dataBase64: PNG.toString('base64') },
      ],
      fonts: [],
    };

    const created = await importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo });
    expect(created.name).toBe('Portado');
    expect(created.id).toMatch(/^tpl_/);
    const el = created.header.elements[0]!;
    expect(el.type === 'image' && el.assetId).toMatch(/^ast_/);
    expect(el.type === 'image' && el.assetId).not.toBe('ast_original');

    // o binário do asset novo é o mesmo do bundle
    const restored = await assetRepo.get((created.header.elements[0]! as { assetId: string }).assetId);
    expect(restored?.data.equals(PNG)).toBe(true);
    expect(restored?.meta.mime).toBe('image/png');
  });

  it('remapeia várias referências ao mesmo assetId para o mesmo asset novo', async () => {
    const bundle: TemplateBundle = {
      template: {
        ...makeBlankTemplateInput('Duas logos'),
        header: {
          heightMm: 25,
          elements: [
            { type: 'image', assetId: 'ast_x', heightMm: 10, align: 'left', xOffsetMm: 0, yMm: 0 },
            { type: 'image', assetId: 'ast_x', heightMm: 10, align: 'right', xOffsetMm: 0, yMm: 0 },
          ],
        },
      },
      assets: [
        { assetId: 'ast_x', mime: 'image/png', originalName: 'l.png', dataBase64: PNG.toString('base64') },
      ],
      fonts: [],
    };

    const created = await importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo });
    const [a, b] = created.header.elements;
    expect(a?.type === 'image' && b?.type === 'image' && a.assetId).toBe(
      b?.type === 'image' ? b.assetId : '',
    );
  });

  it('recusa bundle com template inválido (propaga issues)', async () => {
    const bundle = {
      template: {
        ...makeBlankTemplateInput('Bad'),
        // margem menor que a faixa — o schema rejeita
        page: { format: 'A4', orientation: 'portrait', margins: { top: 1, right: 20, bottom: 25, left: 20 } },
      },
      assets: [],
      fonts: [],
    } as unknown as TemplateBundle;

    await expect(
      importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo }),
    ).rejects.toThrow();
  });

  it('round-trip: export → import preserva o layout dos elementos', async () => {
    const asset = await assetRepo.save({ originalName: 'l.png', mime: 'image/png', data: PNG });
    const original = await templateRepo.create({
      ...makeBlankTemplateInput('Round-trip'),
      header: {
        heightMm: 22,
        elements: [
          { type: 'image', assetId: asset.id, heightMm: 8, align: 'left', xOffsetMm: 3, yMm: 2 },
          { type: 'text', value: 'ACME {{cliente}}', align: 'center', xOffsetMm: 0, yMm: 5, bold: false, fontSizePt: 9, color: '#444' },
        ],
      },
    });

    const bundle = await buildTemplateBundle(original, assetRepo, fontRepo);
    const imported = await importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo });

    expect(imported.header.elements).toHaveLength(2);
    expect(imported.header.elements[0]).toMatchObject({
      type: 'image',
      heightMm: 8,
      align: 'left',
      xOffsetMm: 3,
      yMm: 2,
    });
    expect(imported.header.elements[1]).toMatchObject({
      type: 'text',
      value: 'ACME {{cliente}}',
      align: 'center',
      yMm: 5,
    });
    // id de template diferente
    expect(imported.id).not.toBe(original.id);
  });

  it('import recria a fonte e remapeia customFontId', async () => {
    const fontData = Buffer.alloc(64, 2);
    const bundle: TemplateBundle = {
      template: {
        ...makeBlankTemplateInput('Com fonte'),
        body: {
          ...makeBlankTemplateInput('Com fonte').body,
          font: { family: 'MyFont, sans-serif', customFontId: 'fnt_bundleorig12' },
        },
      },
      assets: [],
      fonts: [
        {
          fontId: 'fnt_bundleorig12',
          family: 'MyFont, sans-serif',
          originalName: 'myfont.ttf',
          mimeType: 'font/ttf',
          dataBase64: fontData.toString('base64'),
        },
      ],
    };

    const created = await importTemplateBundle(bundle, { assetRepo, fontRepo, templateRepo });
    expect(created.body.font.customFontId).toMatch(/^fnt_/);
    expect(created.body.font.customFontId).not.toBe('fnt_bundleorig12');
  });
});
