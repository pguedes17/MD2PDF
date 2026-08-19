import {
  applyVariables,
  ZONE_NAMES,
  type Template,
  type TemplateBand,
  type TemplateElement,
  type TemplateInput,
  type ZoneName,
} from '../domain/template.js';

/**
 * Traduz um Template para o HTML/CSS que o Chromium imprime.
 *
 * Função pura de propósito: sem `fs`, sem Playwright, sem Fastify. É o que
 * permite o editor no browser importar este mesmo módulo e desenhar um preview
 * que bate com o PDF, em vez de manter uma segunda implementação do layout.
 */

/** Subconjunto das opções de `page.pdf()` que o template determina. */
export interface PdfOptions {
  format: 'A4' | 'Letter';
  landscape: boolean;
  printBackground: boolean;
  displayHeaderFooter: boolean;
  margin: { top: string; right: string; bottom: string; left: string };
}

export interface RenderedTemplate {
  headerHtml: string;
  footerHtml: string;
  css: string;
  pdfOptions: PdfOptions;
}

export interface RenderTemplateOptions {
  /** Valores para os placeholders {{...}} dos textos. */
  variables?: Record<string, string>;
  /** assetId -> data: URI. Quem chama resolve o storage; aqui só se consome. */
  assets?: Record<string, string>;
  now?: Date;
  timeZone?: string;
  /**
   * O que fazer com uma imagem cujo asset não foi resolvido.
   *
   * `throw` (padrão) é o comportamento do servidor: imprimir um documento com a
   * logo faltando seria pior que falhar. `placeholder` é para o editor, onde o
   * elemento existe legitimamente por alguns segundos antes de você escolher o
   * arquivo — ali ele precisa aparecer como um espaço reservado.
   */
  missingAsset?: 'throw' | 'placeholder';
}

