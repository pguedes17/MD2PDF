import { useEffect, useRef, useState } from 'react';
import { makeBlankTemplateInput, type Template } from '@shared/domain/template.js';
import { api, ApiError } from '../api.js';
import { Brand, LogoMark } from '../components/Logo.js';
import { SheetThumb } from '../components/SheetThumb.js';
import { Icon } from '../components/Icon.js';
import { buildImportOpenApi } from '../lib/importOpenApi.js';

interface TemplateListProps {
  onOpen: (id: string) => void;
  onConvert: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Os fatos que distinguem um template do outro, em chips compactos. */
function facts(template: Template): string[] {
  const elements = [template.header, template.footer].flatMap((band) => band.elements);
  const out = [
    `${template.page.format} ${template.page.orientation === 'landscape' ? 'paisagem' : 'retrato'}`,
  ];
  if (elements.some((el) => el.type === 'image')) out.push('logo');
  if (elements.some((el) => el.type === 'pageNumber')) out.push('paginado');
  if (elements.some((el) => el.type === 'text' && el.value.includes('{{'))) out.push('variáveis');
  if (template.cover.enabled) out.push('capa');
  return out;
}

export function TemplateList({ onOpen, onConvert }: TemplateListProps) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedOpenApi, setCopiedOpenApi] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      const summaries = await api.listTemplates();
      setTemplates(await Promise.all(summaries.map((summary) => api.getTemplate(summary.id))));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível carregar os templates');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function create() {
    setCreating(true);
    try {
      const created = await api.createTemplate(makeBlankTemplateInput('Novo template'));
      onOpen(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível criar o template');
      setCreating(false);
    }
  }

  async function remove(template: Template) {
    const confirmed = window.confirm(
      `Excluir "${template.name}"?\n\nAs conversões que usam ${template.id} vão passar a falhar.`,
    );
    if (!confirmed) return;
    await api.deleteTemplate(template.id);
    void reload();
  }

  async function duplicate(template: Template) {
    try {
      const copy = await api.duplicateTemplate(template.id);
      await reload();
      onOpen(copy.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível duplicar');
    }
  }

  async function copyId(id: string) {
    await navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  async function copyOpenApi() {
    const doc = buildImportOpenApi({ serverUrl: window.location.origin });
    await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    setCopiedOpenApi(true);
    setTimeout(() => setCopiedOpenApi(false), 1800);
  }

  async function importBundle(file: File) {
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      let bundle: unknown;
      try {
        bundle = JSON.parse(text);
      } catch {
        throw new Error('arquivo não é um JSON válido');
      }
      const created = await api.importTemplate(bundle);
      await reload();
      onOpen(created.id);
    } catch (err) {
      const message =
        err instanceof ApiError && err.issues?.length
          ? err.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' · ')
          : err instanceof Error
            ? err.message
            : 'não foi possível importar';
      setError(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <header className="topbar on-dark">
        <Brand />
        <span className="topbar__divider" />
        <span className="topbar__sub">templates</span>
        <span className="topbar__spacer" />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importBundle(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${copiedOpenApi ? 'btn--icon--ok' : ''}`}
          title={
            copiedOpenApi
              ? 'OpenAPI copiado!'
              : 'Copia o OpenAPI 3.0.3 com todas as tools MCP (import docx + list + get + convert). Cole em OAS2MCP ou equivalente.'
          }
          onClick={() => void copyOpenApi()}
        >
          <Icon name={copiedOpenApi ? 'check' : 'braces'} />
          {copiedOpenApi ? 'Copiado!' : 'Copiar OpenAPI'}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={importing}
          onClick={() => importInputRef.current?.click()}
        >
          <Icon name="upload" />
          {importing ? 'Importando…' : 'Importar'}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          disabled={creating}
          onClick={() => void create()}
        >
          <Icon name="plus" />
          {creating ? 'Criando…' : 'Novo template'}
        </button>
      </header>

      <div className="shell">
        <div className="list">
          <div className="masthead">
            <div className="masthead__intro">
              <span className="label masthead__eyebrow">papel timbrado</span>
              <h1 className="masthead__title">
                Monte uma vez.
                <br />
                Converta sempre.
              </h1>
              <p className="masthead__lede">
                Um template guarda o cabeçalho, o rodapé e as margens de todas as páginas. Depois
                de salvo, ele ganha um id — e é só esse id que a sua aplicação precisa saber.
              </p>
            </div>

            <div className="endpoint">
              <div className="endpoint__head">
                <span className="endpoint__verb">POST</span>
                <span className="endpoint__path">/api/convert</span>
              </div>
              <pre className="endpoint__body">
{`{
  `}<span className="endpoint__key">"templateId"</span>{`: `}<span className="endpoint__val">"tpl_…"</span>{`,
  `}<span className="endpoint__key">"markdown"</span>{`:   `}<span className="endpoint__val">"# Contrato…"</span>{`
}
→ application/pdf`}
              </pre>
            </div>
          </div>

          {error && (
            <div className="notice notice--warn" style={{ marginBottom: 20 }}>
              {error}
            </div>
          )}

          <div className="cards">
            {templates === null &&
              [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}

            {templates?.length === 0 && (
              <div className="empty">
                <LogoMark size={40} />
                <h2 className="empty__title">Nenhum template ainda</h2>
                <p className="empty__text">
                  Comece por um em branco: escolha o formato, a altura das faixas e arraste os
                  elementos para as zonas do cabeçalho e do rodapé.
                </p>
                <button type="button" className="btn btn--accent" onClick={() => void create()}>
                  <Icon name="plus" />
                  Criar o primeiro template
                </button>
              </div>
            )}

            {templates?.map((template, index) => (
              <article
                key={template.id}
                className="card"
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              >
                <SheetThumb template={template} />

                <div className="card__body">
                  <header className="card__header">
                    <h2 className="card__name" title={template.name}>
                      {template.name}
                    </h2>
                    <time className="card__date" dateTime={template.updatedAt}>
                      {formatDate(template.updatedAt)}
                    </time>
                  </header>

                  <div className="card__meta">
                    {facts(template).map((fact) => (
                      <span key={fact} className="fact">
                        {fact}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={`idchip ${copied === template.id ? 'idchip--copied' : ''}`}
                    title="Copiar o id para usar na API"
                    onClick={() => void copyId(template.id)}
                  >
                    <span className="idchip__id">{template.id}</span>
                    <Icon name={copied === template.id ? 'check' : 'copy'} size={13} />
                  </button>
                </div>

                <footer className="card__foot">
                  <div className="card__foot-secondary">
                    <button
                      type="button"
                      className="btn btn--icon btn--danger"
                      title="Excluir template"
                      aria-label="Excluir template"
                      onClick={() => void remove(template)}
                    >
                      <Icon name="trash" />
                    </button>
                    <button
                      type="button"
                      className="btn btn--icon btn--quiet"
                      title="Duplicar template"
                      aria-label="Duplicar template"
                      onClick={() => void duplicate(template)}
                    >
                      <Icon name="files" />
                    </button>
                  </div>

                  <div className="card__foot-primary">
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => onOpen(template.id)}
                    >
                      <Icon name="edit" />
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--accent"
                      title="Cole um markdown, informe as variáveis e baixe o PDF"
                      onClick={() => onConvert(template.id)}
                    >
                      <Icon name="file-down" />
                      Gerar PDF
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
