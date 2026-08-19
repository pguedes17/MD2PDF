import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const PAGEBREAK_LINE = /^\s*<!--\s*pagebreak\s*-->\s*$/i;

/**
 * Regra de bloco que reconhece `<!-- pagebreak -->` numa linha isolada.
 * É uma regra própria (e não pré-processamento do texto) porque assim o
 * marcador só vale onde de fato é um bloco — dentro de um code fence ele
 * continua sendo texto literal.
 */
function pagebreakPlugin(md: MarkdownItInstance): void {
  md.block.ruler.before('html_block', 'pagebreak', (state, startLine, _endLine, silent) => {
    const start = state.bMarks[startLine]! + state.tShift[startLine]!;
    const max = state.eMarks[startLine]!;
    if (!PAGEBREAK_LINE.test(state.src.slice(start, max))) return false;
    if (silent) return true;

    state.line = startLine + 1;
    const token = state.push('pagebreak', 'div', 0);
    token.map = [startLine, state.line];
    token.markup = '<!-- pagebreak -->';
    return true;
  });

  md.renderer.rules.pagebreak = () => '<div class="page-break"></div>\n';
}

const md = new MarkdownIt({
  // O markdown vem de clientes da API: HTML cru fica desligado na origem,
  // e o sanitize abaixo é a segunda camada.
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
}).use(pagebreakPlugin);

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'em', 'strong', 's', 'del', 'ins', 'sub', 'sup', 'mark',
    'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan', 'align'],
    td: ['colspan', 'rowspan', 'align'],
    code: ['class'],
    ol: ['start'],
  },
  // Só a div de quebra de página; nenhuma outra classe atravessa.
  allowedClasses: { div: ['page-break'], code: ['language-*'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  disallowedTagsMode: 'discard',
};

/** Markdown (entrada não confiável) → HTML sanitizado, pronto para o corpo da página. */
export function renderMarkdown(markdown: string): string {
  return sanitizeHtml(md.render(markdown), SANITIZE_OPTIONS);
}
