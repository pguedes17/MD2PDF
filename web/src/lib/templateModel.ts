import {
  BAND_MARGIN_SLACK_MM,
  ElementSchema,
  PAGE_SIZES_MM,
  type Template,
  type TemplateElement,
  type TemplateInput,
} from '@shared/domain/template.js';

export type BandName = 'header' | 'footer';

/** Seleção corrente do editor. `index: null` significa "faixa selecionada,
 *  nenhum elemento em foco" — abre a lista de elementos no inspector. */
export type Selection = { band: BandName; index: number | null } | null;

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

export const SNAP_ANCHOR_MM = 2;
export const SNAP_EDGE_MM = 1;
export const NUDGE_MM = 1;
export const NUDGE_FINE_MM = 0.25;

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

/** Largura horizontal útil de uma faixa (folha menos margens laterais). */
export function bandUsableWidthMm(template: TemplateInput): number {
  const { width } = sheetSizeMm(template.page);
  return Math.max(0, width - template.page.margins.left - template.page.margins.right);
}

/**
 * Elemento novo com os defaults do schema aplicados, incluindo posição.
 *
 * A imagem é montada à mão em vez de passar pelo schema: ela nasce sem arquivo,
 * e o schema — corretamente — recusa um `assetId` vazio. O elemento existe no
 * editor enquanto você escolhe a imagem, e a validação bloqueia o salvamento
 * até lá.
 */
export function makeElement(type: TemplateElement['type'], assetId?: string): TemplateElement {
  const position = { align: 'left' as const, xOffsetMm: 0, yMm: 0 };
  if (type === 'image') {
    return { type, assetId: assetId ?? '', heightMm: 12, ...position };
  }
  const raw = type === 'text' ? { type, value: 'Texto', ...position } : { type, ...position };
  return ElementSchema.parse(raw);
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
    for (const el of band.elements) {
      if (el.type === 'image' && el.assetId) ids.add(el.assetId);
    }
  }
  return [...ids];
}

type BandUpdater = (elements: TemplateElement[]) => TemplateElement[];

/** Atualização imutável de uma faixa — todo o editor passa por aqui. */
export function updateBand(
  template: TemplateInput,
  band: BandName,
  update: BandUpdater,
): TemplateInput {
  return {
    ...template,
    [band]: { ...template[band], elements: update(template[band].elements) },
  };
}

export function replaceElement(
  template: TemplateInput,
  selection: { band: BandName; index: number },
  next: TemplateElement,
): TemplateInput {
  return updateBand(template, selection.band, (elements) =>
    elements.map((el, i) => (i === selection.index ? next : el)),
  );
}

/**
 * Aplica um delta de arrasto ao elemento. `dxScreenMm` é o deslocamento
 * na direção da tela (positivo = direita). Para `align='right'` o offset é
 * invertido (positivo puxa para dentro, então arrastar para a direita
 * diminui o offset). Snap para as âncoras acontece dentro de SNAP_ANCHOR_MM.
 */
export function applyDragDelta(
  origin: TemplateElement,
  dxScreenMm: number,
  dyMm: number,
  usableWidthMm: number,
): TemplateElement {
  const yMm = Math.max(0, origin.yMm + dyMm);

  // Posição absoluta atual do elemento na área útil (em mm a partir da esquerda).
  const absoluteXMm = anchorAbsoluteX(origin.align, origin.xOffsetMm, usableWidthMm) + dxScreenMm;
  const clamped = Math.max(0, Math.min(usableWidthMm, absoluteXMm));

  const distToLeft = clamped;
  const distToCenter = Math.abs(clamped - usableWidthMm / 2);
  const distToRight = usableWidthMm - clamped;

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
    // Sem snap: mantém a âncora original e ajusta o offset.
    xOffsetMm = offsetForAbsoluteX(align, clamped, usableWidthMm);
  }

  return { ...origin, align, xOffsetMm, yMm } as TemplateElement;
}

function anchorAbsoluteX(
  align: TemplateElement['align'],
  xOffsetMm: number,
  usableWidthMm: number,
): number {
  switch (align) {
    case 'left':
      return xOffsetMm;
    case 'right':
      return usableWidthMm - xOffsetMm;
    case 'center':
      return usableWidthMm / 2 + xOffsetMm;
  }
}

function offsetForAbsoluteX(
  align: TemplateElement['align'],
  absoluteXMm: number,
  usableWidthMm: number,
): number {
  switch (align) {
    case 'left':
      return absoluteXMm;
    case 'right':
      return usableWidthMm - absoluteXMm;
    case 'center':
      return absoluteXMm - usableWidthMm / 2;
  }
}
