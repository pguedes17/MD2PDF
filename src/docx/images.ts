import path from 'node:path';
import type { AssetRepo } from '../storage/assetRepo.js';
import type { DocxArchive } from './unzip.js';
import type { DocxAnalysis, Warning } from './schema.js';

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface UploadResult {
  images: DocxAnalysis['images'];
  warnings: Warning[];
}

export async function uploadDocxImages(
  archive: DocxArchive,
  referencedPaths: string[],
  assetRepo: AssetRepo,
): Promise<UploadResult> {
  const images: DocxAnalysis['images'] = [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  for (const docxPath of referencedPaths) {
    if (seen.has(docxPath)) continue;
    seen.add(docxPath);

    const ext = path.extname(docxPath).toLowerCase();
    if (ext === '.emf' || ext === '.wmf') {
      warnings.push({
        code: 'EMF_NOT_SUPPORTED',
        message: `${docxPath} é ${ext.slice(1).toUpperCase()}; Chromium não renderiza. Substitua por PNG/SVG.`,
      });
      continue;
    }

    const mime = EXT_TO_MIME[ext];
    if (!mime) continue;

    const bytes = archive.bytes(docxPath);
    if (!bytes) continue;

    const meta = await assetRepo.save({
      originalName: path.basename(docxPath),
      mime,
      data: Buffer.from(bytes),
    });
    images.push({ docxPath, assetId: meta.id, mime });
  }

  return { images, warnings };
}
