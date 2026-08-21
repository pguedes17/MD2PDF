import { describe, it, expect } from 'vitest';
import { parseTheme } from '../../src/docx/theme.js';

const minimalTheme = `<?xml version="1.0"?>
<a:theme xmlns:a="urn:z">
  <a:themeElements>
    <a:clrScheme>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    </a:clrScheme>
    <a:fontScheme>
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

describe('parseTheme', () => {
  it('resolve accent1 do srgbClr', () => {
    const t = parseTheme(minimalTheme);
    expect(t.color('accent1')).toBe('#4472C4');
  });

  it('resolve dk1 via lastClr do sysClr', () => {
    const t = parseTheme(minimalTheme);
    expect(t.color('dk1')).toBe('#000000');
  });

  it('devolve fonts major/minor', () => {
    const t = parseTheme(minimalTheme);
    expect(t.majorFont()).toBe('Calibri Light');
    expect(t.minorFont()).toBe('Calibri');
  });

  it('theme null → tudo undefined', () => {
    const t = parseTheme(null);
    expect(t.color('accent1')).toBeUndefined();
    expect(t.majorFont()).toBeUndefined();
  });
});
