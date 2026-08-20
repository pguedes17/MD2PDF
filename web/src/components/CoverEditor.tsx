import { useCallback, useRef, useState } from 'react';
import type { TemplateCoverElement, TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { PAGE_SIZES_MM } from '@shared/domain/template.js';
import { elementInnerHtml, elementPosition } from '@shared/render/template.js';
import { MM_TO_PX, mm, useFitScale } from '../hooks/useFitScale.js';
import { SNAP_ANCHOR_MM } from '../lib/templateModel.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverEditorProps {
  template: TemplateInput;
  onElementChange: (index: number, next: TemplateCoverElement) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
  variables?: Record<string, string>;
  assets?: Record<string, string>;
}

interface DragState {
  originClientX: number;
  originClientY: number;
  originEl: TemplateCoverElement;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pageDims(t: TemplateInput): { w: number; h: number } {
  const s = PAGE_SIZES_MM[t.page.format];
  const [w, h] =
    t.page.orientation === 'landscape' ? [s.height, s.width] : [s.width, s.height];
  return { w, h };
}

function estimateElementHeight(el: TemplateCoverElement): number {
  if (el.type === 'image') return el.heightMm;
  return el.fontSizePt * 0.353 * 1.2;
}

function anchorAbsoluteX(
  align: TemplateCoverElement['align'],
  xOffsetMm: number,
  widthMm: number,
): number {
  switch (align) {
    case 'left':
      return xOffsetMm;
    case 'right':
      return widthMm - xOffsetMm;
    case 'center':
      return widthMm / 2 + xOffsetMm;
  }
}

function offsetForAbsoluteX(
  align: TemplateCoverElement['align'],
  absoluteXMm: number,
  widthMm: number,
): number {
  switch (align) {
    case 'left':
      return absoluteXMm;
    case 'right':
      return widthMm - absoluteXMm;
    case 'center':
      return absoluteXMm - widthMm / 2;
  }
}

function applyCoverDragDelta(
  origin: TemplateCoverElement,
  dxScreenMm: number,
  dyMm: number,
  pageWidthMm: number,
  pageHeightMm: number,
): TemplateCoverElement {
  const maxY = Math.max(0, pageHeightMm - estimateElementHeight(origin));
  const yMm = Math.max(0, Math.min(maxY, origin.yMm + dyMm));

  const absoluteXMm = anchorAbsoluteX(origin.align, origin.xOffsetMm, pageWidthMm) + dxScreenMm;
  const clamped = Math.max(0, Math.min(pageWidthMm, absoluteXMm));

  const distToLeft = clamped;
  const distToCenter = Math.abs(clamped - pageWidthMm / 2);
  const distToRight = pageWidthMm - clamped;

  let align = origin.align;
  let xOffsetMm: number;

  if (distToLeft <= SNAP_ANCHOR_MM && distToLeft <= distToCenter && distToLeft <= distToRight) {
    align = 'left';
    xOffsetMm = 0;
  } else if (
    distToRight <= SNAP_ANCHOR_MM &&
    distToRight <= distToLeft &&
    distToRight <= distToCenter
  ) {
    align = 'right';
    xOffsetMm = 0;
  } else if (distToCenter <= SNAP_ANCHOR_MM) {
    align = 'center';
    xOffsetMm = 0;
  } else {
    xOffsetMm = offsetForAbsoluteX(align, clamped, pageWidthMm);
  }

  return { ...origin, align, xOffsetMm, yMm } as TemplateCoverElement;
}

// ---------------------------------------------------------------------------
// Visual pieces
// ---------------------------------------------------------------------------

function Rulers({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  const ticks = (total: number) =>
    Array.from({ length: Math.floor(total / 10) + 1 }, (_, i) => i * 10);

  return (
    <>
      <div className="ruler ruler--top" aria-hidden="true">
        {ticks(widthMm).map((value) => (
          <span key={value}>
            <i
              className="ruler__tick"
              style={{ left: `${value}mm`, bottom: 0, width: 1, height: value % 50 === 0 ? 7 : 3 }}
            />
            {value % 50 === 0 && (
              <em className="ruler__num" style={{ left: `${value}mm`, top: 0 }}>
                {value}
              </em>
            )}
          </span>
        ))}
      </div>
      <div className="ruler ruler--left" aria-hidden="true">
        {ticks(heightMm).map((value) => (
          <i
            key={value}
            className="ruler__tick"
            style={{ top: `${value}mm`, right: 0, height: 1, width: value % 50 === 0 ? 7 : 3 }}
          />
        ))}
      </div>
    </>
  );
}

function DragBadge({ el }: { el: TemplateCoverElement }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    top: `${el.yMm + 6}mm`,
    ...(el.align === 'right'
      ? { right: `${el.xOffsetMm}mm` }
      : el.align === 'center'
        ? { left: `calc(50% + ${el.xOffsetMm}mm)`, transform: 'translateX(-50%)' }
        : { left: `${el.xOffsetMm}mm` }),
  };
  const signed = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  return (
    <div className="pos-badge" style={style}>
      <span className="measure">x: {signed(el.xOffsetMm)}mm</span>
      <span className="measure">y: {el.yMm.toFixed(1)}mm</span>
    </div>
  );
}

function SnapGuide({ align }: { align: TemplateCoverElement['align'] }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    ...(align === 'left'
      ? { left: 0 }
      : align === 'right'
        ? { right: 0 }
        : { left: '50%' }),
  };
  return <div className="snap-guide" style={style} />;
}

