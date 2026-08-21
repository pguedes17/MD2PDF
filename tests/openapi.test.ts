import { describe, it, expect } from 'vitest';
import type { Template } from '../src/domain/template.js';
import { buildTemplateOpenApi } from '../web/src/lib/templateOpenApi.js';

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl_ABCDEF123',
    name: 'Contrato Padrão',
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    page: {
      format: 'A4',
      orientation: 'portrait',
      margins: { top: 30, right: 20, bottom: 25, left: 20 },
    },
    header: { heightMm: 20, elements: [] },
    footer: { heightMm: 15, elements: [] },
    body: {
      font: { family: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
      fontSizePt: 11,
      color: '#111111',
      lineHeight: 1.5,
    },
    headings: {
      h1: { color: '#111111', bold: true, fontSizePt: 20 },
      h2: { color: '#111111', bold: true, fontSizePt: 16 },
      h3: { color: '#111111', bold: true, fontSizePt: 13 },
    },
    cover: {
      enabled: false,
      applyHeader: false,
      applyFooter: false,
      elements: [],
    },
    ...overrides,
  };
}

// Tipagem local para navegar a resposta sem depender de tipos OpenAPI externos.
type OpenApiDoc = ReturnType<typeof buildTemplateOpenApi> & {
  openapi: string;
  info: { title: string; description: string };
  servers: { url: string }[];
  paths: Record<
    string,
    {
      post: {
        operationId: string;
        summary: string;
        description: string;
        requestBody: {
          content: {
            'application/json': {
              schema: {
                required: string[];
                properties: Record<string, any>;
              };
            };
          };
        };
      };
    }
  >;
};

function docOf(t: Template, serverUrl?: string): OpenApiDoc {
  return buildTemplateOpenApi(t, serverUrl ? { serverUrl } : {}) as OpenApiDoc;
}

