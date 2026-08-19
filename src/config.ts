import path from 'node:path';

const root = process.env.MD2PDF_STORAGE ?? path.resolve(process.cwd(), 'storage');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  storage: {
    root,
    templates: path.join(root, 'templates'),
    assets: path.join(root, 'assets'),
  },
  /** Conversões simultâneas. Cada uma é um contexto de Chromium: acima disso a memória vira problema. */
  maxConcurrentConversions: Number(process.env.MAX_CONCURRENT ?? 4),
  /** Teto por conversão. Markdown patológico não pode segurar um worker para sempre. */
  conversionTimeoutMs: Number(process.env.CONVERSION_TIMEOUT_MS ?? 30_000),
  maxAssetBytes: 5 * 1024 * 1024,
} as const;
