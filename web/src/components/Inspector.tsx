import { useRef, useState } from 'react';
import type { TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { api, assetUrl } from '../api.js';
import {
  BAND_LABEL,
  describeElement,
  ELEMENT_LABEL,
  makeElement,
  replaceElement,
  updateZone,
  ZONE_LABEL,
  type Selection,
} from '../lib/templateModel.js';

interface InspectorProps {
  template: TemplateInput;
  selection: Selection | null;
  onChange: (next: TemplateInput) => void;
  onSelect: (selection: Selection | null) => void;
}

const PAGE_FORMATS = ['{page}', '{page} / {total}', 'Página {page} de {total}'];

const ELEMENT_TYPES: TemplateElement['type'][] = ['text', 'image', 'pageNumber', 'date'];

function TextProps({
  element,
  onChange,
}: {
  element: Extract<TemplateElement, { fontSizePt: number }>;
  onChange: (next: TemplateElement) => void;
}) {
  return (
    <>
      <div className="grid-2">
        <label className="field">
          <span className="label">tamanho (pt)</span>
          <input
            type="number"
            className="measure"
            min={4}
            max={72}
            value={element.fontSizePt}
            onChange={(event) => onChange({ ...element, fontSizePt: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="label">cor</span>
          <input
            type="color"
            value={element.color}
            onChange={(event) => onChange({ ...element, color: event.target.value })}
          />
        </label>
      </div>
      <label className="field--row">
        <input
          type="checkbox"
          checked={element.bold}
          onChange={(event) => onChange({ ...element, bold: event.target.checked })}
        />
        <span>Negrito</span>
      </label>
    </>
  );
}

function ImageProps({
  element,
  onChange,
}: {
  element: Extract<TemplateElement, { type: 'image' }>;
  onChange: (next: TemplateElement) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { assetId } = await api.uploadAsset(file);
      onChange({ ...element, assetId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível enviar a imagem');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {element.assetId ? (
        <img className="preview-img" src={assetUrl(element.assetId)} alt="" />
      ) : (
        <p className="hint">Nenhuma imagem escolhida.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Enviando...' : element.assetId ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
      </div>
      {error && <div className="notice notice--warn" style={{ marginTop: 8 }}>{error}</div>}

      <label className="field" style={{ marginTop: 10 }}>
        <span className="label">altura (mm)</span>
        <input
          type="number"
          className="measure"
          min={1}
          max={40}
          value={element.heightMm}
          onChange={(event) => onChange({ ...element, heightMm: Number(event.target.value) })}
        />
      </label>
    </>
  );
}

function ElementProps({
  element,
  onChange,
}: {
  element: TemplateElement;
  onChange: (next: TemplateElement) => void;
}) {
  switch (element.type) {
    case 'image':
      return <ImageProps element={element} onChange={onChange} />;

    case 'text':
      return (
        <>
          <label className="field">
            <span className="label">texto</span>
            <input
              type="text"
              value={element.value}
              onChange={(event) => onChange({ ...element, value: event.target.value })}
            />
          </label>
          <p className="hint">
            Use <code className="code">{'{{nome}}'}</code> para um valor que muda a cada conversão. A
            API preenche pelo campo <code className="code">variables</code>.
          </p>
          <TextProps element={element} onChange={onChange} />
        </>
      );

    case 'pageNumber':
      return (
        <>
          <label className="field">
            <span className="label">formato</span>
            <input
              type="text"
              value={element.format}
              onChange={(event) => onChange({ ...element, format: event.target.value })}
            />
          </label>
          <div className="chips">
            {PAGE_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                className="chip"
                onClick={() => onChange({ ...element, format })}
              >
                {format}
              </button>
            ))}
          </div>
          <p className="hint">
            <code className="code">{'{page}'}</code> e <code className="code">{'{total}'}</code> são
            preenchidos na impressão, página a página.
          </p>
          <div style={{ marginTop: 10 }}>
            <TextProps element={element} onChange={onChange} />
          </div>
        </>
      );

    case 'date':
      return (
        <>
          <label className="field">
            <span className="label">formato</span>
            <select
              value={element.format}
              onChange={(event) =>
                onChange({ ...element, format: event.target.value as typeof element.format })
              }
            >
              <option value="dd/MM/yyyy">31/12/2026</option>
              <option value="yyyy-MM-dd">2026-12-31</option>
              <option value="dd/MM/yyyy HH:mm">31/12/2026 14:05</option>
            </select>
          </label>
          <p className="hint">A data é a do momento da conversão.</p>
          <TextProps element={element} onChange={onChange} />
        </>
      );
  }
}

export function Inspector({ template, selection, onChange, onSelect }: InspectorProps) {
  if (!selection) {
    return (
      <div className="pane pane--right">
        <span className="label pane__title">elemento</span>
        <p className="hint">
          Clique numa das três zonas do cabeçalho ou do rodapé, na folha, para começar a montar.
        </p>
      </div>
    );
  }

  const { band, zone } = selection;
  const elements = template[band].zones[zone];
  const selectedIndex = selection.kind === 'element' ? selection.index : null;
  const selected = selectedIndex === null ? null : elements[selectedIndex];

  const addElement = (type: TemplateElement['type']) => {
    onChange(updateZone(template, band, zone, (list) => [...list, makeElement(type)]));
    onSelect({ kind: 'element', band, zone, index: elements.length });
  };

  const removeSelected = () => {
    if (selectedIndex === null) return;
    onChange(updateZone(template, band, zone, (list) => list.filter((_, i) => i !== selectedIndex)));
    onSelect({ kind: 'zone', band, zone });
  };

  return (
    <div className="pane pane--right">
      <span className="label pane__title">
        {BAND_LABEL[band]} · {ZONE_LABEL[zone]}
      </span>

      {elements.length === 0 ? (
        <p className="hint">Zona vazia.</p>
      ) : (
        <div className="stack">
          {elements.map((element, index) => (
            <button
              key={index}
              type="button"
              className={`elrow ${index === selectedIndex ? 'elrow--selected' : ''}`}
              onClick={() => onSelect({ kind: 'element', band, zone, index })}
            >
              <span className="elrow__kind">{ELEMENT_LABEL[element.type]}</span>
              <span className="elrow__desc">{describeElement(element)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="addmenu">
        <span className="label addmenu__title">adicionar</span>
        {ELEMENT_TYPES.map((type) => (
          <button key={type} type="button" className="btn btn--sm btn--ghost" onClick={() => addElement(type)}>
            <span className="addmenu__plus">+</span>
            {ELEMENT_LABEL[type]}
          </button>
        ))}
      </div>

      {selected && selectedIndex !== null && (
        <section className="pane__section">
          <span className="label pane__title">{ELEMENT_LABEL[selected.type]}</span>
          <ElementProps
            element={selected}
            onChange={(next) =>
              onChange(replaceElement(template, { kind: 'element', band, zone, index: selectedIndex }, next))
            }
          />
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn btn--sm btn--danger" onClick={removeSelected}>
              Remover elemento
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
