import { ZONE_NAMES, type TemplateInput, type ZoneName } from '@shared/domain/template.js';
import { renderTemplate } from '@shared/render/template.js';
import { mm, useFitScale } from '../hooks/useFitScale.js';
import {
  bandClashes,
  BAND_LABEL,
  sheetSizeMm,
  ZONE_LABEL,
  type BandName,
  type Selection,
} from '../lib/templateModel.js';

interface SheetProps {
  template: TemplateInput;
  /** assetId -> URL servida pela API. */
  assets: Record<string, string>;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
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

function Band({
  band,
  template,
  html,
  selection,
  onSelect,
}: {
  band: BandName;
  template: TemplateInput;
  html: string;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const heightMm = template[band].heightMm;
  if (heightMm <= 0) return null;

  const clash = bandClashes(template, band);
  const classes = [
    'band',
    `band--${band}`,
    clash ? 'band--clash' : '',
    selection?.band === band ? 'band--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={{ height: `${heightMm}mm` }}>
      <div className="band__render" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="band__tag">
        {BAND_LABEL[band]} · {heightMm}mm{clash ? ' · não cabe na margem' : ''}
      </span>
      <div className="slot">
        {ZONE_NAMES.map((zone: ZoneName) => (
          <button
            key={zone}
            type="button"
            className={[
              'slot__zone',
              selection?.band === band && selection.zone === zone ? 'slot__zone--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${BAND_LABEL[band]}, zona ${ZONE_LABEL[zone]}`}
            onClick={() => onSelect({ kind: 'zone', band, zone })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A folha em escala real: tudo aqui é medido em milímetros e só o wrapper aplica
 * um transform para caber na tela. Cabeçalho e rodapé são desenhados pelo mesmo
 * renderer que o servidor usa para imprimir.
 */
export function Sheet({ template, assets, selection, onSelect }: SheetProps) {
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

            <Band band="header" template={template} html={headerHtml} selection={selection} onSelect={onSelect} />

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

            <Band band="footer" template={template} html={footerHtml} selection={selection} onSelect={onSelect} />
          </div>
        </div>
      </div>
    </div>
  );
}
