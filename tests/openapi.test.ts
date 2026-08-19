import { describe, it, expect } from 'vitest';
import type { Template } from '../src/domain/template.js';
import { buildTemplateOpenApi } from '../web/src/lib/templateOpenApi.js';

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl_ABCDEF123',
    name: 'Contrato Padrão',
    version: 1,
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

  it('marca markdown como required com descrição prefixada por "Document"', () => {
    const schema = docOf(makeTemplate()).paths['/api/convert']!.post.requestBody.content[
      'application/json'
    ].schema;
    expect(schema.required).toContain('markdown');
    expect(schema.properties.markdown.type).toBe('string');
    expect(schema.properties.markdown.description).toMatch(/^Document markdown/);
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
});
