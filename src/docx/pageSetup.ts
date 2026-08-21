import { parseXml, pick, pickAll, attr } from './xml.js';
import { twipsToMm } from './units.js';
import type { DocxAnalysis } from './schema.js';
import type { Warning } from './schema.js';

const FORMAT_BY_DIM: Record<string, 'A4' | 'Letter'> = {
  '11906x16838': 'A4', '16838x11906': 'A4',
  '12240x15840': 'Letter', '15840x12240': 'Letter',
};

const DEFAULTS: DocxAnalysis['page'] = {
  format: 'A4',
  orientation: 'portrait',
  margins: { top: 30, right: 20, bottom: 25, left: 20 },
};

export interface PageSetupResult {
  page: DocxAnalysis['page'];
  warnings: Warning[];
}

export function extractPageSetup(documentXml: string): PageSetupResult {
  const doc = parseXml(documentXml);
  const document = pick(doc, 'document');
  const body = pick(document, 'body');
  const sectPr = pick(body, 'sectPr');
  const warnings: Warning[] = [];

  if (!sectPr) {
    warnings.push({ code: 'UNKNOWN_PAGE_SIZE', message: 'documento sem sectPr; usando padrão A4 portrait' });
    return { page: DEFAULTS, warnings };
  }

  const pgSz = pick(sectPr, 'pgSz');
  const pgMar = pick(sectPr, 'pgMar');
  let format: 'A4' | 'Letter' = 'A4';
  let orientation: 'portrait' | 'landscape' = 'portrait';

  if (pgSz) {
    const w = Number(attr(pgSz, 'w') ?? 0);
    const h = Number(attr(pgSz, 'h') ?? 0);
    const key = `${w}x${h}`;
    const found = FORMAT_BY_DIM[key];
    if (found) {
      format = found;
      orientation = w > h ? 'landscape' : 'portrait';
    } else {
      warnings.push({
        code: 'UNKNOWN_PAGE_SIZE',
        message: `pgSz ${w}x${h} twips não bate com A4 nem Letter; usando padrão A4 portrait`,
      });
    }
  } else {
    warnings.push({ code: 'UNKNOWN_PAGE_SIZE', message: 'sem pgSz; usando padrão A4 portrait' });
  }

  const margins = pgMar
    ? {
        top: Math.round(twipsToMm(Number(attr(pgMar, 'top') ?? 1701))),
        right: Math.round(twipsToMm(Number(attr(pgMar, 'right') ?? 1134))),
        bottom: Math.round(twipsToMm(Number(attr(pgMar, 'bottom') ?? 1417))),
        left: Math.round(twipsToMm(Number(attr(pgMar, 'left') ?? 1134))),
      }
    : DEFAULTS.margins;

  // Detecta múltiplas seções: se há mais de um sectPr no body, avisa.
  const allSectPr = pickAll(body, 'sectPr');
  if (allSectPr.length > 1) {
    warnings.push({
      code: 'MULTIPLE_SECTIONS',
      message: `documento tem ${allSectPr.length} seções; só a última (default) foi importada`,
    });
  }

  return { page: { format, orientation, margins }, warnings };
}
