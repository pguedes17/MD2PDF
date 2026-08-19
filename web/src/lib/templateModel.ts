import {
  BAND_MARGIN_SLACK_MM,
  ElementSchema,
  PAGE_SIZES_MM,
  ZONE_NAMES,
  type Template,
  type TemplateElement,
  type TemplateInput,
  type ZoneName,
} from '@shared/domain/template.js';

export type BandName = 'header' | 'footer';

export type Selection =
  | { kind: 'zone'; band: BandName; zone: ZoneName }
  | { kind: 'element'; band: BandName; zone: ZoneName; index: number };

export const ZONE_LABEL: Record<ZoneName, string> = {
  left: 'esquerda',
  center: 'centro',
  right: 'direita',
};

export const BAND_LABEL: Record<BandName, string> = {
  header: 'cabeçalho',
  footer: 'rodapé',
};

export const ELEMENT_LABEL: Record<TemplateElement['type'], string> = {
  image: 'imagem',
  text: 'texto',
  pageNumber: 'paginação',
  date: 'data',
};

/** Dimensões da folha já considerando a orientação. */
export function sheetSizeMm(page: TemplateInput['page']) {
  const base = PAGE_SIZES_MM[page.format];
  return page.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/**
 * A faixa não cabe na margem — o Chromium cortaria o cabeçalho em silêncio.
 * O editor desenha esse conflito na folha em vez de só recusar o salvamento.
 */
export function bandClashes(template: TemplateInput, band: BandName): boolean {
  const height = template[band].heightMm;
  if (height <= 0) return false;
  const margin = band === 'header' ? template.page.margins.top : template.page.margins.bottom;
  return margin < height + BAND_MARGIN_SLACK_MM;
}

export function requiredMarginMm(template: TemplateInput, band: BandName): number {
  return template[band].heightMm + BAND_MARGIN_SLACK_MM;
}

/**
 * Elemento novo com os defaults do schema aplicados.
 *
 * A imagem é montada à mão em vez de passar pelo schema: ela nasce sem arquivo,
 * e o schema — corretamente — recusa um `assetId` vazio. O elemento existe no
 * editor enquanto você escolhe a imagem, e a validação bloqueia o salvamento
 * até lá.
 */
export function makeElement(type: TemplateElement['type'], assetId?: string): TemplateElement {
  if (type === 'image') {
    return { type, assetId: assetId ?? '', heightMm: 12 };
  }
  return ElementSchema.parse(type === 'text' ? { type, value: 'Texto' } : { type });
}

/** Resumo de uma linha para a lista do inspector. */
export function describeElement(el: TemplateElement): string {
  switch (el.type) {
    case 'image':
      return el.assetId ? `${el.heightMm}mm de altura` : 'sem imagem';
    case 'text':
      return el.value || '(vazio)';
    case 'pageNumber':
      return el.format;
    case 'date':
      return el.format;
  }
}

/** Todos os assets referenciados, para o preview saber o que buscar. */
export function collectAssetIds(template: TemplateInput | Template): string[] {
  const ids = new Set<string>();
  for (const band of [template.header, template.footer]) {
    for (const zone of ZONE_NAMES) {
      for (const el of band.zones[zone]) {
        if (el.type === 'image' && el.assetId) ids.add(el.assetId);
      }
    }
  }
  return [...ids];
}

type ZoneUpdater = (elements: TemplateElement[]) => TemplateElement[];

/** Atualização imutável de uma zona — todo o editor passa por aqui. */
export function updateZone(
  template: TemplateInput,
  band: BandName,
  zone: ZoneName,
  update: ZoneUpdater,
): TemplateInput {
  return {
    ...template,
    [band]: {
      ...template[band],
      zones: { ...template[band].zones, [zone]: update(template[band].zones[zone]) },
    },
  };
}

export function replaceElement(
  template: TemplateInput,
  selection: Extract<Selection, { kind: 'element' }>,
  next: TemplateElement,
): TemplateInput {
  return updateZone(template, selection.band, selection.zone, (elements) =>
    elements.map((el, i) => (i === selection.index ? next : el)),
  );
}
