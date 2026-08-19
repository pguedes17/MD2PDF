import { chromium, type Browser } from 'playwright';
import { config } from '../config.js';
import { buildDocumentHtml, type PdfOptions } from './template.js';

export interface ConvertInput {
  bodyHtml: string;
  headerHtml: string;
  footerHtml: string;
  css: string;
  pdfOptions: PdfOptions;
  /** Se presente, o serviço usa este HTML como o documento inteiro
   *  (ignorando bodyHtml/css). Serve para a capa, que já vem como
   *  documento completo do renderer. */
  fullHtml?: string;
}

export interface PdfService {
  convert(input: ConvertInput): Promise<Buffer>;
  close(): Promise<void>;
}

export interface PdfServiceOptions {
  maxConcurrent?: number;
  timeoutMs?: number;
  /**
   * Permite que o documento busque imagens na rede. Desligado por padrão: o
   * markdown vem de fora e o servidor costuma enxergar a rede interna, então
   * uma URL no markdown viraria um SSRF barato.
   */
  allowRemoteResources?: boolean;
}

/** Limita quantas conversões rodam ao mesmo tempo; o excedente espera na fila. */
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active--;
    queue.shift()?.();
  };

  return async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * Serviço de impressão. Mantém um Chromium vivo para o processo inteiro: subir
 * um por request custa cerca de um segundo e memória à toa.
 */
export function createPdfService(options: PdfServiceOptions = {}): PdfService {
  const maxConcurrent = options.maxConcurrent ?? config.maxConcurrentConversions;
  const timeoutMs = options.timeoutMs ?? config.conversionTimeoutMs;
  const allowRemoteResources = options.allowRemoteResources ?? false;
  const withSlot = createSemaphore(maxConcurrent);

  let browserPromise: Promise<Browser> | null = null;
  let closed = false;

  function getBrowser(): Promise<Browser> {
    if (closed) throw new Error('pdfService já foi encerrado');
    browserPromise ??= chromium.launch({ args: ['--font-render-hinting=none'] });
    return browserPromise;
  }

  async function renderOnce(input: ConvertInput): Promise<Buffer> {
    const browser = await getBrowser();
    // javaScriptEnabled: false — o documento é conteúdo de terceiros; nada nele
    // precisa (ou deve) executar para virar papel.
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      if (!allowRemoteResources) {
        // Sem isso, uma <img src="http://..."> no markdown faz o Chromium
        // alcançar a rede a partir do servidor — e ainda segura a conversão
        // até o timeout do request.
        await context.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
            return route.continue();
          }
          return route.abort();
        });
      }

      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      const html = input.fullHtml ?? buildDocumentHtml({ css: input.css, bodyHtml: input.bodyHtml });
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: timeoutMs,
      });

      return await page.pdf({
        format: input.pdfOptions.format,
        landscape: input.pdfOptions.landscape,
        printBackground: input.pdfOptions.printBackground,
        displayHeaderFooter: input.pdfOptions.displayHeaderFooter,
        margin: input.pdfOptions.margin,
        headerTemplate: input.headerHtml,
        footerTemplate: input.footerHtml,
        preferCSSPageSize: false,
      });
    } finally {
      await context.close();
    }
  }

  return {
    convert(input) {
      return withSlot(async () => {
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            renderOnce(input),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`conversão excedeu ${timeoutMs}ms`)),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      });
    },

    async close() {
      closed = true;
      const pending = browserPromise;
      browserPromise = null;
      if (pending) await (await pending).close();
    },
  };
}
