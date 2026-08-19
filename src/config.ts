import path from 'node:path';

const root = process.env.MD2PDF_STORAGE ?? path.resolve(process.cwd(), 'storage');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  storage: {
    root,
    templates: path.join(root, 'templates'),
    assets: path.join(root, 'assets'),
    fonts: path.join(root, 'fonts'),
    /** Onde ficam os PDFs gerados no modo `output: "path"`. */
    outputs: process.env.MD2PDF_OUTPUT_DIR ?? path.join(root, 'outputs'),
  },
  /** Conversões simultâneas. Cada uma é um contexto de Chromium: acima disso a memória vira problema. */
  maxConcurrentConversions: Number(process.env.MAX_CONCURRENT ?? 4),
  /** Teto por conversão. Markdown patológico não pode segurar um worker para sempre. */
  conversionTimeoutMs: Number(process.env.CONVERSION_TIMEOUT_MS ?? 30_000),
  maxAssetBytes: 5 * 1024 * 1024,
  maxFontBytes: 2 * 1024 * 1024,
  /** TTL dos PDFs gravados em `storage.outputs`. `0` desliga a limpeza. */
  outputTtlMs: Number(process.env.MD2PDF_OUTPUT_TTL_MS ?? 24 * 60 * 60 * 1000),
  /** Frequência da varredura de limpeza. `0` desliga a limpeza. */
  outputCleanupIntervalMs: Number(process.env.MD2PDF_OUTPUT_CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000),
} as const;
