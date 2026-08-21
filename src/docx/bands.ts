import { parseXml, pick, pickAll, attr } from './xml.js';
import { halfPointsToPt, emuToMm } from './units.js';
import type { Theme } from './theme.js';
import type { DocxAnalysis, Warning } from './schema.js';

type Align = 'left' | 'center' | 'right';
type BandElement = DocxAnalysis['headers'][keyof DocxAnalysis['headers']]['elements'][number];

export interface BandExtract {
  elements: BandElement[];
  warnings: Warning[];
}

/** Espaçamento vertical entre elementos empilhados na mesma zona de alinhamento. */
const STACK_PADDING_MM = 0.5;
/** Fator empírico para estimar altura visual de uma linha de texto em pt→mm. */
const TEXT_LINE_HEIGHT_MM = (fontSizePt: number) => fontSizePt * 0.353 * 1.2;

function textOfParagraph(p: unknown): string {
  return pickAll(p, 'r')
    .flatMap((r) =>
      pickAll(r, 't').map((t) =>
        typeof t === 'object' ? (t as any)['#text'] ?? '' : String(t),
      ),
    )
    .join('');
}

/**
 * Alinhamento do parágrafo. Se o próprio parágrafo declara `w:jc`, essa é a
 * verdade visual do docx. Só quando ausente caímos no default fornecido — que
 * é o `w:jc` do estilo de parágrafo (raro) ou uma heurística pelo índice da
 * célula na tabela. Ignorar o `w:jc` explícito reproduz mal o layout: um docx
 * com 3 parágrafos `jc=right` na célula direita de uma tabela 2×1 iria parar
 * na zona `center`, empilhando em cima do que estivesse lá.
 */
function alignOfParagraph(p: unknown, defaultAlign: Align): Align {
  const jc = pick(pick(p, 'pPr'), 'jc');
  const v = jc ? attr(jc, 'val') : undefined;
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'left' || v === 'start') return 'left';
  if (v === 'center') return 'center';
  // 'both'/'distribute' são justificações de bloco — não têm análogo puro; caem no default.
  return defaultAlign;
}

function typographyOfFirstRun(p: unknown) {
  const r = pick(p, 'r');
  const rPr = pick(r, 'rPr');
  const sz = pick(rPr, 'sz');
  const szVal = sz && attr(sz, 'val');
  const color = pick(rPr, 'color');
  const colorVal = color && attr(color, 'val');
  return {
    bold: pick(rPr, 'b') != null,
    fontSizePt: szVal ? halfPointsToPt(Number(szVal)) : 9,
    color: colorVal && colorVal !== 'auto' ? `#${colorVal.toUpperCase()}` : '#444444',
  };
}

function imageOfParagraph(
  p: unknown,
  rels: Record<string, string>,
): { docxPath: string; heightMm: number } | null {
  const drawing = pick(pick(p, 'r'), 'drawing');
  if (!drawing) return null;
  const inline = pick(drawing, 'inline') ?? pick(drawing, 'anchor');
  if (!inline) return null;
  const extent = pick(inline, 'extent');
  const cy = extent ? Number(attr(extent, 'cy') ?? 0) : 0;
  const graphic = pick(inline, 'graphic');
  const gData = pick(graphic, 'graphicData');
  const pic = pick(gData, 'pic');
  const blipFill = pick(pic, 'blipFill');
  const blip = pick(blipFill, 'blip');
  const rId = blip ? attr(blip, 'embed') : undefined;
  if (!rId || !rels[rId]) return null;
  const heightMm = Math.max(1, Math.min(40, emuToMm(cy)));
  return { docxPath: `word/${rels[rId]}`, heightMm };
}

/**
 * Heurística de default de alinhamento para uma célula, quando o parágrafo
 * dentro dela não declara `w:jc`:
 *   1 coluna  → center
 *   2 colunas → cell 0 = left,  cell 1 = right
 *   3+        → cell 0 = left,  meio = center, última = right
 */
