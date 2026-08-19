import type { z } from 'zod';

/** 400 com a lista de problemas, em vez de um 500 genérico do Zod. */
export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'validation_failed';
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('validação falhou');
    this.name = 'ValidationError';
  }
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