/** Fantasma das faixas do template sobre a folha da capa. Read-only:
 *  pointer-events: none no wrapper para o click passar até `.sheet`. */
function BandGhost({
  band,
  template,
  assets,
  variables,
}: {
  band: 'header' | 'footer';
  template: TemplateInput;
  assets: Record<string, string>;
  variables: Record<string, string>;
}) {
  const b = template[band];
  if (b.heightMm <= 0) return null;
  const { margins } = template.page;
  const label = band === 'header' ? 'cabeçalho (do template)' : 'rodapé (do template)';

  return (
    <div
      className={`band band--${band}`}
      style={{
        height: `${b.heightMm}mm`,
        padding: `0 ${margins.right}mm 0 ${margins.left}mm`,
        fontFamily: template.body.font.family,
        fontSize: '9pt',
        lineHeight: 1.2,
        pointerEvents: 'none',
      }}
    >
      <span className="band__tag">{label} · {b.heightMm}mm</span>
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${margins.left}mm`,
          right: `${margins.right}mm`,
        }}
      >
        {b.elements.map((el, i) => {
          const pos = elementPosition(el);
          let inner = '';
          try {
            inner = elementInnerHtml(el, { assets, variables, missingAsset: 'placeholder' });
          } catch {
            inner = '';
          }
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: pos.top,
                left: pos.left,
                right: pos.right,
                transform: pos.transform,
              }}
              dangerouslySetInnerHTML={{ __html: inner }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CoverElementBody({
  el,
  index,
  selected,
  pageWidthMm,
  pageHeightMm,
  scale,
  assets,
  variables,
  onSelect,
  onChange,
}: {
  el: TemplateCoverElement;
  index: number;
  selected: boolean;
  pageWidthMm: number;
  pageHeightMm: number;
  scale: number;
  assets: Record<string, string>;
  variables: Record<string, string>;
  onSelect: (index: number) => void;
  onChange: (next: TemplateCoverElement) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const pos = elementPosition(el);
  const style: React.CSSProperties = {
    position: 'absolute',
    top: pos.top,
    left: pos.left,
    right: pos.right,
    transform: pos.transform,
    cursor: dragging ? 'grabbing' : 'grab',
    touchAction: 'none',
    userSelect: 'none',
  };
  const className = [
    'el-body',
    selected ? 'el-body--selected' : '',
    dragging ? 'el-body--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (() => {
    try {
      return elementInnerHtml(el as TemplateElement, { assets, variables, missingAsset: 'placeholder' });
    } catch {
      return '';
    }
  })();

  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      originClientX: event.clientX,
      originClientY: event.clientY,
      originEl: el,
    };
    setDragging(true);
    onSelect(index);
  };

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.originClientX;
    const dyPx = event.clientY - drag.originClientY;
    const dxScreenMm = dxPx / (MM_TO_PX * scale);
    const dyMm = dyPx / (MM_TO_PX * scale);
    onChange(applyCoverDragDelta(drag.originEl, dxScreenMm, dyMm, pageWidthMm, pageHeightMm));
  };

  const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  return (
    <>
      <div
        className={className}
        style={style}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onClick={(e) => e.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
      {dragging && <DragBadge el={el} />}
      {dragging && el.xOffsetMm === 0 && <SnapGuide align={el.align} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Zoom bar
// ---------------------------------------------------------------------------

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

interface ZoomState {
  mode: 'fit' | 'manual';
  value: number;
}

function ZoomBar({
  fitScale,
  zoom,
  onZoom,
}: {
  fitScale: number;
  zoom: ZoomState;
  onZoom: (next: ZoomState) => void;
}) {
  const current = zoom.mode === 'manual' ? zoom.value : fitScale;
  const step = (dir: 1 | -1) => {
    const base = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current + dir * ZOOM_STEP));
    onZoom({ mode: 'manual', value: base });
  };
  return (
    <div className="zoom-bar" role="group" aria-label="controles de zoom">
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        aria-label="diminuir zoom"
        disabled={current <= ZOOM_MIN + 0.001}
        onClick={() => step(-1)}
      >
        −
      </button>
      <span className="zoom-bar__value measure">{Math.round(current * 100)}%</span>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        aria-label="aumentar zoom"
        disabled={current >= ZOOM_MAX - 0.001}
        onClick={() => step(1)}
      >
        +
      </button>
      <button
        type="button"
        className={`btn btn--sm btn--ghost ${zoom.mode === 'fit' ? 'zoom-bar__fit--active' : ''}`}
        onClick={() => onZoom({ mode: 'fit', value: fitScale })}
        title="Ajustar a folha à janela"
      >
        encaixar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — same shape as Sheet.tsx (renders inside .bench__stage)
// ---------------------------------------------------------------------------

export function CoverEditor({
  template,
  onElementChange,
  selected,
  onSelect,
  variables = {},
  assets = {},
}: CoverEditorProps) {
  const { w: pageW, h: pageH } = pageDims(template);
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit', value: 1 });

  const sheetWidthPx = mm(pageW);
  const { ref, scale } = useFitScale(sheetWidthPx, {
    padding: 64,
    paddingY: 56,
    contentHeightPx: mm(pageH),
    override: zoom.mode === 'manual' ? zoom.value : undefined,
  });

  const elements = template.cover.elements;
  const { applyHeader, applyFooter } = template.cover;

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((prev) => {
        const base = prev.mode === 'manual' ? prev.value : scale;
        const factor = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, base * factor));
        return { mode: 'manual', value: Number(next.toFixed(3)) };
      });
    },
    [scale],
  );

  const handleSheetClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onSelect(null);
  };

  return (
    <div
      ref={ref}
      className="bench__scroll"
      style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
      onWheel={handleWheel}
    >
      <div
        style={{
          width: sheetWidthPx * scale,
          height: mm(pageH) * scale,
          marginTop: 20,
        }}
      >
        <div className="stage" style={{ transform: `scale(${scale})`, width: `${pageW}mm` }}>
          <div
            className="sheet"
            style={{ width: `${pageW}mm`, height: `${pageH}mm` }}
            onClick={handleSheetClick}
          >
            <Rulers widthMm={pageW} heightMm={pageH} />

            {applyHeader && (
              <BandGhost band="header" template={template} assets={assets} variables={variables} />
            )}

            {elements.map((el, i) => (
              <CoverElementBody
                key={i}
                el={el}
                index={i}
                selected={selected === i}
                pageWidthMm={pageW}
                pageHeightMm={pageH}
                scale={scale}
                assets={assets}
                variables={variables}
                onSelect={onSelect}
                onChange={(next) => onElementChange(i, next)}
              />
            ))}

            {applyFooter && (
              <BandGhost band="footer" template={template} assets={assets} variables={variables} />
            )}
          </div>
        </div>
      </div>

      <ZoomBar fitScale={scale} zoom={zoom} onZoom={setZoom} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector — exportado para o TemplateEditor renderizar no pane da direita
// ---------------------------------------------------------------------------

const ELEMENT_LABEL: Record<TemplateCoverElement['type'], string> = {
  image: 'imagem',
  text: 'texto',
  date: 'data',
};

interface CoverInspectorProps {
  el: TemplateCoverElement;
  index: number;
  pageHeightMm: number;
  onChange: (next: TemplateCoverElement) => void;
  onRemove: () => void;
  onUploadImage: (file: File) => Promise<{ assetId: string }>;
  assetUrl: (id: string) => string;
}

function TextProps({
  el,
  onChange,
}: {
  el: Extract<TemplateCoverElement, { fontSizePt: number }>;
  onChange: (patch: Partial<typeof el>) => void;
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
            value={el.fontSizePt}
            onChange={(e) => onChange({ fontSizePt: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="label">cor</span>
          <input
            type="color"
            value={el.color}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </label>
      </div>
      <label className="field--row">
        <input
          type="checkbox"
          checked={el.bold}
          onChange={(e) => onChange({ bold: e.target.checked })}
        />
        <span>Negrito</span>
      </label>
    </>
  );
}

function CoverImageProps({
  el,
  onChange,
  onUpload,
  assetUrl,
}: {
  el: Extract<TemplateCoverElement, { type: 'image' }>;
  onChange: (patch: Partial<typeof el>) => void;
  onUpload: (file: File) => Promise<{ assetId: string }>;
  assetUrl: (id: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { assetId } = await onUpload(file);
      onChange({ assetId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível enviar a imagem');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {el.assetId ? (
        <img className="preview-img" src={assetUrl(el.assetId)} alt="" />
      ) : (
        <p className="hint">Nenhuma imagem escolhida.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Enviando...' : el.assetId ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
      </div>
      {error && (
        <div className="notice notice--warn" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      <label className="field" style={{ marginTop: 10 }}>
        <span className="label">altura (mm)</span>
        <input
          type="number"
          className="measure"
          min={1}
          max={200}
          value={el.heightMm}
          onChange={(e) => onChange({ heightMm: Number(e.target.value) })}
        />
      </label>
    </>
  );
}

export function CoverElementInspector({
  el,
  index,
  pageHeightMm,
  onChange,
  onRemove,
  onUploadImage,
  assetUrl,
}: CoverInspectorProps) {
  const update = (patch: Partial<TemplateCoverElement>) =>
    onChange({ ...el, ...patch } as TemplateCoverElement);

  const setAlign = (align: TemplateCoverElement['align']) =>
    update({ align, xOffsetMm: 0 });

  const shortcutCenter = () => update({ align: 'center', xOffsetMm: 0 });
  const shortcutTop = () => update({ yMm: 0 });
  const shortcutMiddle = () =>
    update({ yMm: Math.max(0, pageHeightMm / 2 - estimateElementHeight(el) / 2) });
  const shortcutBottom = () =>
    update({ yMm: Math.max(0, pageHeightMm - estimateElementHeight(el) - 10) });

  return (
    <section className="pane__section">
      <span className="label pane__title">
        elemento {index + 1} · {ELEMENT_LABEL[el.type]}
      </span>

      {el.type === 'text' && (
        <>
          <label className="field">
            <span className="label">texto</span>
            <input
              type="text"
              value={el.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          </label>
          <p className="hint">
            Use <code className="code">{'{{nome}}'}</code> para variáveis resolvidas na conversão.
          </p>
          <TextProps el={el} onChange={(patch) => update(patch as Partial<TemplateCoverElement>)} />
        </>
      )}

      {el.type === 'date' && (
        <>
          <label className="field">
            <span className="label">formato</span>
            <select
              value={el.format}
              onChange={(e) => update({ format: e.target.value as typeof el.format })}
            >
              <option value="dd/MM/yyyy">31/12/2026</option>
              <option value="yyyy-MM-dd">2026-12-31</option>
              <option value="dd/MM/yyyy HH:mm">31/12/2026 14:05</option>
            </select>
          </label>
          <p className="hint">A data é a do momento da conversão.</p>
          <TextProps el={el} onChange={(patch) => update(patch as Partial<TemplateCoverElement>)} />
        </>
      )}

      {el.type === 'image' && (
        <CoverImageProps
          el={el}
          onChange={(patch) => update(patch as Partial<TemplateCoverElement>)}
          onUpload={onUploadImage}
          assetUrl={assetUrl}
        />
      )}

      <div style={{ marginTop: 14 }}>
        <span className="label pane__title">posição</span>

        <div className="align-shortcut" role="group" aria-label="alinhamento horizontal">
          <button
            type="button"
            className={`btn btn--sm btn--ghost ${el.align === 'left' ? 'align-shortcut__active' : ''}`}
            onClick={() => setAlign('left')}
            aria-pressed={el.align === 'left'}
          >
            ⇤ esq.
          </button>
          <button
            type="button"
            className={`btn btn--sm btn--ghost ${el.align === 'center' ? 'align-shortcut__active' : ''}`}
            onClick={() => setAlign('center')}
            aria-pressed={el.align === 'center'}
          >
            ↔ centro
          </button>
          <button
            type="button"
            className={`btn btn--sm btn--ghost ${el.align === 'right' ? 'align-shortcut__active' : ''}`}
            onClick={() => setAlign('right')}
            aria-pressed={el.align === 'right'}
          >
            ⇥ dir.
          </button>
        </div>

        <div className="align-shortcut" role="group" aria-label="posição vertical" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn--sm btn--ghost" onClick={shortcutTop} title="y = 0mm">
            Topo
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={shortcutMiddle} title="Centraliza verticalmente na página">
            Meio
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={shortcutBottom} title="10mm acima do rodapé da página">
            Rodapé
          </button>
        </div>

        <div className="grid-2" style={{ marginTop: 10 }}>
          <label className="field">
            <span className="label">x offset (mm)</span>
            <input
              type="number"
              className="measure"
              step={0.5}
              value={el.xOffsetMm}
              onChange={(e) => update({ xOffsetMm: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="label">y (mm)</span>
            <input
              type="number"
              className="measure"
              step={0.5}
              min={0}
              value={el.yMm}
              onChange={(e) => update({ yMm: Number(e.target.value) })}
            />
          </label>
        </div>

        <div style={{ marginTop: 6 }}>
          <button type="button" className="btn btn--sm btn--ghost" onClick={shortcutCenter}>
            Centralizar horizontal
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn btn--sm btn--danger" onClick={onRemove}>
          Remover elemento
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helper para calcular a próxima posição em cascata quando um novo elemento
// é adicionado — evita empilhamento no mesmo yMm.
// ---------------------------------------------------------------------------

export function nextCoverYMm(elements: readonly TemplateCoverElement[], pageHeightMm: number): number {
  if (elements.length === 0) return Math.max(0, pageHeightMm / 2 - 20);
  const bottomOfLast = elements.reduce(
    (max, el) => Math.max(max, el.yMm + estimateElementHeight(el)),
    0,
  );
  return Math.min(Math.max(0, pageHeightMm - 40), bottomOfLast + 12);
}

export function makeCoverElement(
  type: 'text' | 'image' | 'date',
  yMm: number,
): TemplateCoverElement {
  const base = { align: 'center' as const, xOffsetMm: 0, yMm };
  if (type === 'text') {
    return { type, value: 'Novo texto', bold: true, fontSizePt: 24, color: '#000000', ...base };
  }
  if (type === 'image') {
    return { type, assetId: '', heightMm: 30, ...base };
  }
  return { type, format: 'dd/MM/yyyy', bold: false, fontSizePt: 11, color: '#111111', ...base };
}

export { ELEMENT_LABEL };
