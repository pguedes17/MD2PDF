import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/render/markdown.js';

describe('renderMarkdown', () => {
  it('converte títulos, ênfase e listas', () => {
    const html = renderMarkdown('# Título\n\nTexto **forte**.\n\n- um\n- dois\n');
    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('<li>um</li>');
  });

  it('renderiza tabelas GFM', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('transforma <!-- pagebreak --> em quebra de página', () => {
    const html = renderMarkdown('Antes\n\n<!-- pagebreak -->\n\nDepois');
    expect(html).toContain('<div class="page-break"></div>');
    expect(html.indexOf('Antes')).toBeLessThan(html.indexOf('page-break'));
    expect(html.indexOf('page-break')).toBeLessThan(html.indexOf('Depois'));
  });

  it('aceita variações de espaço e caixa no marcador', () => {
    for (const marker of ['<!--pagebreak-->', '<!--   PageBreak   -->', '   <!-- pagebreak -->  ']) {
      expect(renderMarkdown(`a\n\n${marker}\n\nb`), marker).toContain('<div class="page-break"></div>');
    }
  });

  it('não confunde outros comentários com quebra de página', () => {
    const html = renderMarkdown('a\n\n<!-- comentário qualquer -->\n\nb');
    expect(html).not.toContain('page-break');
  });

  // O objetivo não é apagar o texto que o autor escreveu, e sim garantir que
  // nada dele vire markup executável dentro do Chromium.
  it('neutraliza script injetado no markdown', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\ntexto');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutraliza iframe e handlers inline', () => {
    const html = renderMarkdown('<iframe src="http://x"></iframe>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<iframe/i);
    // o markup inteiro virou texto escapado, logo nenhum handler existe como atributo
    expect(html).not.toMatch(/<img[^>]*on\w+\s*=/i);
    expect(html).toContain('&lt;img');
  });

  it('não gera link com esquema javascript:', () => {
    const html = renderMarkdown('[clique](javascript:alert(1))');
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(html).not.toContain('<a ');
  });

  it('preserva imagens http e data', () => {
    const html = renderMarkdown('![logo](https://exemplo.com/l.png)\n\n![i](data:image/png;base64,AAA)');
    expect(html).toContain('src="https://exemplo.com/l.png"');
    expect(html).toContain('data:image/png;base64,AAA');
  });

  it('mantém blocos de código escapados', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('1 &lt; 2');
  });

  it('não trata o marcador dentro de code fence como quebra', () => {
    const html = renderMarkdown('```\n<!-- pagebreak -->\n```');
    expect(html).not.toContain('<div class="page-break">');
    expect(html).toContain('&lt;!-- pagebreak --&gt;');
  });

  it('só permite a classe page-break em div', () => {
    const html = renderMarkdown('<div class="qualquer">x</div>');
    expect(html).not.toContain('class="qualquer"');
  });

  it('devolve string vazia para markdown vazio', () => {
    expect(renderMarkdown('').trim()).toBe('');
  });
});
