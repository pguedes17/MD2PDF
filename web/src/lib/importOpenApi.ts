/**
 * Gera OpenAPI 3.0.3 para o fluxo MCP completo do md2pdf:
 *   - importTemplateFromDocx → cria template a partir de .docx
 *   - listTemplates          → lista templates existentes (para o agente escolher)
 *   - getTemplate            → detalhes de um template (para descobrir variáveis)
 *   - convertWithTemplate    → gera o PDF, dado o templateId + markdown
 *
 * Sem template-id fixo: as tools funcionam em qualquer template criado.
 */

import { WarningCodeEnum } from '../../../src/docx/schema.js';

interface BuildOptions {
  serverUrl?: string;
}

export function buildImportOpenApi(options: BuildOptions = {}): object {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  return {
    openapi: '3.0.3',
    info: {
      title: 'md2pdf — Workflow completo (MCP)',
      version: '1.1.0',
      description:
        'Toolkit MCP para o md2pdf. Fluxos suportados: ' +
        '(A) CRIAR TEMPLATE — importe um .docx com `importTemplateFromDocx`; guarde o `template.id`. ' +
        '(B) GERAR PDF DE UM TEMPLATE JÁ EXISTENTE — chame `listTemplates` para o usuário escolher, ' +
        '`getTemplate` para descobrir se ele tem variáveis (`{{placeholder}}` no header/footer), ' +
        'pergunte os valores das variáveis ao usuário, então chame `convertWithTemplate`. ' +
        'NUNCA invente valores de variáveis; NUNCA reutilize um `templateId` de uma conversa anterior sem confirmar.',
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
            '(ex.: `C:/DEV/md2pdf/tests/fixtures/docx/sample-requirements.docx` no Windows, ou `/home/user/x.docx` no Linux). ' +
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
                        'Exemplo Windows: `C:/DEV/md2pdf/tests/fixtures/docx/sample-requirements.docx`. ' +
                        'Exemplo Linux: `/home/user/docs/timbrado.docx`. ' +
                        'DEVE terminar em `.docx` e ser um caminho absoluto — caminhos relativos são rejeitados.',
                      example: 'C:/DEV/md2pdf/tests/fixtures/docx/sample-requirements.docx',
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
                        'ALTERNATIVA à variante JSON. Passe o CAMINHO ABSOLUTO do .docx no host onde a tool está rodando ' +
                        '(o oas2mcp lê o arquivo do disco e monta o multipart automaticamente). ' +
                        'NÃO passe base64 nem bytes literais — só o caminho. ' +
                        'Para agentes MCP a variante `application/json` com `docxPath` é equivalente e um pouco mais eficiente; use-a por padrão.',
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
                          'Alertas sobre decisões automáticas (fontes não mapeadas, EMF, cover heurístico etc.). Mostre ao usuário. ' +
                          'O `code` é enumerado — use-o para reagir programaticamente em vez de interpretar `message`.',
                        items: {
                          type: 'object',
                          required: ['code', 'message'],
                          properties: {
                            code: {
                              type: 'string',
                              // Fonte única: src/docx/schema.ts — se um code novo for adicionado lá, aparece aqui automaticamente.
                              enum: [...WarningCodeEnum.options],
                            },
                            message: {
                              type: 'string',
                              description: 'Descrição legível do aviso, útil para exibir ao usuário.',
                            },
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
            '400': {
              description:
                'Falha de validação ou leitura. Códigos possíveis: ' +
                '`validation_failed` (payload malformado — ex.: `docxPath` faltando, relativo ou não termina em `.docx`); ' +
                '`docx_read_failed` (o servidor não conseguiu ler o arquivo — inexistente, sem permissão, ou não é um docx válido).',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'message'],
                    properties: {
                      error: {
                        type: 'string',
                        enum: ['validation_failed', 'docx_read_failed'],
                        description: 'Código estável do erro — use este campo, não `message`, para decidir como reagir.',
                      },
                      message: {
                        type: 'string',
                        description: 'Descrição legível do problema, para relatar ao usuário.',
                      },
                      issues: {
                        type: 'array',
                        description:
                          'Detalhes de validação por campo (presente apenas quando o Zod rejeita o payload). ' +
                          'Cada item aponta um path e uma razão específica.',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
            '413': {
              description:
                'Docx maior que 20MB. O limite é fixo — peça ao usuário um arquivo menor ou remova imagens pesadas antes de tentar de novo.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'message'],
                    properties: {
                      error: {
                        type: 'string',
                        description:
                          'Código do erro emitido pelo Fastify (tipicamente `FST_REQ_FILE_TOO_LARGE`).',
                      },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/templates': {
        get: {
          operationId: 'listTemplates',
          summary: 'Lista os templates já criados',
          description:
            'Retorna um array com os templates existentes (id, nome, timestamps). Use antes de `convertWithTemplate` ' +
            'quando o usuário quiser gerar um PDF sem ter mencionado explicitamente qual template — apresente a lista ' +
            'ORDENADA pelo `updatedAt` decrescente (a API já devolve assim) e deixe o usuário escolher por número ou nome. ' +
            'Se a lista vier vazia, ofereça criar um novo template via `importTemplateFromDocx`.',
          responses: {
            '200': {
              description: 'Lista (possivelmente vazia) de templates.',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'name', 'createdAt', 'updatedAt'],
                      properties: {
                        id: {
                          type: 'string',
                          pattern: '^tpl_[A-Za-z0-9_-]{12}$',
                          description: 'Id estável do template. Passe em `getTemplate` ou `convertWithTemplate`.',
                        },
                        name: { type: 'string', description: 'Nome legível do template.' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/templates/{id}': {
        get: {
          operationId: 'getTemplate',
          summary: 'Detalhes de um template — use para descobrir suas variáveis',
          description:
            'Retorna o template completo, incluindo `header.elements` e `footer.elements`. ' +
            'USO PRINCIPAL: descobrir quais variáveis `{{nome}}` o template exige antes de chamar `convertWithTemplate`. ' +
            'Como fazer: itere `header.elements` e `footer.elements`; para cada elemento com `type === "text"`, ' +
            'extraia TODAS as ocorrências de `{{palavra}}` do campo `value`. Colete os nomes únicos, ordene alfabeticamente, ' +
            'e para cada nome PERGUNTE ao usuário o valor. Depois passe todos como `variables: {nome: valor, ...}` em `convertWithTemplate`. ' +
            'Se nenhum elemento tem `{{...}}`, o template não tem variáveis — não pergunte nada e chame convert direto.',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', pattern: '^tpl_[A-Za-z0-9_-]{12}$' },
              description: 'Id do template (de `listTemplates` ou fornecido pelo usuário).',
            },
          ],
          responses: {
            '200': {
              description: 'Template completo. Inspecione `header.elements` e `footer.elements` para achar `{{variáveis}}`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'name', 'page', 'header', 'footer'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      page: {
                        type: 'object',
                        description: 'Geometria da página (format, orientation, margins).',
                      },
                      header: {
                        type: 'object',
                        required: ['heightMm', 'elements'],
                        properties: {
                          heightMm: { type: 'number' },
                          elements: {
                            type: 'array',
                            description:
                              'Elementos posicionados no cabeçalho. Elementos `type: "text"` podem conter `{{variáveis}}` no campo `value`.',
                            items: { type: 'object' },
                          },
                        },
                      },
                      footer: {
                        type: 'object',
                        required: ['heightMm', 'elements'],
                        properties: {
                          heightMm: { type: 'number' },
                          elements: {
                            type: 'array',
                            description:
                              'Elementos posicionados no rodapé. Elementos `type: "text"` podem conter `{{variáveis}}` no campo `value`.',
                            items: { type: 'object' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Template não encontrado — o id não existe (ou foi apagado). Chame `listTemplates` para ver os disponíveis.',
            },
          },
        },
      },
      '/api/convert': {
        post: {
          operationId: 'convertWithTemplate',
          summary: 'Gera um PDF a partir de markdown usando um template já existente',
          description:
            'Converte um Markdown usando o template identificado por `templateId`. ' +
            'ENVIE O CONTEÚDO POR EXATAMENTE UM DE DOIS CAMPOS: ' +
            '(a) `markdown` — string inline (bom para conteúdo curto/gerado on-the-fly); ' +
            '(b) `markdownPath` — caminho ABSOLUTO de um `.md` no host da API (PREFIRA ESTE quando o arquivo já existir em disco: evita transportar centenas de KB de conteúdo pelo pipeline do LLM e é significativamente mais rápido). ' +
            'PROTOCOLO: o `templateId` deve vir de uma chamada anterior a `importTemplateFromDocx` OU ' +
            'de um id de template que o usuário já forneceu explicitamente. ' +
            'Se você tem múltiplos `templateId`s no contexto e não é óbvio qual usar, PERGUNTE ao usuário antes de chamar. ' +
            'RESPOSTA: JSON com `path` (caminho absoluto do PDF em disco) e `fileUri` (mesmo caminho no formato `file://` — muitos harnesses linkificam automaticamente). ' +
            'Abra ou entregue o arquivo diretamente; NÃO decodifique nem reprocesse o corpo da resposta.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['templateId', 'output'],
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
                        'Conteúdo do documento em Markdown. Aceita `<!-- pagebreak -->` para forçar quebra de página. ' +
                        'ALTERNATIVO a `markdownPath` — envie exatamente um dos dois. ' +
                        'Use este quando o conteúdo é curto ou foi gerado agora na conversa.',
                    },
                    markdownPath: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Caminho ABSOLUTO de um arquivo `.md` no host do servidor md2pdf. ' +
                        'Exemplo: `C:/DEV/md2pdf/README.md` (Windows) ou `/home/user/doc.md` (Linux). ' +
                        'ALTERNATIVO a `markdown` — envie exatamente um dos dois. ' +
                        'PREFIRA ESTE quando o arquivo já existe em disco: o servidor lê direto, evitando transportar o conteúdo inteiro pelo pipeline do LLM. ' +
                        'Regras iguais às de `docxPath`: caminho absoluto, resolva `@arquivo.md` para o caminho puro, converta relativo para absoluto usando o cwd do projeto.',
                      example: 'C:/DEV/md2pdf/README.md',
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
              description:
                'PDF gerado. Use `path` (caminho absoluto no filesystem) OU `fileUri` (`file://...` — muitos harnesses linkificam automaticamente) para abrir/entregar o arquivo.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['path', 'fileUri', 'filename', 'templateId', 'pages', 'bytes'],
                    properties: {
                      path: {
                        type: 'string',
                        description: 'Caminho absoluto do PDF em disco no host da API.',
                      },
                      fileUri: {
                        type: 'string',
                        format: 'uri',
                        description:
                          'Mesmo arquivo no formato `file://` — útil para harnesses (Claude Code, Cursor) que auto-linkificam URIs.',
                        example: 'file:///C:/DEV/md2pdf/storage/outputs/documento-...pdf',
                      },
                      filename: { type: 'string' },
                      templateId: { type: 'string' },
                      pages: { type: 'integer', minimum: 1 },
                      bytes: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
            '400': {
              description:
                'Falha de validação ou leitura. Códigos possíveis: ' +
                '`validation_failed` (payload malformado — `markdown`/`markdownPath` ausentes ou ambos presentes, `templateId` fora do padrão, variáveis obrigatórias faltando); ' +
                '`markdown_read_failed` (o `markdownPath` aponta para um arquivo inexistente, sem permissão, ou vazio); ' +
                '`bad_request` como fallback genérico.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'message'],
                    properties: {
                      error: {
                        type: 'string',
                        description: 'Código estável — use este campo, não `message`, para decidir como reagir.',
                      },
                      message: { type: 'string' },
                      issues: {
                        type: 'array',
                        description: 'Detalhes por campo quando a origem é Zod.',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
            '404': {
              description:
                'Template não encontrado — o `templateId` fornecido não existe (foi removido ou nunca foi criado). ' +
                'Rechame `importTemplateFromDocx` para regerar o template, ou peça ao usuário para confirmar o id.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'message'],
                    properties: {
                      error: { type: 'string', enum: ['not_found'] },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            '422': {
              description:
                'Template referencia um asset que foi removido (ex.: logo do header apagado). ' +
                'O campo `assetId` identifica qual asset falta — reporte ao usuário para que ele reenvie a imagem ou reimporte o docx.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'message', 'assetId'],
                    properties: {
                      error: { type: 'string', enum: ['asset_not_found'] },
                      message: { type: 'string' },
                      assetId: {
                        type: 'string',
                        description: 'Id do asset ausente (formato `ast_XXXXXXXXXXXX`).',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
