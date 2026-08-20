import { useEffect, useMemo, useState } from 'react';
import { TemplateInputSchema, type Template, type TemplateInput } from '@shared/domain/template.js';
import { api, ApiError, assetUrl } from '../api.js';
import { Brand } from '../components/Logo.js';
import { Sheet } from '../components/Sheet.js';
import { PageSettings } from '../components/PageSettings.js';
import { Inspector } from '../components/Inspector.js';
import { FontPicker } from '../components/FontPicker.js';
import { HeadingsPanel } from '../components/HeadingsPanel.js';
import { CoverEditor } from '../components/CoverEditor.js';
import { collectAssetIds, type Selection } from '../lib/templateModel.js';

interface TemplateEditorProps {
  templateId: string;
  onBack: () => void;
}

interface Flash {
  message: string;
  tone: 'ok' | 'warn';
}

type EditorTab = 'editor' | 'cover' | 'typography';

/** Só o que o servidor aceita em PUT — id e timestamps ficam com ele. */
function toInput(template: Template): TemplateInput {
  const { id, version, createdAt, updatedAt, ...input } = template;
  void id;
  void version;
  void createdAt;
  void updatedAt;
  return input;
}

export function TemplateEditor({ templateId, onBack }: TemplateEditorProps) {
  const [template, setTemplate] = useState<TemplateInput | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>('editor');

  useEffect(() => {
    let cancelled = false;
    api
      .getTemplate(templateId)
      .then((loaded) => {
        if (cancelled) return;
        setTemplate(toInput(loaded));
        setDirty(false);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  function announce(message: string, tone: Flash['tone'] = 'ok') {
    setFlash({ message, tone });
    setTimeout(() => setFlash(null), tone === 'ok' ? 2600 : 5000);
  }

  function edit(next: TemplateInput) {
    setTemplate(next);
    setDirty(true);
  }

  /** Shallow-merge a patch into the current template. */
  function updateTemplate(patch: Partial<TemplateInput>) {
    if (!template) return;
    edit({ ...template, ...patch });
  }

  const assets = useMemo(() => {
    if (!template) return {};
    return Object.fromEntries(collectAssetIds(template).map((id) => [id, assetUrl(id)]));
  }, [template]);

  /** Espelha no editor a mesma validação que o servidor aplicaria. */
  const issues = useMemo(() => {
    if (!template) return [];
    const result = TemplateInputSchema.safeParse(template);
    return result.success
      ? []
      : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  }, [template]);

  const blocked = issues.length > 0;

  async function save(): Promise<boolean> {
    if (!template || blocked) return false;
    setSaving(true);
    try {
      setTemplate(toInput(await api.updateTemplate(templateId, template)));
      setDirty(false);
      return true;
    } catch (err) {
      const message =
        err instanceof ApiError && err.issues?.length
          ? err.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' · ')
          : err instanceof Error
            ? err.message
            : 'não foi possível salvar';
      announce(message, 'warn');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    if (blocked) return;
    setPreviewing(true);
    try {
      // O preview imprime o que está salvo — então salva antes de imprimir.
      if (!(await save())) return;
      const url = await api.previewPdf(templateId);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      announce(err instanceof Error ? err.message : 'não foi possível gerar o preview', 'warn');
    } finally {
      setPreviewing(false);
    }
  }

  async function exportBundle() {
    if (dirty) {
      announce('Salve antes de exportar', 'warn');
      return;
    }
    try {
      const { blob, filename } = await api.exportTemplate(templateId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // Um tick pra o browser começar o download antes de revogar.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      announce('Bundle exportado');
    } catch (err) {
      announce(err instanceof Error ? err.message : 'não foi possível exportar', 'warn');
    }
  }

  if (!template) {
    return (
      <>
        <header className="topbar on-dark">
          <Brand />
        </header>
        <div className="shell">
          <div className="list">
            {loadError ? (
              <div className="notice notice--warn">{loadError}</div>
            ) : (
              <p className="hint">Carregando template...</p>
            )}
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--ghost" onClick={onBack}>
                ← Voltar para os templates
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="topbar on-dark">
        <Brand />
        <span className="topbar__divider" />
        <button type="button" className="btn btn--sm btn--quiet" onClick={onBack}>
          ← templates
        </button>
        <span className="topbar__title">{template.name}</span>
        {dirty && <span className="topbar__sub">não salvo</span>}

        <span className="topbar__spacer" />

        <div className="topbar__actions">
          {flash && (
            <span className={`flash ${flash.tone === 'warn' ? 'flash--warn' : ''}`}>
              {flash.message}
            </span>
          )}
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            disabled={dirty || blocked}
            title={dirty ? 'Salve antes de exportar' : 'Exportar bundle .md2pdf.json'}
            onClick={() => void exportBundle()}
          >
            Exportar
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={saving || blocked || !dirty}
            onClick={() => void save().then((ok) => ok && announce('Template salvo'))}
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={dirty || blocked}
            title={dirty ? 'Salve antes de gerar um PDF' : 'Abrir a tela de conversão'}
            onClick={() => {
              window.location.hash = `#/convert/${templateId}`;
            }}
          >
            Gerar PDF
          </button>
          <button
            type="button"
            className="btn btn--sm btn--accent"
            disabled={previewing || blocked}
            onClick={() => void preview()}
          >
            {previewing ? 'Gerando...' : 'Gerar PDF de exemplo'}
          </button>
        </div>
      </header>

      {/* Tab bar + banner + panels — flex-column so the banner never pushes
          the editor off-screen; the active .editor panel takes the rest. */}
      <div className="editor-body">
        {/* Tab bar */}
        <div className="editor-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'editor'}
            className={`editor-tabs__tab ${activeTab === 'editor' ? 'editor-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            Editor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cover'}
            className={`editor-tabs__tab ${activeTab === 'cover' ? 'editor-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab('cover')}
          >
            Capa
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'typography'}
            className={`editor-tabs__tab ${activeTab === 'typography' ? 'editor-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab('typography')}
          >
            Tipografia
          </button>
        </div>

        {/* Validation banner — visible on all tabs, shrinks flex but doesn't
            push the grid below the viewport */}
        {blocked && (
          <div className="notice notice--warn" style={{ margin: '0 16px 0', flexShrink: 0 }}>
            {issues.map((issue) => (
              <div key={issue.path}>
                <code className="code">{issue.path}</code> — {issue.message}
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Editor ─────────────────────────────────────────────────── */}
        {activeTab === 'editor' && (
          <div className="editor">
            <aside className="pane">
              <PageSettings template={template} templateId={templateId} onChange={edit} />
            </aside>

            <main className="bench">
              {/* a folha mede este container, não a bancada: assim um aviso acima
                  dela reduz a escala em vez de empurrar o rodapé para fora */}
              <div className="bench__stage">
                <Sheet
                  template={template}
                  assets={assets}
                  selection={selection}
                  onSelect={setSelection}
                  onElementChange={(band, index, next) =>
                    edit({
                      ...template,
                      [band]: {
                        ...template[band],
                        elements: template[band].elements.map((e, i) => (i === index ? next : e)),
                      },
                    })
                  }
                />
              </div>

              {!selection && (
                <p className="bench__hint">clique numa zona do cabeçalho ou do rodapé para editar</p>
              )}
            </main>

            <Inspector template={template} selection={selection} onChange={edit} onSelect={setSelection} />
          </div>
        )}

        {/* ── Tab: Capa ───────────────────────────────────────────────────── */}
        {activeTab === 'cover' && (
          <div className="editor editor--two-col">
            <aside className="pane" style={{ overflowY: 'auto' }}>
              <section className="pane__section">
                <span className="label pane__title">capa</span>

                <label className="field--row">
                  <input
                    type="checkbox"
                    checked={template.cover.enabled}
                    onChange={(e) =>
                      updateTemplate({ cover: { ...template.cover, enabled: e.target.checked } })
                    }
                  />
                  <span>Habilitar capa</span>
                </label>

                {template.cover.enabled && (
                  <label className="field--row" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={template.cover.applyHeaderFooter}
                      onChange={(e) =>
                        updateTemplate({
                          cover: { ...template.cover, applyHeaderFooter: e.target.checked },
                        })
                      }
                    />
                    <span>Aplicar cabeçalho e rodapé também na capa</span>
                  </label>
                )}
              </section>
            </aside>

            <main className="bench" style={{ padding: 0, overflow: 'hidden' }}>
              {template.cover.enabled ? (
                <CoverEditor
                  template={template}
                  onChange={(patch) =>
                    updateTemplate({ cover: { ...template.cover, ...patch } })
                  }
                  assets={assets}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                  }}
                >
                  <p className="hint">Habilite a capa no painel à esquerda para começar a editá-la.</p>
                </div>
              )}
            </main>
          </div>
        )}

        {/* ── Tab: Tipografia ─────────────────────────────────────────────── */}
        {activeTab === 'typography' && (
          <div className="editor editor--two-col">
            <aside className="pane" style={{ overflowY: 'auto' }}>
              <section className="pane__section">
                <span className="label pane__title">fonte do corpo</span>
                <FontPicker
                  value={template.body.font}
                  onChange={(next) =>
                    updateTemplate({ body: { ...template.body, font: next } })
                  }
                />
              </section>

              <section className="pane__section">
                <span className="label pane__title">estilos de títulos</span>
                <HeadingsPanel
                  value={template.headings}
                  onChange={(next) => updateTemplate({ headings: next })}
                />
              </section>
            </aside>

            <main className="bench">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <p className="hint">
                  As configurações de tipografia afetam o corpo do documento e os títulos gerados
                  a partir do Markdown.
                </p>
              </div>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