export class MissingAssetError extends Error {
  readonly statusCode = 422;
  constructor(readonly assetId: string) {
    super(`asset não encontrado: ${assetId}`);
    this.name = 'MissingAssetError';
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

function formatDate(format: string, now: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const dd = get('day');
  const MM = get('month');
  const yyyy = get('year');
  const HH = get('hour');
  const mm = get('minute');

  switch (format) {
    case 'yyyy-MM-dd':
      return `${yyyy}-${MM}-${dd}`;
    case 'dd/MM/yyyy HH:mm':
      return `${dd}/${MM}/${yyyy} ${HH}:${mm}`;
    default:
      return `${dd}/${MM}/${yyyy}`;
  }
}

/** `{page}` e `{total}` viram os spans que o próprio Chromium preenche na impressão. */
function pageNumberHtml(format: string): string {
  return escapeHtml(format)
    .replace(/\{page\}/g, '<span class="pageNumber"></span>')
    .replace(/\{total\}/g, '<span class="totalPages"></span>');
}

function textStyle(el: Extract<TemplateElement, { fontSizePt: number }>): string {
  return [
    `font-size: ${el.fontSizePt}pt`,
    `color: ${el.color}`,
    `font-weight: ${el.bold ? 700 : 400}`,
    'white-space: pre-wrap',
  ].join('; ');
}

function elementHtml(el: TemplateElement, opts: RenderTemplateOptions): string {
  switch (el.type) {
    case 'image': {
      const dataUri = el.assetId ? opts.assets?.[el.assetId] : undefined;
      if (!dataUri) {
        if (opts.missingAsset !== 'placeholder') throw new MissingAssetError(el.assetId);
        return `<span style="display: inline-flex; align-items: center; justify-content: center; height: ${el.heightMm}mm; min-width: ${el.heightMm * 2.4}mm; border: 1px dashed #9aa5ad; border-radius: 1mm; color: #8b98a1; font-size: 6pt; letter-spacing: 0.08em; text-transform: uppercase;">escolha uma imagem</span>`;
      }
      // data: URI e não URL: o Chromium não carrega recurso externo dentro de
      // header/footer de forma confiável — é a causa nº 1 de "a logo sumiu".
      return `<img src="${escapeHtml(dataUri)}" style="height: ${el.heightMm}mm; width: auto; display: block;" alt="">`;
    }
    case 'text':
      return `<span style="${textStyle(el)}">${escapeHtml(applyVariables(el.value, opts.variables))}</span>`;
    case 'pageNumber':
      return `<span style="${textStyle(el)}">${pageNumberHtml(el.format)}</span>`;
    case 'date':
      return `<span style="${textStyle(el)}">${escapeHtml(formatDate(el.format, opts.now ?? new Date(), opts.timeZone))}</span>`;
  }
}

const ZONE_ALIGN: Record<ZoneName, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

function zoneHtml(
  elements: TemplateElement[],
  zone: ZoneName,
  opts: RenderTemplateOptions,
): string {
  const style = `flex: 1 1 0; display: flex; align-items: center; gap: 3mm; justify-content: ${ZONE_ALIGN[zone]}; min-width: 0;`;
  return `<div style="${style}">${elements.map((el) => elementHtml(el, opts)).join('')}</div>`;
}

function bandHtml(
  band: TemplateBand,
  template: TemplateInput,
  opts: RenderTemplateOptions,
): string {
  const { margins } = template.page;
  // Padding lateral igual às margens da página: sem isso a faixa fica colada na
  // borda enquanto o corpo respeita a margem.
  const style = [
    'box-sizing: border-box',
    'width: 100%',
    `height: ${band.heightMm}mm`,
    `padding: 0 ${margins.right}mm 0 ${margins.left}mm`,
    'display: flex',
    'align-items: center',
    `font-family: ${template.body.fontFamily}`,
    // O Chromium injeta header/footer num documento com font-size 0; sem um
    // tamanho declarado aqui, qualquer texto some.
    'font-size: 9pt',
    'line-height: 1.2',
    '-webkit-print-color-adjust: exact',
    'print-color-adjust: exact',
  ].join('; ');

  const zones = ZONE_NAMES.map((zone) => zoneHtml(band.zones[zone], zone, opts)).join('');
  return `<div style="${style}">${zones}</div>`;
}

function bandIsEmpty(band: TemplateBand): boolean {
  return ZONE_NAMES.every((zone) => band.zones[zone].length === 0);
}

function buildCss(template: TemplateInput): string {
  const { body } = template;
  const codeSizePt = Math.max(7, body.fontSizePt - 2);
  return `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${body.fontFamily};
  font-size: ${body.fontSizePt}pt;
  color: ${body.color};
  line-height: ${body.lineHeight};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Quebra explícita vinda de <!-- pagebreak --> no markdown. */
.page-break { break-after: page; }

/* Título não fica órfão no pé da página. */
h1, h2, h3, h4, h5, h6 { break-after: avoid; margin: 1.2em 0 0.5em; line-height: 1.25; }
h1:first-child, h2:first-child { margin-top: 0; }

/* Não parte no meio o que cabe inteiro na página seguinte. */
table, img, pre, blockquote, figure { break-inside: avoid; }
tr { break-inside: avoid; }
/* Cabeçalho da tabela repete quando ela atravessa páginas. */
thead { display: table-header-group; }

p, ul, ol { margin: 0 0 0.8em; }
li { margin-bottom: 0.25em; }
img { max-width: 100%; height: auto; }
a { color: #0b5cad; text-decoration: none; }

table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
th, td { border: 1px solid #d8d8d8; padding: 5pt 7pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 600; }

pre {
  background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 3pt;
  padding: 7pt; white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: ${codeSizePt}pt;
}
code { font-family: Consolas, 'Courier New', monospace; font-size: 0.92em; }
pre code { font-size: inherit; }
blockquote { margin: 0 0 1em; padding-left: 10pt; border-left: 2pt solid #d8d8d8; color: #555; }
hr { border: none; border-top: 1px solid #d8d8d8; margin: 1.2em 0; }
`.trim();
}

export function renderTemplate(
  template: TemplateInput | Template,
  opts: RenderTemplateOptions = {},
): RenderedTemplate {
  const { page, header, footer } = template;
  return {
    headerHtml: bandHtml(header, template, opts),
    footerHtml: bandHtml(footer, template, opts),
    css: buildCss(template),
    pdfOptions: {
      format: page.format,
      landscape: page.orientation === 'landscape',
      printBackground: true,
      displayHeaderFooter: !(bandIsEmpty(header) && bandIsEmpty(footer)),
      margin: {
        top: `${page.margins.top}mm`,
        right: `${page.margins.right}mm`,
        bottom: `${page.margins.bottom}mm`,
        left: `${page.margins.left}mm`,
      },
    },
  };
}

/** Envelopa o corpo já renderizado num documento HTML completo. */
export function buildDocumentHtml({
  css,
  bodyHtml,
}: {
  css: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