describe('buildTemplateOpenApi', () => {
  it('marca a versão como 3.0.3', () => {
    expect(docOf(makeTemplate()).openapi).toBe('3.0.3');
  });

  it('embute o id do template no operationId', () => {
    const doc = docOf(makeTemplate({ id: 'tpl_XYZ42' }));
    expect(doc.paths['/api/convert']!.post.operationId).toBe('convertWithTemplate_tpl_XYZ42');
  });

  it('fixa o templateId no schema (enum + default) e o marca como required', () => {
    const doc = docOf(makeTemplate({ id: 'tpl_FIXED' }));
    const schema = doc.paths['/api/convert']!.post.requestBody.content['application/json'].schema;
    expect(schema.properties.templateId.enum).toEqual(['tpl_FIXED']);
    expect(schema.properties.templateId.default).toBe('tpl_FIXED');
    expect(schema.required).toContain('templateId');
  });

  it('fixa output = "path" (enum + default) e o marca como required', () => {
    const schema = docOf(makeTemplate()).paths['/api/convert']!.post.requestBody.content[
      'application/json'
    ].schema;
    expect(schema.properties.output.enum).toEqual(['path']);
    expect(schema.properties.output.default).toBe('path');
    expect(schema.required).toContain('output');
  });

  it('descreve a resposta como JSON com `path` — não binário nem base64', () => {
    const post = docOf(makeTemplate()).paths['/api/convert']!.post as any;
    const ok = post.responses['200'];
    expect(ok.content['application/json']).toBeDefined();
    expect(ok.content['application/pdf']).toBeUndefined();
    const props = ok.content['application/json'].schema.properties;
    expect(ok.content['application/json'].schema.required).toEqual(
      expect.arrayContaining(['path', 'filename', 'templateId', 'pages', 'bytes']),
    );
    expect(props.path.type).toBe('string');
    expect(props.pages.type).toBe('integer');
    // Instrui o consumidor MCP a não tentar decodificar
    expect(post.description.toLowerCase()).toMatch(/n(ã|a)o (tente )?decodific/);
    expect(post.description).toContain('`path`');
  });

  it('markdown vira alternativo a markdownPath (contrato "um dos dois") — nenhum dos dois é required no schema, validação fica no servidor', () => {
    const schema = docOf(makeTemplate()).paths['/api/convert']!.post.requestBody.content[
      'application/json'
    ].schema;
    // Antes: `markdown` estava em `required`. Agora sai — o par (markdown | markdownPath)
    // é validado no handler porque OpenAPI 3.0.3 não descreve "oneOf" no root sem quebrar
    // o mapper do oas2mcp.
    expect(schema.required).not.toContain('markdown');
    expect(schema.required).not.toContain('markdownPath');
    expect(schema.properties.markdown.type).toBe('string');
    expect(schema.properties.markdown.description).toMatch(/^Document markdown/);
    expect(schema.properties.markdownPath.type).toBe('string');
    // Descrição precisa deixar claro que os dois campos são alternativos e apontar quando usar cada um.
    expect(schema.properties.markdown.description.toLowerCase()).toMatch(/alternativ|um dos dois/);
    expect(schema.properties.markdownPath.description.toLowerCase()).toMatch(/alternativ|um dos dois/);
    expect(schema.properties.markdownPath.description.toLowerCase()).toContain('absolut');
  });

  it('resposta 200 do convert expõe path E fileUri (para harnesses que auto-linkificam file://)', () => {
    const spec = docOf(makeTemplate()) as any;
    const ok = spec.paths['/api/convert'].post.responses['200'];
    const schema = ok.content['application/json'].schema;
    expect(schema.required).toEqual(expect.arrayContaining(['path', 'fileUri']));
    expect(schema.properties.fileUri.type).toBe('string');
    expect(schema.properties.fileUri.format).toBe('uri');
    // A descrição da response menciona os dois modos.
    expect(ok.description.toLowerCase()).toMatch(/fileuri|file:\/\//);
  });

  it('sem variáveis: não inclui o campo `variables` no schema', () => {
    const schema = docOf(makeTemplate()).paths['/api/convert']!.post.requestBody.content[
      'application/json'
    ].schema;
    expect(schema.properties.variables).toBeUndefined();
    expect(schema.required).not.toContain('variables');
  });

  it('descobre variáveis nos elementos de texto do header/footer, sem duplicatas e ordenadas', () => {
    const t = makeTemplate({
      header: {
        heightMm: 20,
        elements: [
          {
            type: 'text',
            value: 'Documento {{status}} — {{id}}',
            align: 'left',
            xOffsetMm: 0,
            yMm: 0,
            bold: false,
            fontSizePt: 9,
            color: '#444',
          },
        ],
      },
      footer: {
        heightMm: 15,
        elements: [
          {
            type: 'text',
            value: 'v{{version}} — {{id}}',
            align: 'right',
            xOffsetMm: 0,
            yMm: 0,
            bold: false,
            fontSizePt: 9,
            color: '#444',
          },
        ],
      },
    });
    const schema = docOf(t).paths['/api/convert']!.post.requestBody.content['application/json']
      .schema;
    expect(Object.keys(schema.properties.variables.properties)).toEqual(['id', 'status', 'version']);
    expect(schema.properties.variables.required).toEqual(['id', 'status', 'version']);
    expect(schema.required).toContain('variables');
  });

  it('prefixa cada variável com "Document " e adiciona o protocolo de coleta por-variável', () => {
    const t = makeTemplate({
      header: {
        heightMm: 20,
        elements: [
          {
            type: 'text',
            value: '{{numero}} / {{cliente}}',
            align: 'left',
            xOffsetMm: 0,
            yMm: 0,
            bold: false,
            fontSizePt: 9,
            color: '#444',
          },
        ],
      },
    });
    const variables = docOf(t).paths['/api/convert']!.post.requestBody.content[
      'application/json'
    ].schema.properties.variables.properties;
    expect(variables.numero.description).toMatch(/^Document numero\b/);
    expect(variables.cliente.description).toMatch(/^Document cliente\b/);
    // Protocolo por-variável (pergunta e confirmação de reuso) chega em cada campo
    for (const name of ['numero', 'cliente']) {
      expect(variables[name].description).toMatch(/pergunt\w+ ao usuário/i);
      expect(variables[name].description.toLowerCase()).toContain('reutiliz');
      // referencia a própria variável pelo nome dentro do texto de reuso
      expect(variables[name].description).toContain(`\`${name}\``);
    }
  });

  it('ignora placeholders dentro de elementos não-textuais', () => {
    const t = makeTemplate({
      header: {
        heightMm: 20,
        elements: [
          {
            type: 'pageNumber',
            format: '{{nao_e_variavel}} {page}/{total}',
            align: 'right',
            xOffsetMm: 0,
            yMm: 0,
            bold: false,
            fontSizePt: 9,
            color: '#444',
          },
        ],
      },
    });
    const schema = docOf(t).paths['/api/convert']!.post.requestBody.content['application/json']
      .schema;
    expect(schema.properties.variables).toBeUndefined();
  });

  it('description descritivo para MCP inclui o nome do template', () => {
    const doc = docOf(makeTemplate({ name: 'Contrato de Transporte' }));
    const description = doc.paths['/api/convert']!.post.description;
    expect(description).toContain(
      'Utilize essa tool para gerar o arquivo pdf usando o template "Contrato de Transporte"',
    );
  });

  it('quando há variáveis, description instrui o LLM a coletar/confirmar valores com o usuário', () => {
    const t = makeTemplate({
      header: {
        heightMm: 20,
        elements: [
          {
            type: 'text',
            value: '{{id}}',
            align: 'left',
            xOffsetMm: 0,
            yMm: 0,
            bold: false,
            fontSizePt: 9,
            color: '#444',
          },
        ],
      },
    });
    const description = docOf(t).paths['/api/convert']!.post.description;
    // Pergunta quando falta no contexto
    expect(description).toMatch(/pergunt\w+ .*usuário/i);
    // Confirma reuso de valor já usado
    expect(description.toLowerCase()).toContain('reutiliz');
    // Impede invenção
    expect(description.toLowerCase()).toMatch(/nunca invent|não invent/);
  });

  it('quando não há variáveis, description não fala em coleta/reutilização', () => {
    const description = docOf(makeTemplate()).paths['/api/convert']!.post.description;
    expect(description.toLowerCase()).not.toContain('reutiliz');
    expect(description.toLowerCase()).not.toMatch(/protocolo de coleta/);
  });

  it('usa o serverUrl passado; cai em localhost:3000 quando ausente', () => {
    expect(docOf(makeTemplate()).servers[0]!.url).toBe('http://localhost:3000');
    expect(docOf(makeTemplate(), 'https://md2pdf.example.com').servers[0]!.url).toBe(
      'https://md2pdf.example.com',
    );
  });

  it('schema OpenAPI expõe cover, headings e body.font', () => {
    const spec = buildTemplateOpenApi(makeTemplate()) as any;
    const tmpl = spec.components.schemas.Template;
    expect(tmpl.properties.cover).toBeDefined();
    expect(tmpl.properties.headings).toBeDefined();
    expect(tmpl.properties.body.properties.font).toBeDefined();
  });

  it('body.font.customFontId é opcional (não aparece em required)', () => {
    const spec = buildTemplateOpenApi(makeTemplate()) as any;
    const font = spec.components.schemas.Template.properties.body.properties.font;
    expect(font.properties.family).toBeDefined();
    expect(font.properties.customFontId).toBeDefined();
    const required: string[] = font.required ?? [];
    expect(required).not.toContain('customFontId');
    expect(required).toContain('family');
  });

  it('headings expõe h1, h2 e h3 com color, bold e fontSizePt', () => {
    const spec = buildTemplateOpenApi(makeTemplate()) as any;
    const headings = spec.components.schemas.Template.properties.headings;
    for (const level of ['h1', 'h2', 'h3']) {
      const h = headings.properties[level];
      expect(h.properties.color).toBeDefined();
      expect(h.properties.bold).toBeDefined();
      expect(h.properties.fontSizePt).toBeDefined();
    }
  });

  it('cover expõe enabled, applyHeader, applyFooter e elements (array)', () => {
    const spec = buildTemplateOpenApi(makeTemplate()) as any;
    const cover = spec.components.schemas.Template.properties.cover;
    expect(cover.properties.enabled.type).toBe('boolean');
    expect(cover.properties.applyHeader.type).toBe('boolean');
    expect(cover.properties.applyFooter.type).toBe('boolean');
    expect(cover.properties.elements.type).toBe('array');
  });
});

import { buildImportOpenApi } from '../web/src/lib/importOpenApi.js';
import { WarningCodeEnum } from '../src/docx/schema.js';

describe('buildImportOpenApi', () => {
  it('inclui os 2 operations do fluxo MCP', () => {
    const spec = buildImportOpenApi({ serverUrl: 'http://localhost:3000' }) as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/templates/from-docx']).toBeTruthy();
    expect(spec.paths['/api/convert']).toBeTruthy();
    const importOp = spec.paths['/api/templates/from-docx'].post;
    expect(importOp.operationId).toBe('importTemplateFromDocx');
    // Variante JSON (docxPath) é a primária para agentes MCP; multipart continua como alternativa.
    expect(importOp.requestBody.content['application/json']).toBeTruthy();
    expect(importOp.requestBody.content['multipart/form-data']).toBeTruthy();
    const jsonSchema = importOp.requestBody.content['application/json'].schema;
    expect(jsonSchema.required).toContain('docxPath');
    expect(jsonSchema.properties.docxPath.type).toBe('string');
    expect(jsonSchema.properties.name).toBeTruthy();
    const convertOp = spec.paths['/api/convert'].post;
    expect(convertOp.operationId).toBe('convertWithTemplate');
    // templateId parametrizável (não enum de 1)
    const props = convertOp.requestBody.content['application/json'].schema.properties;
    expect(props.templateId.enum).toBeUndefined();
    expect(props.output.enum).toEqual(['path']);
  });

  it('inclui instruções para o agente MCP no description', () => {
    const spec = buildImportOpenApi() as any;
    const importOp = spec.paths['/api/templates/from-docx'].post;
    // Description explicitly instructs the agent to pass an absolute path.
    expect(importOp.description).toMatch(/docxPath/);
    expect(importOp.description).toMatch(/absoluto/i);
    expect(importOp.description).toMatch(/template\.id/i);
    // Agent should be told to remove `@caminho` prefix syntax often seen in chat clients.
    expect(importOp.description).toMatch(/@/);
    const convertOp = spec.paths['/api/convert'].post;
    expect(convertOp.description).toMatch(/templateId/i);
  });

  it('warnings.code é enumerado com todos os códigos definidos em src/docx/schema.ts', () => {
    // Pins the sync between the OpenAPI enum and the runtime WarningCodeEnum —
    // if someone adds a new warning code in the backend, this test forces the spec to follow.
    const spec = buildImportOpenApi() as any;
    const importOp = spec.paths['/api/templates/from-docx'].post;
    const warnings = importOp.responses['201'].content['application/json']
      .schema.properties.warnings;
    expect(warnings.items.properties.code.enum).toEqual([...WarningCodeEnum.options]);
  });

  it('docxPath inclui um example concreto para o MCP client exibir como hint', () => {
    const spec = buildImportOpenApi() as any;
    const jsonSchema = spec.paths['/api/templates/from-docx'].post
      .requestBody.content['application/json'].schema;
    expect(typeof jsonSchema.properties.docxPath.example).toBe('string');
    expect(jsonSchema.properties.docxPath.example).toMatch(/\.docx$/i);
  });

  it('respostas 400/413 do from-docx expõem schema tipado {error, message}', () => {
    const spec = buildImportOpenApi() as any;
    const responses = spec.paths['/api/templates/from-docx'].post.responses;

    const err400 = responses['400'].content['application/json'].schema;
    expect(err400.required).toEqual(expect.arrayContaining(['error', 'message']));
    // Códigos estáveis emitidos pelo backend hoje (src/routes/templates.ts).
    expect(err400.properties.error.enum).toEqual(
      expect.arrayContaining(['validation_failed', 'docx_read_failed']),
    );

    const err413 = responses['413'].content['application/json'].schema;
    expect(err413.required).toEqual(expect.arrayContaining(['error', 'message']));
  });

  it('convert expõe markdown E markdownPath como alternativos; nenhum dos dois é required', () => {
    const spec = buildImportOpenApi() as any;
    const bodySchema = spec.paths['/api/convert'].post.requestBody
      .content['application/json'].schema;
    expect(bodySchema.required).not.toContain('markdown');
    expect(bodySchema.required).not.toContain('markdownPath');
    expect(bodySchema.properties.markdownPath.type).toBe('string');
    expect(bodySchema.properties.markdownPath.description.toLowerCase()).toMatch(/absolut/);
    expect(bodySchema.properties.markdownPath.description.toLowerCase()).toMatch(/alternativ|um dos dois/);
    expect(bodySchema.properties.markdownPath.example).toMatch(/\.md$/i);
    // A description da operação orienta o agente sobre quando preferir cada um.
    const desc = spec.paths['/api/convert'].post.description.toLowerCase();
    expect(desc).toContain('markdownpath');
    expect(desc).toMatch(/prefir|prefer/);
  });

  it('resposta 200 do convert inclui fileUri além de path', () => {
    const spec = buildImportOpenApi() as any;
    const ok = spec.paths['/api/convert'].post.responses['200'];
    const schema = ok.content['application/json'].schema;
    expect(schema.required).toEqual(expect.arrayContaining(['path', 'fileUri']));
    expect(schema.properties.fileUri.type).toBe('string');
    expect(schema.properties.fileUri.format).toBe('uri');
  });

  it('400 do convert inclui markdown_read_failed nos códigos possíveis', () => {
    const spec = buildImportOpenApi() as any;
    const err400 = spec.paths['/api/convert'].post.responses['400'];
    expect(err400.description).toContain('markdown_read_failed');
    const schema = err400.content['application/json'].schema;
    expect(schema.required).toEqual(expect.arrayContaining(['error', 'message']));
  });

  it('respostas 400/404/422 do convert expõem schema tipado com códigos estáveis', () => {
    const spec = buildImportOpenApi() as any;
    const responses = spec.paths['/api/convert'].post.responses;

    // 400 — não fixa enum (backend usa fallback dinâmico), só garante a shape do envelope.
    const err400 = responses['400'].content['application/json'].schema;
    expect(err400.required).toEqual(expect.arrayContaining(['error', 'message']));

    // 404 — sempre `not_found`.
    const err404 = responses['404'].content['application/json'].schema;
    expect(err404.properties.error.enum).toEqual(['not_found']);

    // 422 — carrega o `assetId` que o handler adiciona no envelope.
    const err422 = responses['422'].content['application/json'].schema;
    expect(err422.properties.error.enum).toEqual(['asset_not_found']);
    expect(err422.required).toEqual(expect.arrayContaining(['assetId']));
  });

  it('expõe listTemplates + getTemplate para o fluxo "gerar PDF de template existente"', () => {
    const spec = buildImportOpenApi() as any;

    // listTemplates
    const list = spec.paths['/api/templates']?.get;
    expect(list).toBeTruthy();
    expect(list.operationId).toBe('listTemplates');
    const listItems = list.responses['200'].content['application/json'].schema.items;
    expect(listItems.required).toEqual(expect.arrayContaining(['id', 'name', 'updatedAt']));
    expect(list.description.toLowerCase()).toMatch(/(escolher|escolha|listar)/);

    // getTemplate
    const get = spec.paths['/api/templates/{id}']?.get;
    expect(get).toBeTruthy();
    expect(get.operationId).toBe('getTemplate');
    const idParam = get.parameters.find((p: any) => p.name === 'id');
    expect(idParam.required).toBe(true);
    expect(idParam.in).toBe('path');
    // A description deve ensinar o agente a extrair {{...}} do header/footer.
    expect(get.description).toMatch(/\{\{/);
    expect(get.description.toLowerCase()).toMatch(/vari(á|a)ve/);
    // 404 documentado (template inexistente).
    expect(get.responses['404']).toBeTruthy();
  });
});
