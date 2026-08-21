import { describe, it, expect } from 'vitest';
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
