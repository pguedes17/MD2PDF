import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { createConversionService, type ConversionService } from './conversion.js';
import { MissingAssetError } from './render/template.js';
import type { PdfService } from './render/pdf.js';
import type { TemplateRepo } from './storage/templateRepo.js';
import type { AssetRepo } from './storage/assetRepo.js';
import type { OutputStore } from './storage/outputStore.js';
import { templateRoutes } from './routes/templates.js';
import { assetRoutes } from './routes/assets.js';
import { convertRoutes } from './routes/convert.js';

export interface AppDeps {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  conversionService: ConversionService;
  outputStore: OutputStore;
}

export interface BuildAppOptions {
  templateRepo: TemplateRepo;
  assetRepo: AssetRepo;
  pdfService: PdfService;
  outputStore: OutputStore;
  logger?: boolean;
}

interface HttpishError extends Error {
  statusCode?: number;
  code?: string;
  issues?: unknown;
}

/**
 * Monta a aplicação a partir de dependências explícitas — é o que permite os
 * testes rodarem contra um diretório temporário sem tocar no storage real.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 10 * 1024 * 1024 });

  const deps: AppDeps = {
    templateRepo: options.templateRepo,
    assetRepo: options.assetRepo,
    outputStore: options.outputStore,
    conversionService: createConversionService({
      templateRepo: options.templateRepo,
      assetRepo: options.assetRepo,
      pdfService: options.pdfService,
    }),
  };

  app.register(multipart, { limits: { fileSize: config.maxAssetBytes, files: 1 } });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (instance) => templateRoutes(instance, deps));
  app.register(async (instance) => assetRoutes(instance, deps));
  app.register(async (instance) => convertRoutes(instance, deps));

  app.setErrorHandler((error: HttpishError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'falha ao processar request');
      return reply.code(500).send({ error: 'internal_error', message: 'falha ao gerar o documento' });
    }

    if (error instanceof MissingAssetError) {
      return reply.code(422).send({
        error: 'asset_not_found',
        message: error.message,
        assetId: error.assetId,
      });
    }

    return reply.code(statusCode).send({
      error: error.code ?? 'bad_request',
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    });
  });

  app.addHook('onClose', async () => {
    await options.pdfService.close();
  });

  return app;
}
