import { useEffect, useRef, useState } from 'react';
import type { TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { api, assetUrl } from '../api.js';
import {
  BAND_LABEL,
  describeElement,
  ELEMENT_LABEL,
  makeElement,
  NUDGE_FINE_MM,
  NUDGE_MM,
  replaceElement,
  updateBand,
  type Selection,
} from '../lib/templateModel.js';

interface InspectorProps {
  template: TemplateInput;
  selection: Selection;
  onChange: (next: TemplateInput) => void;
  onSelect: (selection: Selection) => void;
}

const PAGE_FORMATS = ['{page}', '{page} / {total}', 'Página {page} de {total}'];

const ELEMENT_TYPES: TemplateElement['type'][] = ['text', 'image', 'pageNumber', 'date'];

function PositionBlock({
  element,
  onChange,
}: {
  element: TemplateElement;
  onChange: (next: TemplateElement) => void;
}) {
  const setAlign = (align: TemplateElement['align']) =>
    onChange({ ...element, align, xOffsetMm: 0 } as TemplateElement);
  return (
    <>
      <span className="label pane__title">posição</span>
      <div className="align-shortcut" role="group" aria-label="alinhamento">
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'left' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('left')}
          aria-pressed={element.align === 'left'}
        >
          ⇤ esq.
        </button>
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'center' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('center')}
          aria-pressed={element.align === 'center'}
        >
          ↔ centro
        </button>
        <button
          type="button"
          className={`btn btn--sm btn--ghost ${element.align === 'right' ? 'align-shortcut__active' : ''}`}
          onClick={() => setAlign('right')}
          aria-pressed={element.align === 'right'}
        >
          ⇥ dir.
        </button>
      </div>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <label className="field">
          <span className="label">x offset (mm)</span>
          <input
            type="number"
            className="measure"
            step={0.5}
            value={element.xOffsetMm}
            onChange={(event) => onChange({ ...element, xOffsetMm: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="label">y (mm)</span>
          <input
            type="number"
            className="measure"
            step={0.5}
            min={0}
            value={element.yMm}
            onChange={(event) => onChange({ ...element, yMm: Number(event.target.value) })}
          />
        </label>
      </div>
    </>
  );
}

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
  const selectedIndex = selection && selection.index !== null ? selection.index : null;
  const selected =
    selection && selectedIndex !== null ? template[selection.band].elements[selectedIndex] : null;

  // Teclado: nudge de posição, remover, desselecionar. Só quando há elemento
  // selecionado e o foco NÃO está num campo de texto (senão as setas movem o cursor).
  useEffect(() => {
    if (!selection || selectedIndex === null || !selected) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      const amount = event.shiftKey ? NUDGE_FINE_MM : NUDGE_MM;
      const dxScreen =
        event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      if (dxScreen !== 0 || dy !== 0) {
        event.preventDefault();
        const dxOffset = selected.align === 'right' ? -dxScreen : dxScreen;
        const next: TemplateElement = {
          ...selected,
          xOffsetMm: selected.xOffsetMm + dxOffset,
          yMm: Math.max(0, selected.yMm + dy),
        } as TemplateElement;
        onChange(replaceElement(template, { band: selection.band, index: selectedIndex }, next));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onChange(
          updateBand(template, selection.band, (list) => list.filter((_, i) => i !== selectedIndex)),
        );
        onSelect({ band: selection.band, index: null });
        return;
      }
      if (event.key === 'Escape') {
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, selectedIndex, selected, template, onChange, onSelect]);

  if (!selection) {
    return (
      <div className="pane pane--right">
        <span className="label pane__title">elemento</span>
        <p className="hint">
          Clique num elemento na folha para editá-lo, ou numa faixa para adicionar novos.
        </p>
      </div>
    );
  }

  const { band } = selection;
  const elements = template[band].elements;

  const addElement = (type: TemplateElement['type']) => {
    onChange(updateBand(template, band, (list) => [...list, makeElement(type)]));
    onSelect({ band, index: elements.length });
  };

  const removeSelected = () => {
    if (selectedIndex === null) return;
    onChange(updateBand(template, band, (list) => list.filter((_, i) => i !== selectedIndex)));
    onSelect({ band, index: null });
  };

  return (
    <div className="pane pane--right">
      <span className="label pane__title">{BAND_LABEL[band]}</span>

      {elements.length === 0 ? (
        <p className="hint">Faixa vazia.</p>
      ) : (
        <div className="stack">
          {elements.map((element, index) => (
            <button
              key={index}
              type="button"
              className={`elrow ${index === selectedIndex ? 'elrow--selected' : ''}`}
              onClick={() => onSelect({ band, index })}
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
          <button
            key={type}
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => addElement(type)}
          >
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
              onChange(replaceElement(template, { band, index: selectedIndex }, next))
            }
          />
          <div style={{ marginTop: 14 }}>
            <PositionBlock
              element={selected}
              onChange={(next) =>
                onChange(replaceElement(template, { band, index: selectedIndex }, next))
              }
            />
          </div>
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
