import { useCallback, useRef, useState } from 'react';
import type { TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { elementInnerHtml, elementPosition } from '@shared/render/template.js';
import { MM_TO_PX, mm, useFitScale } from '../hooks/useFitScale.js';
import {
  applyDragDelta,
  bandClashes,
  BAND_LABEL,
  bandUsableWidthMm,
  sheetSizeMm,
  type BandName,
  type Selection,
} from '../lib/templateModel.js';

interface SheetProps {
  template: TemplateInput;
  /** assetId -> URL servida pela API. */
  assets: Record<string, string>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onElementChange: (band: BandName, index: number, next: TemplateElement) => void;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

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

interface DragState {
  originClientX: number;
  originClientY: number;
  originEl: TemplateElement;
}

/**
 * O elemento renderizado como um `<div>` React posicionado — o conteúdo
 * interno vem do renderer via `elementInnerHtml`, byte-a-byte igual ao que
 * o servidor imprime, então o clique acerta a área visível de verdade. Como
 * o wrapper é React, ele sobrevive à re-renderização durante o drag e o
 * setPointerCapture continua válido.
 */
function ElementBody({
  el,
  band,
  index,
  selected,
  usableWidthMm,
  bandHeightMm,
  scale,
  assets,
  onSelect,
  onChange,
}: {
  el: TemplateElement;
  band: BandName;
  index: number;
  selected: boolean;
  usableWidthMm: number;
  bandHeightMm: number;
  scale: number;
  assets: Record<string, string>;
  onSelect: (selection: Selection) => void;
  onChange: (next: TemplateElement) => void;
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
      return elementInnerHtml(el, { assets, missingAsset: 'placeholder' });
    } catch {
      // Um asset ainda não resolvido não pode derrubar o editor.
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
    onSelect({ band, index });
  };

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.originClientX;
    const dyPx = event.clientY - drag.originClientY;
    const dxScreenMm = dxPx / (MM_TO_PX * scale);
    const dyMm = dyPx / (MM_TO_PX * scale);
    onChange(applyDragDelta(drag.originEl, dxScreenMm, dyMm, usableWidthMm, bandHeightMm));
  };

  const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // pointer já foi liberado — sem grief
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
        dangerouslySetInnerHTML={{ __html: inner }}
      />
      {dragging && <DragBadge el={el} />}
      {dragging && el.xOffsetMm === 0 && <SnapGuide align={el.align} />}
    </>
  );
}

