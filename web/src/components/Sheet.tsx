import { useRef, useState } from 'react';
import type { TemplateElement, TemplateInput } from '@shared/domain/template.js';
import { elementPosition, renderTemplate } from '@shared/render/template.js';
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

function ElementHandle({
  el,
  band,
  index,
  selected,
  usableWidthMm,
  scale,
  onSelect,
  onChange,
}: {
  el: TemplateElement;
  band: BandName;
  index: number;
  selected: boolean;
  usableWidthMm: number;
  scale: number;
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
    padding: '1.5mm 2mm',
    cursor: dragging ? 'grabbing' : 'move',
    touchAction: 'none',
    // A cada elemento seu handle tem tamanho intrínseco pequeno; o outline
    // do "selected" cresce a partir daí. O HTML impresso pelo renderer
    // aparece por baixo e dita o tamanho visual.
    minWidth: '4mm',
    minHeight: '4mm',
  };
  const className = [
    'el-handle',
    selected ? 'el-handle--selected' : '',
    dragging ? 'el-handle--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleDown = (event: React.PointerEvent<HTMLButtonElement>) => {
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

  const handleMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.originClientX;
    const dyPx = event.clientY - drag.originClientY;
    // /scale porque a folha inteira está escalada em CSS.
    const dxScreenMm = dxPx / (MM_TO_PX * scale);
    const dyMm = dyPx / (MM_TO_PX * scale);
    onChange(applyDragDelta(drag.originEl, dxScreenMm, dyMm, usableWidthMm));
  };

  const handleUp = (event: React.PointerEvent<HTMLButtonElement>) => {
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
      <button
        type="button"
        className={className}
        style={style}
        aria-label={`elemento ${index + 1}`}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
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
  html,
  selection,
  scale,
  onSelect,
  onElementChange,
}: {
  band: BandName;
  template: TemplateInput;
  html: string;
  selection: Selection;
  scale: number;
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

  return (
    <div
      className={classes}
      style={{ height: `${heightMm}mm` }}
      onClick={() => onSelect({ band, index: null })}
    >
      <div className="band__render" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="band__tag">
        {BAND_LABEL[band]} · {heightMm}mm{clash ? ' · não cabe na margem' : ''}
      </span>
      <div
        className="band__handles"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${margins.left}mm`,
          right: `${margins.right}mm`,
        }}
      >
        {template[band].elements.map((el, index) => (
          <ElementHandle
            key={index}
            el={el}
            band={band}
            index={index}
            selected={selection?.band === band && selection.index === index}
            usableWidthMm={usableWidthMm}
            scale={scale}
            onSelect={onSelect}
            onChange={(next) => onElementChange(band, index, next)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A folha em escala real: tudo aqui é medido em milímetros e só o wrapper aplica
 * um transform para caber na tela. Cabeçalho e rodapé são desenhados pelo mesmo
 * renderer que o servidor usa para imprimir; os handles ficam sobre esse HTML
 * capturando o arrasto sem repintar o layout.
 */
export function Sheet({ template, assets, selection, onSelect, onElementChange }: SheetProps) {
  const size = sheetSizeMm(template.page);
  const sheetWidthPx = mm(size.width);
  // A folha inteira precisa caber de uma vez: julgar um rodapé rolando a tela
  // não funciona.
  const { ref, scale } = useFitScale(sheetWidthPx, {
    padding: 64,
    paddingY: 56,
    contentHeightPx: mm(size.height),
  });

  // Um asset ainda não resolvido não pode derrubar o editor inteiro.
  let headerHtml = '';
  let footerHtml = '';
  try {
    const rendered = renderTemplate(template, { assets, missingAsset: 'placeholder' });
    headerHtml = rendered.headerHtml;
    footerHtml = rendered.footerHtml;
  } catch {
    headerHtml = '';
    footerHtml = '';
  }

  const { margins } = template.page;
  const bodyHeight = Math.max(0, size.height - margins.top - margins.bottom);

  return (
    <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
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
              html={headerHtml}
              selection={selection}
              scale={scale}
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
              html={footerHtml}
              selection={selection}
              scale={scale}
              onSelect={onSelect}
              onElementChange={onElementChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
