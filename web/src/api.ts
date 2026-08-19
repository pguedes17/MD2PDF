import type {
  Template,
  TemplateInput,
  TemplateSummary,
} from '@shared/domain/template.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message ?? response.statusText, body.issues);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listTemplates: () => request<TemplateSummary[]>('/api/templates'),

  getTemplate: (id: string) => request<Template>(`/api/templates/${id}`),

  createTemplate: (input: TemplateInput) =>
    request<Template>('/api/templates', { method: 'POST', body: JSON.stringify(input) }),

  updateTemplate: (id: string, input: TemplateInput) =>
    request<Template>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${id}`, { method: 'DELETE' }),

  duplicateTemplate: (id: string) =>
    request<Template>(`/api/templates/${id}/duplicate`, { method: 'POST' }),

  /** Gera o PDF final e devolve o Blob + o filename sugerido pelo servidor. */
  async convertToPdf(input: {
    templateId: string;
    markdown: string;
    variables?: Record<string, string>;
    filename?: string;
  }): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.message ?? response.statusText, body.issues);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? input.filename ?? 'documento.pdf';
    return { blob: await response.blob(), filename };
  },

  async uploadAsset(file: File): Promise<{ assetId: string; mime: string; bytes: number }> {
    const form = new FormData();
    form.append('file', file);
    return request('/api/assets', { method: 'POST', body: form });
  },

  /** Devolve uma object URL do PDF de exemplo — quem chama precisa revogá-la. */
  async previewPdf(id: string, markdown?: string): Promise<string> {
    const response = await fetch(`/api/templates/${id}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.message ?? response.statusText, body.issues);
    }
    return URL.createObjectURL(await response.blob());
  },

  /** Baixa o bundle de exportação como Blob (JSON) + o filename sugerido. */
  async exportTemplate(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`/api/templates/${id}/export`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.message ?? response.statusText, body.issues);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? 'template.md2pdf.json';
    return { blob: await response.blob(), filename };
  },

  /** Importa um bundle já parseado como JSON e devolve o template criado. */
  importTemplate: (bundle: unknown) =>
    request<Template>('/api/templates/import', {
      method: 'POST',
      body: JSON.stringify(bundle),
    }),
};

export const assetUrl = (assetId: string) => `/api/assets/${assetId}`;
