import type { AssetRepo } from '../storage/assetRepo.js';
import { openDocx, type DocxArchive } from './unzip.js';
import { parseXml, pick, pickAll, attr } from './xml.js';
import { extractPageSetup } from './pageSetup.js';
import { parseTheme } from './theme.js';
import { extractStyles } from './styles.js';
import { extractBand } from './bands.js';
import { uploadDocxImages } from './images.js';
import { mapFontsToPresets } from './fonts.js';
import type { DocxAnalysis, Warning } from './schema.js';

export interface AnalyzeResult { analysis: DocxAnalysis; warnings: Warning[]; }

function readRels(archive: DocxArchive, relsPath: string): Record<string, string> {
  const xml = archive.text(relsPath);
  if (!xml) return {};
  const doc = parseXml(xml);
  const list = pickAll(pick(doc, 'Relationships'), 'Relationship');
  const map: Record<string, string> = {};
  for (const rel of list) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) map[id] = target;
  }
  return map;
}

function sectPrRefs(documentXml: string): {
  headers: Array<{ role: 'default' | 'first' | 'even'; rId: string }>;
  footers: Array<{ role: 'default' | 'first' | 'even'; rId: string }>;
} {
  const doc = parseXml(documentXml);
  const body = pick(pick(doc, 'document'), 'body');
  const sectPrs = pickAll(body, 'sectPr');
  const last = sectPrs[sectPrs.length - 1];
  if (!last) return { headers: [], footers: [] };
  const roleOf = (v: string | undefined): 'default' | 'first' | 'even' =>
    v === 'first' ? 'first' : v === 'even' ? 'even' : 'default';
  const headers = pickAll(last, 'headerReference')
    .map((r) => ({ role: roleOf(attr(r, 'type')), rId: attr(r, 'id') }))
    .filter((r): r is { role: 'default' | 'first' | 'even'; rId: string } => !!r.rId);
  const footers = pickAll(last, 'footerReference')
    .map((r) => ({ role: roleOf(attr(r, 'type')), rId: attr(r, 'id') }))
    .filter((r): r is { role: 'default' | 'first' | 'even'; rId: string } => !!r.rId);
  return { headers, footers };
}

function estimateBandHeightMm(elements: DocxAnalysis['headers'][string]['elements']): number {
  if (elements.length === 0) return 0;
  const heights = elements.map((el) =>
    el.type === 'image' ? el.heightMm : el.fontSizePt * 0.353 * 1.2,
  );
  return Math.max(15, Math.ceil(Math.max(...heights) + 5));
}

export async function analyzeDocx(buf: Buffer, assetRepo: AssetRepo): Promise<AnalyzeResult> {
  const archive = openDocx(buf);
  const warnings: Warning[] = [];

  const documentXml = archive.text('word/document.xml');
  if (!documentXml) throw Object.assign(new Error('docx sem word/document.xml'), { statusCode: 400 });

  const pageResult = extractPageSetup(documentXml);
  warnings.push(...pageResult.warnings);

  const theme = parseTheme(archive.text('word/theme/theme1.xml'));
  const stylesXml = archive.text('word/styles.xml') ?? '<w:styles xmlns:w="urn:x"/>';
  const stylesResult = extractStyles(stylesXml, theme);
  warnings.push(...stylesResult.warnings);

  const documentRels = readRels(archive, 'word/_rels/document.xml.rels');
  const refs = sectPrRefs(documentXml);

  const headers: DocxAnalysis['headers'] = {};
  const footers: DocxAnalysis['footers'] = {};
  const referencedImagePaths: string[] = [];

  for (const ref of refs.headers) {
    const target = documentRels[ref.rId];
    if (!target) continue;
    const bandPath = `word/${target}`;
    const bandXml = archive.text(bandPath);
    if (!bandXml) continue;
    const bandRels = readRels(archive, `word/_rels/${target.split('/').pop()}.rels`);
    const extracted = extractBand(bandXml, bandRels, theme);
    warnings.push(...extracted.warnings);
    for (const el of extracted.elements) {
      if (el.type === 'image') referencedImagePaths.push(el.imageDocxPath);
    }
    headers[ref.role] = { heightMm: estimateBandHeightMm(extracted.elements), elements: extracted.elements };
  }

  for (const ref of refs.footers) {
    const target = documentRels[ref.rId];
    if (!target) continue;
    const bandPath = `word/${target}`;
    const bandXml = archive.text(bandPath);
    if (!bandXml) continue;
    const bandRels = readRels(archive, `word/_rels/${target.split('/').pop()}.rels`);
    const extracted = extractBand(bandXml, bandRels, theme);
    warnings.push(...extracted.warnings);
    for (const el of extracted.elements) {
      if (el.type === 'image') referencedImagePaths.push(el.imageDocxPath);
    }
    footers[ref.role] = { heightMm: estimateBandHeightMm(extracted.elements), elements: extracted.elements };
  }

  const uploaded = await uploadDocxImages(archive, referencedImagePaths, assetRepo);
  warnings.push(...uploaded.warnings);

  // Fontes detectadas: body + headings (unique).
  const detected = Array.from(new Set([
    stylesResult.body.family,
    stylesResult.headings.h1?.family,
    stylesResult.headings.h2?.family,
    stylesResult.headings.h3?.family,
  ].filter((f): f is string => !!f)));
  const fonts = mapFontsToPresets(detected);
  warnings.push(...fonts.warnings);

  return {
    analysis: {
      page: pageResult.page,
      headers,
      footers,
      styles: { body: stylesResult.body, headings: stylesResult.headings },
      images: uploaded.images,
      fonts: {
        detected,
        presetMatches: fonts.presetMatches,
        unmatched: fonts.unmatched,
      },
    },
    warnings,
  };
}
