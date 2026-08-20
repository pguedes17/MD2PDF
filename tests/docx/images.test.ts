import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadDocxImages } from '../../src/docx/images.js';
import { createAssetRepo } from '../../src/storage/assetRepo.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fakeArchive(files: Record<string, Uint8Array | null>) {
  return {
    text: () => null,
    bytes: (p: string) => files[p] ?? null,
    list: () => Object.keys(files),
  };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-images-'));
});

describe('uploadDocxImages', () => {
  it('sobe PNG referenciado e devolve assetId', async () => {
    const archive = fakeArchive({ 'word/media/image2.png': new Uint8Array(PNG_BYTES) });
    const repo = createAssetRepo(dir);
    const { images, warnings } = await uploadDocxImages(archive, ['word/media/image2.png'], repo);
    expect(images).toHaveLength(1);
    expect(images[0]!.assetId).toMatch(/^ast_/);
    expect(images[0]!.mime).toBe('image/png');
    expect(warnings).toEqual([]);
  });

  it('EMF vira warning e não é uploaded', async () => {
    const archive = fakeArchive({ 'word/media/image1.emf': new Uint8Array([0x01, 0x00]) });
    const repo = createAssetRepo(dir);
    const { images, warnings } = await uploadDocxImages(archive, ['word/media/image1.emf'], repo);
    expect(images).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'EMF_NOT_SUPPORTED')).toBe(true);
  });

  it('imagem não referenciada é ignorada', async () => {
    const archive = fakeArchive({ 'word/media/image9.png': new Uint8Array(PNG_BYTES) });
    const repo = createAssetRepo(dir);
    const { images } = await uploadDocxImages(archive, [], repo);
    expect(images).toEqual([]);
  });
});
