import { useEffect, useState } from 'react';
import { makeBlankTemplateInput, type Template } from '@shared/domain/template.js';
import { api } from '../api.js';
import { Brand, LogoMark } from '../components/Logo.js';
import { SheetThumb } from '../components/SheetThumb.js';

interface TemplateListProps {
  onOpen: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Os fatos que distinguem um template do outro, em uma linha. */
function facts(template: Template): string[] {
  const elements = [template.header, template.footer].flatMap((band) => band.elements);
  const out = [
    `${template.page.format} ${template.page.orientation === 'landscape' ? 'paisagem' : 'retrato'}`,
  ];
  if (elements.some((el) => el.type === 'image')) out.push('logo');
  if (elements.some((el) => el.type === 'pageNumber')) out.push('paginado');
  if (elements.some((el) => el.type === 'text' && el.value.includes('{{'))) out.push('variáveis');
  return out;
}

export function TemplateList({ onOpen }: TemplateListProps) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      const summaries = await api.listTemplates();
      // O card desenha o timbre de verdade, então precisa do template inteiro.
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

  async function copyId(id: string) {
    await navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <header className="topbar on-dark">
        <Brand />
        <span className="topbar__divider" />
        <span className="topbar__sub">templates</span>
        <span className="topbar__spacer" />
        <button type="button" className="btn btn--accent" disabled={creating} onClick={() => void create()}>
          {creating ? 'Criando...' : 'Novo template'}
        </button>
      </header>

      <div className="shell">
        <div className="list">
          <div className="masthead">
            <div>
              <span className="label masthead__eyebrow">papel timbrado</span>
              <h1 className="masthead__title">
                Monte uma vez.
                <br />
                Converta sempre.
              </h1>
              <p className="masthead__lede">
                Um template guarda o cabeçalho, o rodapé e as margens de todas as páginas. Depois de
                salvo, ele ganha um id — e é só esse id que a sua aplicação precisa saber.
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

          {error && <div className="notice notice--warn" style={{ marginBottom: 20 }}>{error}</div>}

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
                  <h2 className="card__name">{template.name}</h2>

                  <div className="card__facts">
                    {facts(template).map((fact) => (
                      <span key={fact} className="fact">
                        {fact}
                      </span>
                    ))}
                    <time className="card__date" dateTime={template.updatedAt}>
                      {formatDate(template.updatedAt)}
                    </time>
                  </div>

                  <div className="card__foot">
                    <button
                      type="button"
                      className={`idchip ${copied === template.id ? 'idchip--copied' : ''}`}
                      title="Copiar o id para usar na API"
                      onClick={() => void copyId(template.id)}
                    >
                      {template.id}
                      <span className="idchip__action">
                        {copied === template.id ? 'copiado' : 'copiar'}
                      </span>
                    </button>

                    <span className="card__spacer" />

                    <button
                      type="button"
                      className="btn btn--sm btn--quiet"
                      onClick={() => void remove(template)}
                    >
                      Excluir
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => onOpen(template.id)}
                    >
                      Abrir
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