function DragBadge({ el }: { el: TemplateElement }) {
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

function SnapGuide({ align }: { align: TemplateElement['align'] }) {
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

function Band({
  band,
  template,
  selection,
  scale,
  assets,
  onSelect,
  onElementChange,
}: {
  band: BandName;
  template: TemplateInput;
  selection: Selection;
  scale: number;
  assets: Record<string, string>;
  onSelect: (selection: Selection) => void;
  onElementChange: (band: BandName, index: number, next: TemplateElement) => void;
}) {
  const heightMm = template[band].heightMm;
  if (heightMm <= 0) return null;

  const clash = bandClashes(template, band);
  const selectedBand = selection?.band === band && selection.index === null;
  const classes = [
    'band',
    `band--${band}`,
    clash ? 'band--clash' : '',
    selectedBand ? 'band--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { margins } = template.page;
  const usableWidthMm = bandUsableWidthMm(template);

  // Estilo inline replica o que o renderer aplica em bandHtml — sem isso
  // o preview deslocaria os elementos em relação ao PDF.
  const bandInlineStyle: React.CSSProperties = {
    height: `${heightMm}mm`,
    padding: `0 ${margins.right}mm 0 ${margins.left}mm`,
    fontFamily: template.body.fontFamily,
    fontSize: '9pt',
    lineHeight: 1.2,
  };

  return (
    <div
      className={classes}
      style={bandInlineStyle}
      onClick={(event) => {
        // Só seleciona a faixa se o clique foi no fundo. Clique num elemento
        // bubbles até aqui; o próprio ElementBody já cuidou de selecionar.
        if (event.target === event.currentTarget) onSelect({ band, index: null });
      }}
    >
      <span className="band__tag">
        {BAND_LABEL[band]} · {heightMm}mm{clash ? ' · não cabe na margem' : ''}
      </span>
      <div
        className="band__stage"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${margins.left}mm`,
          right: `${margins.right}mm`,
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelect({ band, index: null });
        }}
      >
        {template[band].elements.map((el, index) => (
          <ElementBody
            key={index}
            el={el}
            band={band}
            index={index}
            selected={selection?.band === band && selection.index === index}
            usableWidthMm={usableWidthMm}
            bandHeightMm={heightMm}
            scale={scale}
            assets={assets}
            onSelect={onSelect}
            onChange={(next) => onElementChange(band, index, next)}
          />
        ))}
      </div>
    </div>
  );
}

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

/**
 * A folha em escala real: tudo aqui é medido em milímetros e só o wrapper aplica
 * um transform para caber na tela. Cabeçalho e rodapé são desenhados pelo mesmo
 * renderer que o servidor usa para imprimir; cada elemento é um `<div>` React
 * arrastável posicionado por elementPosition.
 */
export function Sheet({ template, assets, selection, onSelect, onElementChange }: SheetProps) {
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit', value: 1 });
  const size = sheetSizeMm(template.page);
  const sheetWidthPx = mm(size.width);
  const { ref, scale } = useFitScale(sheetWidthPx, {
    padding: 64,
    paddingY: 56,
    contentHeightPx: mm(size.height),
    override: zoom.mode === 'manual' ? zoom.value : undefined,
  });

  const { margins } = template.page;
  const bodyHeight = Math.max(0, size.height - margins.top - margins.bottom);

  // Ctrl+wheel dá zoom sobre a bancada, centrado no cursor via scroll natural
  // (o container é overflow: auto). Sem Ctrl, o wheel rola normalmente.
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((prev) => {
      const base = prev.mode === 'manual' ? prev.value : scale;
      // deltaY < 0 = zoom in (padrão do trackpad/wheel).
      const factor = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, base * factor));
      return { mode: 'manual', value: Number(next.toFixed(3)) };
    });
  }, [scale]);

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
          height: mm(size.height) * scale,
          marginTop: 20,
        }}
      >
        <div className="stage" style={{ transform: `scale(${scale})`, width: `${size.width}mm` }}>
          <div className="sheet" style={{ width: `${size.width}mm`, height: `${size.height}mm` }}>
            <Rulers widthMm={size.width} heightMm={size.height} />

            <Band
              band="header"
              template={template}
              selection={selection}
              scale={scale}
              assets={assets}
              onSelect={onSelect}
              onElementChange={onElementChange}
            />

            <div
              className={`guide ${bandClashes(template, 'header') ? 'guide--clash' : ''}`}
              style={{ top: `${margins.top}mm` }}
            />
            <div
              className={`guide ${bandClashes(template, 'footer') ? 'guide--clash' : ''}`}
              style={{ top: `${size.height - margins.bottom}mm` }}
            />

            <div
              className="bodyghost"
              style={{
                top: `${margins.top}mm`,
                left: `${margins.left}mm`,
                right: `${margins.right}mm`,
                height: `${bodyHeight}mm`,
              }}
            >
              <span className="bodyghost__note">corpo · seu markdown entra aqui</span>
              {Array.from({ length: Math.max(0, Math.floor(bodyHeight / 6)) }, (_, i) => (
                <span
                  key={i}
                  className="bodyghost__line"
                  style={{ width: i % 5 === 4 ? '58%' : '100%' }}
                />
              ))}
            </div>

            <Band
              band="footer"
              template={template}
              selection={selection}
              scale={scale}
              assets={assets}
              onSelect={onSelect}
              onElementChange={onElementChange}
            />
          </div>
        </div>
      </div>

      <ZoomBar fitScale={scale} zoom={zoom} onZoom={setZoom} />
    </div>
  );
}
