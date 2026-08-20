import type { Template } from '../../../src/domain/template.js';

/**
 * Gera um OpenAPI 3.0.3 focado em `POST /api/convert` para *este* template
 * específico — id fixo, markdown obrigatório e um objeto `variables` com todas
 * as `{{placeholders}}` que o cabeçalho/rodapé usam.
 *
 * A saída é pensada para ser convertida em uma ferramenta MCP: por isso as
 * descrições são explicativas e o `operationId` embute o id do template.
 */

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

function collectVariableNames(template: Template): string[] {
  const names = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const el of band.elements) {
      if (el.type !== 'text') continue;
      for (const match of el.value.matchAll(PLACEHOLDER)) {
        if (match[1]) names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}

interface BuildOptions {
  /** URL base da API. Passe `window.location.origin` na UI. */
  serverUrl?: string;
}

export function buildTemplateOpenApi(template: Template, options: BuildOptions = {}): object {
  const variables = collectVariableNames(template);
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  const bodySchemaProperties: Record<string, unknown> = {
    templateId: {
      type: 'string',
      // OpenAPI 3.0.3 não suporta `const`; um enum de um valor equivale.
      enum: [template.id],
      default: template.id,
      description: `Id do template. Já vem fixo em "${template.id}" — não altere.`,
    },
    markdown: {
      type: 'string',
      minLength: 1,
      description:
        'Document markdown — o conteúdo do documento em Markdown. Aceita `<!-- pagebreak -->` para forçar quebra de página.',
    },
    output: {
      type: 'string',
      enum: ['path'],
      default: 'path',
      description:
        'Modo de saída. Sempre `path` — o servidor grava o PDF em disco e devolve o caminho absoluto no host da API. NÃO altere esse valor.',
    },
  };
  const bodyRequired = ['templateId', 'markdown', 'output'];

  if (variables.length > 0) {
    const varsProperties: Record<string, unknown> = {};
    for (const name of variables) {
      varsProperties[name] = {
        type: 'string',
        description:
          `Document ${name}. Se o valor não estiver no contexto da conversa, pergunte ao usuário antes de chamar a tool. ` +
          `Se você já enviou um valor para \`${name}\` em uma chamada anterior desta conversa, confirme com o usuário antes de reutilizá-lo.`,
      };
    }
    bodySchemaProperties['variables'] = {
      type: 'object',
      description:
        'Valores das variáveis do documento — cada chave preenche um `{{placeholder}}` do cabeçalho ou rodapé.',
      required: [...variables],
      properties: varsProperties,
      additionalProperties: false,
    };
    bodyRequired.push('variables');
  }

  const variablesLine =
    variables.length > 0
      ? [
          ` Este template usa as variáveis do documento (${variables.map((v) => `\`${v}\``).join(', ')}) —`,
          ` envie os valores no campo \`variables\`.`,
          ' PROTOCOLO DE COLETA (obrigatório antes de chamar a tool):',
          ' (1) para cada variável, se o valor NÃO estiver no contexto atual da conversa, pergunte explicitamente ao usuário antes de invocar;',
          ' (2) se você já usou um valor para essa variável em uma chamada anterior desta conversa, confirme com o usuário antes de reutilizá-lo (ex.: "Já usei o id \'XXXX\' antes — quer reutilizar ou trocar?");',
          ' (3) nunca invente, adivinhe ou reutilize silenciosamente valores de variáveis.',
        ].join('')
      : '';

  const headingLevelSchema = {
    type: 'object',
    properties: {
      color: { type: 'string', description: 'Cor hexadecimal, ex.: #111111.' },
      bold: { type: 'boolean' },
      fontSizePt: { type: 'number', minimum: 4, maximum: 72 },
    },
    required: ['color', 'bold', 'fontSizePt'],
  };

  const coverElementSchema = {
    type: 'object',
    description: 'Elemento de capa (image, text ou date).',
    properties: {
      type: { type: 'string', enum: ['image', 'text', 'date'] },
      align: { type: 'string', enum: ['left', 'center', 'right'] },
      xOffsetMm: { type: 'number' },
      yMm: { type: 'number' },
    },
    required: ['type'],
  };

  const templateSchema = {
    type: 'object',
    description: 'Configuração completa do template md2pdf.',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      page: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['A4', 'Letter'] },
          orientation: { type: 'string', enum: ['portrait', 'landscape'] },
          margins: {
            type: 'object',
            properties: {
              top: { type: 'number' },
              right: { type: 'number' },
              bottom: { type: 'number' },
              left: { type: 'number' },
            },
            required: ['top', 'right', 'bottom', 'left'],
          },
        },
        required: ['format', 'orientation', 'margins'],
      },
      header: {
        type: 'object',
        properties: {
          heightMm: { type: 'number' },
          elements: { type: 'array', items: { type: 'object' } },
        },
        required: ['heightMm', 'elements'],
      },
      footer: {
        type: 'object',
        properties: {
          heightMm: { type: 'number' },
          elements: { type: 'array', items: { type: 'object' } },
        },
        required: ['heightMm', 'elements'],
      },
      body: {
        type: 'object',
        properties: {
          font: {
            type: 'object',
            description: 'Fonte do corpo do documento.',
            properties: {
              family: {
                type: 'string',
                description: 'Família da fonte (CSS font-family).',
              },
              customFontId: {
                type: 'string',
                description: 'Id de uma fonte personalizada carregada na API (fnt_…). Opcional.',
                pattern: '^fnt_[A-Za-z0-9_-]{12}$',
              },
            },
            required: ['family'],
          },
          fontSizePt: { type: 'number' },
          color: { type: 'string' },
          lineHeight: { type: 'number' },
        },
        required: ['font', 'fontSizePt', 'color', 'lineHeight'],
      },
      headings: {
        type: 'object',
        description: 'Estilos de cabeçalho h1/h2/h3.',
        properties: {
          h1: headingLevelSchema,
          h2: headingLevelSchema,
          h3: headingLevelSchema,
        },
        required: ['h1', 'h2', 'h3'],
      },
      cover: {
        type: 'object',
        description: 'Configuração da página de capa.',
        properties: {
          enabled: { type: 'boolean', description: 'Liga/desliga a página de capa.' },
          applyHeader: {
            type: 'boolean',
            description: 'Mostra o cabeçalho do template na capa.',
          },
          applyFooter: {
            type: 'boolean',
            description: 'Mostra o rodapé do template na capa.',
          },
          elements: {
            type: 'array',
            description: 'Elementos posicionados na capa.',
            items: coverElementSchema,
          },
        },
        required: ['enabled', 'applyHeader', 'applyFooter', 'elements'],
      },
    },
    required: ['id', 'name', 'page', 'header', 'footer', 'body', 'headings', 'cover'],
  };

  return {
    openapi: '3.0.3',
    info: {
      title: `md2pdf — ${template.name}`,
      version: '1.0.0',
      description: `Converte Markdown em PDF usando o template "${template.name}" (id fixo ${template.id}).`,
    },
    servers: [{ url: serverUrl }],
    components: {
      schemas: {
        Template: templateSchema,
      },
    },
    paths: {
      '/api/convert': {
        post: {
          operationId: `convertWithTemplate_${template.id}`,
          summary: `Gera PDF usando o template "${template.name}"`,
          description:
            `Utilize essa tool para gerar o arquivo pdf usando o template "${template.name}". ` +
            `O id do template já vem fixado; envie apenas o conteúdo do documento em Markdown.` +
            variablesLine +
            ' RESPOSTA: um JSON com o campo `path` — caminho absoluto do PDF já gravado em disco no host da API. Abra ou entregue esse arquivo diretamente; NÃO tente decodificar, baixar ou reprocessar o corpo da resposta.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: bodyRequired,
                  properties: bodySchemaProperties,
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                'PDF gerado com sucesso. O arquivo já está gravado em disco no host da API — use o campo `path` para abrir/entregar o arquivo. NÃO tente decodificar o corpo da resposta.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['path', 'filename', 'templateId', 'pages', 'bytes'],
                    properties: {
                      path: {
                        type: 'string',
                        description:
                          'Caminho absoluto do PDF gerado no host da API. Abra este arquivo diretamente — não é preciso baixar nem decodificar nada.',
                      },
                      filename: {
                        type: 'string',
                        description:
                          'Nome do arquivo gerado (já com timestamp e sufixo único).',
                      },
                      templateId: { type: 'string' },
                      pages: { type: 'integer', minimum: 1 },
                      bytes: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Validação falhou ou o Markdown veio vazio.',
            },
            '404': {
              description: 'Template não encontrado.',
            },
            '422': {
              description: 'O template referencia uma imagem que foi removida.',
            },
          },
        },
      },
    },
  };
}
