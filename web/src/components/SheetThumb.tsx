import { useMemo } from 'react';
import { renderTemplate } from '@shared/render/template.js';
import type { Template } from '@shared/domain/template.js';
import { assetUrl } from '../api.js';
import { collectAssetIds, sheetSizeMm } from '../lib/templateModel.js';
import { mm, useFitScale } from '../hooks/useFitScale.js';

/** Altura do recorte, em mm de folha: cabeçalho, um respiro de corpo, rodapé. */
const CROP_MM = { header: 4, body: 26, footer: 4 };

/**
 * O timbre do template, desenhado pelo mesmo renderer que imprime o PDF.
 *
 * O card não descreve o template: mostra. Você reconhece o seu papel timbrado
 * do mesmo jeito que reconheceria numa gaveta — pelo cabeçalho, não pelo nome.
 */
export function SheetThumb({ template }: { template: Template }) {
  const size = sheetSizeMm(template.page);
  const sheetWidthPx = mm(size.width);
  const { ref, scale } = useFitScale(sheetWidthPx, { max: 0.62 });

  const bands = useMemo(() => {
    const assets = Object.fromEntries(collectAssetIds(template).map((id) => [id, assetUrl(id)]));
    try {
      const { headerHtml, footerHtml } = renderTemplate(template, { assets, missingAsset: 'placeholder' });
      return { headerHtml, footerHtml };
    } catch {
      // Um asset apagado não pode quebrar a listagem inteira.
      return { headerHtml: '', footerHtml: '' };
    }
  }, [template]);

  const contentMm =
    template.header.heightMm + template.footer.heightMm + CROP_MM.header + CROP_MM.body + CROP_MM.footer;

  return (
    <div className="thumb" ref={ref}>
      {scale > 0 && (
        <div className="thumb__paper" style={{ height: mm(contentMm) * scale }}>
          <div
            className="thumb__scale"
            style={{ transform: `scale(${scale})`, width: `${size.width}mm` }}
          >
            <div style={{ height: `${CROP_MM.header}mm` }} />
            <div dangerouslySetInnerHTML={{ __html: bands.headerHtml }} />

            <div className="thumb__body" style={{ height: `${CROP_MM.body}mm`, paddingInline: `${template.page.margins.left}mm` }}>
              {[100, 100, 72].map((width, index) => (
                <span key={index} className="thumb__line" style={{ width: `${width}%` }} />
              ))}
            </div>

            <div dangerouslySetInnerHTML={{ __html: bands.footerHtml }} />
            <div style={{ height: `${CROP_MM.footer}mm` }} />
          </div>
        </div>
      )}
    </div>
  );
}
