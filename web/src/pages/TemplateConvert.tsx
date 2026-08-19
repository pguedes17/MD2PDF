import { useEffect, useMemo, useRef, useState } from 'react';
import type { Template } from '@shared/domain/template.js';
import { api, ApiError } from '../api.js';
import { Brand } from '../components/Logo.js';
import { collectVariables } from '../lib/templateModel.js';

interface TemplateConvertProps {
  templateId: string;
  onBack: () => void;
}

export function TemplateConvert({ templateId, onBack }: TemplateConvertProps) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [filename, setFilename] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getTemplate(templateId)
      .then((loaded) => !cancelled && setTemplate(loaded))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const variables = useMemo(() => (template ? collectVariables(template) : []), [template]);

  async function pickFile(file: File) {
    // .md é texto; qualquer coisa fora disso o usuário vai descobrir na conversão.
    const text = await file.text();
    setMarkdown(text);
    if (!filename) {
      const base = file.name.replace(/\.[^.]+$/, '');
      setFilename(base ? `${base}.pdf` : '');
    }
  }

  async function generate() {
    if (!template) return;
    setError(null);
    setGenerating(true);
    try {
      const { blob, filename: served } = await api.convertToPdf({
        templateId,
        markdown,
        variables: variables.length > 0 ? values : undefined,
        filename: filename.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = served;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (err) {
      const message =
        err instanceof ApiError && err.issues?.length
          ? err.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' · ')
          : err instanceof Error
            ? err.message
            : 'não foi possível gerar o PDF';
      setError(message);
    } finally {
      setGenerating(false);
    }
  }

  if (!template) {
    return (
      <>
        <header className="topbar on-dark">
          <Brand />
          <span className="topbar__divider" />
          <button type="button" className="btn btn--sm btn--quiet" onClick={onBack}>
            ← templates
          </button>
        </header>
        <div className="shell">
          <div className="list">
            {loadError ? (
              <div className="notice notice--warn">{loadError}</div>
            ) : (
              <p className="hint">Carregando template...</p>
            )}
          </div>
        </div>
      </>
    );
  }

  const missingVariables = variables.filter((name) => !values[name]?.trim());
  const canGenerate =
    !generating && markdown.trim().length > 0 && missingVariables.length === 0;

  return (
    <>
      <header className="topbar on-dark">
        <Brand />
        <span className="topbar__divider" />
        <button type="button" className="btn btn--sm btn--quiet" onClick={onBack}>
          ← templates
        </button>
        <span className="topbar__title">Gerar PDF · {template.name}</span>
        <span className="topbar__spacer" />
        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--sm btn--accent"
            disabled={!canGenerate}
            onClick={() => void generate()}
            title={
              markdown.trim().length === 0
                ? 'Cole ou faça upload de um markdown antes de gerar'
                : missingVariables.length > 0
                  ? `Preencha: ${missingVariables.join(', ')}`
                  : 'Gerar e baixar o PDF'
            }
          >
            {generating ? 'Gerando...' : 'Gerar PDF'}
          </button>
        </div>
      </header>

      <div className="convert">
        <section className="convert__editor">
          <div className="convert__toolbar">
            <span className="label pane__title">markdown</span>
            <span className="convert__spacer" />
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pickFile(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload .md
            </button>
            <button
              type="button"
              className="btn btn--sm btn--quiet"
              disabled={markdown.length === 0}
              onClick={() => setMarkdown('')}
            >
              Limpar
            </button>
          </div>
          <textarea
            className="convert__textarea"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            placeholder={`# Título

Cole aqui o conteúdo do documento em Markdown, ou clique em "Upload .md".

Use <!-- pagebreak --> para forçar uma quebra de página.`}
            spellCheck={false}
          />
        </section>

        <aside className="pane pane--right">
          <section className="pane__section">
            <span className="label pane__title">arquivo</span>
            <label className="field">
              <span className="label">nome do PDF</span>
              <input
                type="text"
                value={filename}
                placeholder={`${template.name}.pdf`}
                onChange={(event) => setFilename(event.target.value)}
              />
            </label>
          </section>

          <section className="pane__section">
            <span className="label pane__title">variáveis</span>
            {variables.length === 0 ? (
              <p className="hint">Este template não usa variáveis.</p>
            ) : (
              variables.map((name) => (
                <label key={name} className="field">
                  <span className="label">{name}</span>
                  <input
                    type="text"
                    value={values[name] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [name]: event.target.value }))
                    }
                  />
                </label>
              ))
            )}
          </section>

          {error && <div className="notice notice--warn">{error}</div>}
        </aside>
      </div>
    </>
  );
}
