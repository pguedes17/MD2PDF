import { useEffect, useMemo, useState } from 'react';
import { TemplateInputSchema, type Template, type TemplateInput } from '@shared/domain/template.js';
import { api, ApiError, assetUrl } from '../api.js';
import { Brand } from '../components/Logo.js';
import { Sheet } from '../components/Sheet.js';
import { PageSettings } from '../components/PageSettings.js';
import { Inspector } from '../components/Inspector.js';
import { FontPicker } from '../components/FontPicker.js';
import { HeadingsPanel } from '../components/HeadingsPanel.js';
import {
  CoverEditor,
  CoverElementInspector,
  ELEMENT_LABEL as COVER_ELEMENT_LABEL,
  makeCoverElement,
  nextCoverYMm,
} from '../components/CoverEditor.js';
import { Icon } from '../components/Icon.js';
import { PAGE_SIZES_MM } from '@shared/domain/template.js';
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
  const [coverSelected, setCoverSelected] = useState<number | null>(null);

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
            <Icon name="file-down" />
            Exportar
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={saving || blocked || !dirty}
            onClick={() => void save().then((ok) => ok && announce('Template salvo'))}
          >
            <Icon name="check" />
            {saving ? 'Salvando…' : 'Salvar'}
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
            <Icon name="external-link" />
            Gerar PDF
          </button>
          <button
            type="button"
            className="btn btn--sm btn--accent"
            disabled={previewing || blocked}
            onClick={() => void preview()}
          >
            <Icon name="file-down" />
            {previewing ? 'Gerando…' : 'Gerar PDF de exemplo'}
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
        {activeTab === 'cover' && (() => {
          const cover = template.cover;
          const pageSize = PAGE_SIZES_MM[template.page.format];
          const pageH = template.page.orientation === 'landscape' ? pageSize.width : pageSize.height;

          const updateCover = (patch: Partial<TemplateInput['cover']>) =>
            updateTemplate({ cover: { ...template.cover, ...patch } });

          const addCoverElement = (type: 'text' | 'image' | 'date') => {
            const el = makeCoverElement(type, nextCoverYMm(cover.elements, pageH));
            updateCover({ elements: [...cover.elements, el] });
            setCoverSelected(cover.elements.length);
          };

          const updateCoverElement = (i: number, next: typeof cover.elements[number]) => {
            updateCover({ elements: cover.elements.map((el, idx) => (idx === i ? next : el)) });
          };

          const removeCoverElement = (i: number) => {
            updateCover({ elements: cover.elements.filter((_, idx) => idx !== i) });
            setCoverSelected(null);
          };

          const selectedIsValid = coverSelected !== null && coverSelected < cover.elements.length;
          const selectedEl = selectedIsValid ? cover.elements[coverSelected]! : null;

          return (
            <div className="editor">
              {/* Coluna esquerda: PageSettings do template (igual ao Editor tab) */}
              <aside className="pane">
                <PageSettings template={template} templateId={templateId} onChange={edit} />
              </aside>

              {/* Coluna central: a folha da capa */}
              <main className="bench">
                {cover.enabled ? (
                  <div className="bench__stage">
                    <CoverEditor
                      template={template}
                      onElementChange={updateCoverElement}
                      selected={coverSelected}
                      onSelect={setCoverSelected}
                      variables={{}}
                      assets={assets}
                    />
                  </div>
                ) : (
                  <p className="bench__hint">
                    Habilite a capa no painel à direita para começar a editá-la.
                  </p>
                )}
              </main>

              {/* Coluna direita: TODOS os controles da capa (toggles, adicionar,
                  lista de elementos, inspector do elemento selecionado). Espelha
                  o padrão do Editor tab onde o Inspector fica à direita. */}
              <div className="pane pane--right">
                <section className="pane__section">
                  <span className="label pane__title">capa</span>
                  <label className="field--row">
                    <input
                      type="checkbox"
                      checked={cover.enabled}
                      onChange={(e) => updateCover({ enabled: e.target.checked })}
                    />
                    <span>Habilitar capa</span>
                  </label>
                </section>

                {cover.enabled && (
                  <>
                    <section className="pane__section">
                      <span className="label pane__title">bandas do template</span>
                      <label className="field--row">
                        <input
                          type="checkbox"
                          checked={cover.applyHeader}
                          onChange={(e) => updateCover({ applyHeader: e.target.checked })}
                        />
                        <span>Mostrar cabeçalho na capa</span>
                      </label>
                      <label className="field--row" style={{ marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={cover.applyFooter}
                          onChange={(e) => updateCover({ applyFooter: e.target.checked })}
                        />
                        <span>Mostrar rodapé na capa</span>
                      </label>
                    </section>

                    <section className="pane__section">
                      <span className="label pane__title">adicionar elemento</span>
                      <div className="stack">
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => addCoverElement('text')}
                        >
                          <Icon name="plus" />
                          texto
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => addCoverElement('image')}
                        >
                          <Icon name="plus" />
                          imagem
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => addCoverElement('date')}
                        >
                          <Icon name="plus" />
                          data
                        </button>
                      </div>
                    </section>

                    {cover.elements.length > 0 && !selectedEl && (
                      <section className="pane__section">
                        <span className="label pane__title">
                          elementos ({cover.elements.length})
                        </span>
                        <p className="hint" style={{ marginBottom: 8 }}>
                          Clique num elemento para editá-lo.
                        </p>
                        <div className="stack">
                          {cover.elements.map((el, i) => {
                            const desc =
                              el.type === 'text'
                                ? el.value || '(vazio)'
                                : el.type === 'date'
                                  ? el.format
                                  : el.assetId
                                    ? `${el.heightMm}mm`
                                    : 'sem imagem';
                            return (
                              <button
                                key={i}
                                type="button"
                                className={`elrow ${coverSelected === i ? 'elrow--selected' : ''}`}
                                onClick={() => setCoverSelected(i)}
                              >
                                <span className="elrow__kind">{COVER_ELEMENT_LABEL[el.type]}</span>
                                <span className="elrow__desc">{desc}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {selectedEl && (
                      <CoverElementInspector
                        el={selectedEl}
                        index={coverSelected!}
                        pageHeightMm={pageH}
                        onChange={(next) => updateCoverElement(coverSelected!, next)}
                        onRemove={() => removeCoverElement(coverSelected!)}
                        onUploadImage={api.uploadAsset}
                        assetUrl={assetUrl}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

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
