import { describe, it, expect } from 'vitest';
import { parseXml, pick, pickAll, attr } from '../../src/docx/xml.js';

const sample = `
<w:root xmlns:w="urn:x" xmlns:r="urn:y">
  <w:section>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="2000" w:bottom="1500"/>
    <w:child w:val="a"/>
    <w:child w:val="b"/>
  </w:section>
</w:root>`;

describe('xml', () => {
  it('pick: encontra child por nome local, ignora prefixo', () => {
    const root = parseXml(sample);
    const section = pick(root, 'root');
    const inner = pick(section, 'section');
    const pgSz = pick(inner, 'pgSz');
    expect(attr(pgSz, 'w')).toBe('11906');
    expect(attr(pgSz, 'h')).toBe('16838');
  });

  it('pickAll: normaliza escalar/array para sempre array', () => {
    const root = parseXml(sample);
    const section = pick(pick(root, 'root'), 'section');
    const children = pickAll(section, 'child');
    expect(children).toHaveLength(2);
    expect(attr(children[0], 'val')).toBe('a');
    expect(attr(children[1], 'val')).toBe('b');
  });

  it('pick: devolve undefined quando não existe', () => {
    const root = parseXml(sample);
    expect(pick(root, 'inexistente')).toBeUndefined();
  });

  it('pickAll: array vazio quando não existe', () => {
    const root = parseXml(sample);
    expect(pickAll(root, 'inexistente')).toEqual([]);
  });
});
