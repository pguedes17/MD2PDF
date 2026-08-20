import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { openDocx } from '../../src/docx/unzip.js';

const buf = fs.readFileSync('tests/fixtures/docx/bionexo-requisitos.docx');

describe('openDocx', () => {
  it('devolve texto do document.xml', () => {
    const doc = openDocx(buf).text('word/document.xml');
    expect(doc).toBeTruthy();
    expect(doc!.startsWith('<?xml')).toBe(true);
  });

  it('devolve null para path inexistente', () => {
    expect(openDocx(buf).text('word/naoexiste.xml')).toBeNull();
  });

  it('lista arquivos', () => {
    const list = openDocx(buf).list();
    expect(list).toContain('word/document.xml');
    expect(list).toContain('word/styles.xml');
  });

  it('devolve bytes para binários', () => {
    const bytes = openDocx(buf).bytes('word/media/image2.png');
    expect(bytes).toBeTruthy();
    // PNG magic
    expect(bytes![0]).toBe(0x89);
    expect(bytes![1]).toBe(0x50);
  });
});
