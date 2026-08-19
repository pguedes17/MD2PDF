import type { Template } from './domain/template.js';
import { renderMarkdown } from './render/markdown.js';
import { renderTemplate } from './render/template.js';
import type { PdfService } from './render/pdf.js';
import type { TemplateRepo } from './storage/templateRepo.js';
import type { AssetRepo } from './storage/assetRepo.js';

export class TemplateNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'template_not_found';
  constructor(readonly templateId: string) {
    super(`template não encontrado: ${templateId}`);
    this.name = 'TemplateNotFoundError';
  }
}

export interface ConvertRequest {
  templateId: string;
  markdown: string;
  variables?: Record<string, string>;
}

export interface ConversionService {
  convert(req: ConvertRequest): Promise<{ pdf: Buffer; template: Template }>;
  /** Renderiza um template já carregado — usado pelo preview do editor. */
  convertWithTemplate(template: Template, markdown: string, variables?: Record<string, string>): Promise<Buffer>;
}

/** Percorre header/footer atrás dos assets que precisam virar data: URI. */
function collectAssetIds(template: Template): string[] {
  const ids = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const el of band.elements) {
      if (el.type === 'image') ids.add(el.assetId);
    }
  }
  return [...ids];
}

/** Costura storage + render + Chromium. É aqui que "markdown + templateId" vira PDF. */
export function createConversionService(deps: {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  pdfService: PdfService;
}): ConversionService {
  async function resolveAssets(template: Template): Promise<Record<string, string>> {
    const assets: Record<string, string> = {};
    for (const id of collectAssetIds(template)) {
      const dataUri = await deps.assetRepo.getDataUri(id);
      // Um asset ausente não vira silêncio: renderTemplate lança MissingAssetError.
      if (dataUri) assets[id] = dataUri;
    }
    return assets;
  }

  async function convertWithTemplate(
    template: Template,
    markdown: string,
    variables?: Record<string, string>,
  ): Promise<Buffer> {
    const rendered = renderTemplate(template, {
      variables,
      assets: await resolveAssets(template),
    });

    return deps.pdfService.convert({
      bodyHtml: renderMarkdown(markdown),
      headerHtml: rendered.headerHtml,
      footerHtml: rendered.footerHtml,
      css: rendered.css,
      pdfOptions: rendered.pdfOptions,
    });
  }

  return {
    convertWithTemplate,

    async convert({ templateId, markdown, variables }) {
      const template = await deps.templateRepo.get(templateId);
      if (!template) throw new TemplateNotFoundError(templateId);
      return { pdf: await convertWithTemplate(template, markdown, variables), template };
    },
  };
}
