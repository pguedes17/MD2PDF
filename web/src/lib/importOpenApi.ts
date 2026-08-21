/**
 * Gera OpenAPI 3.0.3 para o fluxo MCP de import + conversion:
 *   (1) importTemplateFromDocx  → recebe .docx, devolve template.id
 *   (2) convertWithTemplate     → recebe templateId + markdown, devolve path do PDF
 *
 * Sem template-id fixo: as duas tools funcionam em qualquer template criado.
 */

interface BuildOptions {
  serverUrl?: string;
}

export function buildImportOpenApi(options: BuildOptions = {}): object {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  return {
    openapi: '3.0.3',
    info: {
      title: 'md2pdf — Import + Convert (MCP)',
      version: '1.0.0',
      description:
        'Fluxo em duas etapas para gerar PDFs a partir de um template extraído de um docx: ' +
        '(1) importe um .docx com `importTemplateFromDocx` para criar o template; ' +
        '(2) use o `template.id` devolvido em `convertWithTemplate` sempre que precisar produzir um PDF com aquele template.',
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/api/templates/from-docx': {
        post: {
          operationId: 'importTemplateFromDocx',
          summary: 'Importa um .docx do disco local e cria um template md2pdf',
          description:
            'Cria um template md2pdf a partir de um arquivo .docx acessível pelo servidor. ' +
            'ENVIE COMO application/json com o campo `docxPath` — caminho ABSOLUTO do .docx no host onde o servidor md2pdf está rodando ' +
            '(ex.: `C:/DEV/md2pdf/tests/fixtures/docx/bionexo-requisitos.docx` no Windows, ou `/home/user/x.docx` no Linux). ' +
            'O servidor lê o arquivo do próprio disco — não converta para base64, não faça upload, apenas passe o caminho. ' +
            'Se o usuário mencionou um arquivo com sintaxe tipo `@caminho/arquivo.docx`, remova o `@` e passe o caminho puro. ' +
            'Se o caminho fornecido for relativo, RESOLVA para absoluto antes de chamar (usando o cwd do projeto do usuário). ' +
            'RESPOSTA: JSON com `template.id` — GUARDE ESSE ID e passe em chamadas futuras à tool `convertWithTemplate`. ' +
            'Se vierem `warnings`, mostre-as ao usuário (indicam decisões heurísticas que ele pode revisar no editor). ' +
            'QUANDO USAR: sempre que o usuário quiser criar um novo template a partir de um documento Word existente.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['docxPath'],
                  properties: {
                    docxPath: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Caminho ABSOLUTO do arquivo .docx no host do servidor md2pdf. ' +
                        'Exemplo Windows: `C:/DEV/md2pdf/tests/fixtures/docx/bionexo-requisitos.docx`. ' +
                        'Exemplo Linux: `/home/user/docs/timbrado.docx`. ' +
                        'DEVE terminar em `.docx` e ser um caminho absoluto — caminhos relativos são rejeitados.',
                    },
                    name: {
                      type: 'string',
                      description:
                        'Nome do template a criar. Se omitido, usa o nome do arquivo (sem extensão).',
                    },
                  },
                  additionalProperties: false,
                },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description:
                        'ALTERNATIVA para clientes que fazem upload real (browser). Agentes MCP normalmente NÃO usam essa variante — prefiram `application/json` com `docxPath`.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Template criado. Use `template.id` nas próximas conversões.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['template', 'warnings', 'assetIds'],
                    properties: {
                      template: {
                        type: 'object',
                        required: ['id', 'name'],
                        properties: {
                          id: { type: 'string', description: 'Id do template. Guarde e reuse.' },
                          name: { type: 'string' },
                        },
                      },
                      warnings: {
                        type: 'array',
                        description:
                          'Alertas sobre decisões automáticas (fontes não mapeadas, EMF, etc.). Mostre ao usuário.',
                        items: {
                          type: 'object',
                          required: ['code', 'message'],
                          properties: {
                            code: { type: 'string' },
                            message: { type: 'string' },
                          },
                        },
                      },
                      assetIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ids das imagens extraídas do docx (logos, etc).',
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Arquivo ausente ou docx inválido.' },
            '413': { description: 'Docx maior que 20MB.' },
          },
        },
      },
      '/api/convert': {
        post: {
          operationId: 'convertWithTemplate',
          summary: 'Gera um PDF a partir de markdown usando um template já existente',
          description:
            'Converte o `markdown` informado usando o template identificado por `templateId`. ' +
            'PROTOCOLO: o `templateId` deve vir de uma chamada anterior a `importTemplateFromDocx` OU ' +
            'de um id de template que o usuário já forneceu explicitamente. ' +
            'Se você tem múltiplos `templateId`s no contexto e não é óbvio qual usar, PERGUNTE ao usuário antes de chamar. ' +
            'RESPOSTA: JSON com o campo `path` — caminho absoluto do PDF em disco no host da API. ' +
            'Abra ou entregue esse arquivo diretamente; NÃO decodifique nem reprocesse o corpo da resposta.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['templateId', 'markdown', 'output'],
                  properties: {
                    templateId: {
                      type: 'string',
                      pattern: '^tpl_[A-Za-z0-9_-]{12}$',
                      description:
                        'Id do template a usar. Venha da resposta de `importTemplateFromDocx` ou do usuário.',
                    },
                    markdown: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Conteúdo do documento em Markdown. Aceita `<!-- pagebreak -->` para forçar quebra de página.',
                    },
                    output: {
                      type: 'string',
                      enum: ['path'],
                      default: 'path',
                      description:
                        'Sempre `path` — devolve caminho absoluto do arquivo em disco. NÃO altere.',
                    },
                    variables: {
                      type: 'object',
                      description:
                        'Valores para `{{placeholders}}` do header/footer do template. Se o template não tem placeholders, omita.',
                      additionalProperties: { type: 'string' },
                    },
                    filename: {
                      type: 'string',
                      description: 'Nome sugerido para o arquivo (opcional).',
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'PDF gerado. Use o campo `path` para abrir/entregar o arquivo.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['path', 'filename', 'templateId', 'pages', 'bytes'],
                    properties: {
                      path: { type: 'string' },
                      filename: { type: 'string' },
                      templateId: { type: 'string' },
                      pages: { type: 'integer', minimum: 1 },
                      bytes: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
            '400': { description: 'Validação falhou ou markdown vazio.' },
            '404': { description: 'Template não encontrado.' },
            '422': { description: 'Template referencia um asset que foi removido.' },
          },
        },
      },
    },
  };
}