function defaultAlignForCell(cellIndex: number, cellCount: number): Align {
  if (cellCount <= 1) return 'center';
  if (cellIndex === 0) return 'left';
  if (cellIndex === cellCount - 1) return 'right';
  return 'center';
}

/**
 * Cursor de yMm por zona de alinhamento. Cada elemento novo consome a altura
 * estimada da sua zona; o próximo elemento da MESMA zona começa logo abaixo.
 * Zonas diferentes têm cursores independentes — elas não colidem visualmente.
 */
class ZoneCursor {
  private readonly y: Record<Align, number> = { left: 0, center: 0, right: 0 };

  take(align: Align, heightMm: number): number {
    const at = this.y[align];
    this.y[align] = at + heightMm + STACK_PADDING_MM;
    return at;
  }

  /** Maior cursor entre as três zonas — usado para dimensionar a banda. */
  max(): number {
    return Math.max(this.y.left, this.y.center, this.y.right);
  }
}

function emitParagraph(
  p: unknown,
  rels: Record<string, string>,
  defaultAlign: Align,
  cursor: ZoneCursor,
  elements: BandElement[],
): void {
  const image = imageOfParagraph(p, rels);
  if (image) {
    const align = alignOfParagraph(p, defaultAlign);
    const heightMm = Math.round(image.heightMm * 10) / 10;
    const yMm = round1(cursor.take(align, heightMm));
    elements.push({ type: 'image', imageDocxPath: image.docxPath, align, heightMm, yMm });
    return;
  }
  const text = textOfParagraph(p).trim();
  if (!text) return;
  const typo = typographyOfFirstRun(p);
  const align = alignOfParagraph(p, defaultAlign);
  const yMm = round1(cursor.take(align, TEXT_LINE_HEIGHT_MM(typo.fontSizePt)));
  elements.push({ type: 'text', value: text, align, yMm, ...typo });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function extractBand(bandXml: string, rels: Record<string, string>, _theme: Theme): BandExtract {
  const doc = parseXml(bandXml);
  const root = pick(doc, 'hdr') ?? pick(doc, 'ftr');
  const elements: BandElement[] = [];
  const warnings: Warning[] = [];
  const cursor = new ZoneCursor();

  // Parágrafos soltos no topo da faixa: sem célula, default = center (Word).
  for (const p of pickAll(root, 'p')) {
    emitParagraph(p, rels, 'center', cursor, elements);
  }

  // Tabelas 1×N (só a primeira linha, comum em papéis timbrados):
  // cada célula fornece um `defaultAlign` baseado no seu índice; parágrafo com
  // `w:jc` explícito ignora esse default.
  for (const tbl of pickAll(root, 'tbl')) {
    const firstRow = pick(tbl, 'tr');
    if (!firstRow) continue;
    const cells = pickAll(firstRow, 'tc');
    for (let i = 0; i < cells.length; i++) {
      const cellDefault = defaultAlignForCell(i, cells.length);
      for (const p of pickAll(cells[i], 'p')) {
        emitParagraph(p, rels, cellDefault, cursor, elements);
      }
    }
  }

  return { elements, warnings };
}

/**
 * Altura mínima (em mm) que a banda precisa ter para caber todos os elementos
 * emitidos, considerando o empilhamento por zona. Exposto para o orquestrador
 * dimensionar `band.heightMm` sem recalcular o cursor.
 */
export function estimateBandHeightFromElements(elements: BandElement[]): number {
  const y: Record<Align, number> = { left: 0, center: 0, right: 0 };
  for (const el of elements) {
    const h = el.type === 'image' ? el.heightMm : TEXT_LINE_HEIGHT_MM(el.fontSizePt);
    const bottom = el.yMm + h;
    if (bottom > y[el.align]) y[el.align] = bottom;
  }
  return Math.max(y.left, y.center, y.right);
}
