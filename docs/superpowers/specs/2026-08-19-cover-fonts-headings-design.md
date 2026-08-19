# Template: capa customizável, fonte do corpo e estilos de cabeçalho

**Status:** aguardando revisão
**Data:** 2026-08-19

## Motivação

O template atual cobre header/footer e propriedades básicas do corpo
(`fontFamily`, `fontSizePt`, `color`, `lineHeight`), mas três lacunas
recorrentes bloqueiam casos reais:

1. **Capa.** Não há como definir uma primeira página com título centralizado,
   logo grande, subtítulo, data — o layout típico de contrato, relatório e
   proposta. Hoje o usuário faria isso "à mão" no próprio Markdown, e o
   resultado depende do CSS do corpo, sem controle real de posição.
2. **Fonte.** `body.fontFamily` é um campo de texto livre sem ajuda visual.
   O usuário precisa saber o nome exato da fonte e, se quiser usar a fonte
   da identidade da empresa, não tem por onde subir o arquivo.
3. **Cabeçalhos de seção.** `h1/h2/h3…` usam um CSS fixo (cor `#111`, peso
   default do agente, escala do navegador). Não dá para configurar cor,
   peso ou tamanho por nível — o que é o pedido mais comum de "identidade
   visual" depois de logo e fonte.

Este spec adiciona as três seções ao domínio, ao renderer e ao editor,
preservando compatibilidade com templates existentes via migração.

## Escopo

**Dentro do escopo:**
- Nova seção `cover` no template, opcional, com free-positioning de
  elementos (texto/imagem/data) e opção de aplicar ou não header/footer
  na capa.
- Novo campo `body.font` com dropdown de fontes web-safe curadas + suporte
  a fonte customizada via upload (`.ttf/.otf`).
- Nova seção `headings` com estilo por nível (h1, h2, h3) — cor, negrito,
  tamanho.
- Migração de templates existentes (`version: 1` → `version: 2`).
- Endpoint novo `POST/GET/DELETE /api/fonts` e storage dedicado.
- Bundle export/import ganha os arquivos de fonte custom, análogo aos
  assets de imagem.

**Fora do escopo:**
- h4/h5/h6 configuráveis individualmente (herdam de h3 via seletor).
- Espaçamento antes/depois dos headings.
- Contracapa / última página.
- Numeração customizada da capa (a capa fica fora de `{page}/{total}` do
  corpo por padrão; não há opção de "capa conta como página 1").
- Múltiplas capas.
- Elemento novo "bloco multi-linha" na capa — o `text` atual já aceita
  quebras via `\n`; se virar demanda, tratamos depois.

## 1. Capa

### 1.1 Modelo de dados

Nova seção `cover` em `src/domain/template.ts`:

```ts
CoverElementSchema = z.discriminatedUnion('type', [
  // reaproveita 'image', 'text', 'date' do ElementSchema atual,
  // mas com yMm liberado até a altura útil da página (ver 1.2).
  // 'pageNumber' NÃO entra — não faz sentido na capa.
]);

CoverSchema = z.object({
  enabled: z.boolean().default(false),
  applyHeaderFooter: z.boolean().default(false),
  elements: z.array(CoverElementSchema).default([]),
});
```

Adicionado ao `baseTemplateShape`:
```ts
cover: CoverSchema.prefault({}),
```

### 1.2 Range de `yMm` para elementos de capa

Elementos de banda hoje têm `yMm` limitado a `0..60` (altura máxima de
faixa). Na capa, `yMm` precisa ir até a altura útil da página. O
`positionProps` atual não serve como está.

Solução: extrair um `bandPositionProps` (yMm 0..60) e criar um
`coverPositionProps` (yMm 0..320, cobrindo A4 landscape com folga).

Regra de sanidade análoga a `checkElementsFit` para bandas: os elementos
não podem sair da folha (page.height inteira quando `applyHeaderFooter=
false`, ou page.height - margins.top - margins.bottom quando `true`).
Falhar cedo evita elemento saindo da folha.

### 1.3 Renderização

Dois caminhos no `renderTemplate` de `src/render/template.ts`:

**Caminho A — `cover.enabled=false`:** nada muda. Retorna o
`RenderedTemplate` atual.

**Caminho B — `cover.enabled=true && applyHeaderFooter=true`:** um único
documento HTML. O `bodyHtml` final é
`<div class="cover-page">…</div><div class="page-break"></div>` seguido
do markdown renderizado. Sem mudança no pipeline do PDF (um único
`page.pdf()`).

**Caminho C — `cover.enabled=true && applyHeaderFooter=false`:** dois
PDFs concatenados.

- PDF 1 (capa): documento próprio, sem header/footer
  (`displayHeaderFooter: false`), **margens zero** (a capa é uma folha em
  branco onde o usuário posiciona livremente — as margens da página do
  template só afetam o corpo). Corpo é o HTML da capa dentro de uma folha
  com `height: 100vh`.
- PDF 2 (corpo): fluxo atual.
- Merge com `pdf-lib` (nova dep, MIT, ~200KB, puro JS): capa em primeiro,
  corpo em seguida. Contagem `{page}/{total}` no rodapé passa a refletir só
  as páginas do corpo (a capa é literalmente um PDF separado — o Chromium
  do corpo não sabe da capa).

Consequência aceita: no caminho C, "página 1 de N" no rodapé começa na
página 2 do PDF final. Documentado no README.

### 1.4 Interface do renderer

`RenderedTemplate` ganha, opcionalmente:
```ts
cover?: {
  html: string;       // documento HTML completo da capa
  pdfOptions: PdfOptions;  // com displayHeaderFooter: false
}
```

O `ConversionService.convertWithTemplate` inspeciona o resultado: se
`cover` existe E é o caminho C, chama `pdfService.convert` duas vezes e
concatena com `pdf-lib`. Caso contrário, chama uma vez.

Isso encapsula a decisão fora do renderer puro — a função continua sem
`fs`/Playwright/Fastify.

### 1.5 Editor

- Nova aba "Capa" no `TemplateEditor.tsx`, entre "Página" e "Cabeçalho".
- Toggle "Habilitar capa". Quando ligado, revela:
  - Checkbox "aplicar cabeçalho e rodapé também na capa" (default
    desligado).
  - Canvas em folha inteira usando o mesmo `Sheet.tsx` do
    posicionamento livre, com `heightMm = pageHeight` em vez de
    `heightMm = bandHeight`.
  - Botão "+ elemento" com opções `texto`, `imagem`, `data`.
  - Inspetor à direita com os campos existentes + atalhos de posição:
    "Centralizar horizontal" (align=center, xOffset=0), "Meio vertical"
    (yMm = pageHeight/2 - elementHeight/2), "Topo" (yMm=0),
    "Rodapé da capa" (yMm = pageHeight - elementHeight - margem).

O preview do editor precisa mostrar a capa quando ligada — a lista de
folhas na thumbnail passa a incluir "Capa" como primeira folha, seguida
do corpo.

## 2. Fonte do corpo

### 2.1 Modelo de dados

`BodySchema` em `src/domain/template.ts` muda:

```ts
BodySchema = z.object({
  font: z.object({
    family: z.string().min(1),           // presente sempre
    customFontId: z.string().optional(), // se setado, emite @font-face
  }),
  fontSizePt: fontSizePt.default(11),
  color: hexColor.default('#111111'),
  lineHeight: z.number().min(1).max(3).default(1.5),
});
```

`fontFamily: string` deixa de existir como campo raiz do body. Migração em
2.4.

### 2.2 Presets curados

Lista fixa em um novo módulo `src/domain/fontPresets.ts`, exportada também
pro editor:

```ts
FONT_PRESETS = [
  { family: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", label: "Sistema (padrão)" },
  { family: "Arial, Helvetica, sans-serif", label: "Arial" },
  { family: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { family: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { family: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { family: "'Courier New', Courier, monospace", label: "Courier New" },
  { family: "Roboto, sans-serif", label: "Roboto" },
  { family: "Inter, sans-serif", label: "Inter" },
  { family: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { family: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
];
```

### 2.3 Upload de fonte customizada

**Storage:** `src/storage/fontRepo.ts`, novo, espelha `assetRepo.ts`:
- Diretório `./storage/fonts/`.
- Arquivo `<fontId>.ttf` ou `.otf`.
- Manifest `<fontId>.json` com `{ id, family, filename, mimeType, size, createdAt }`.
- ID: `fnt_<12 chars base62>`, validado por regex.

**Rota:** `src/routes/fonts.ts`, novo:
- `POST /api/fonts` (multipart, campo `file` + campo `family` no form):
  valida MIME (`font/ttf`, `font/otf`, `application/font-sfnt`,
  `application/octet-stream` com extensão .ttf/.otf), tamanho máximo 2MB,
  retorna `{ id, family }`.
- `GET /api/fonts` — lista.
- `GET /api/fonts/:id` — serve o binário (usado pelo preview do editor).
- `GET /api/fonts/:id/data-uri` — retorna `data:font/ttf;base64,...`
  (usado pelo preview quando embutir via `@font-face` diretamente).
- `DELETE /api/fonts/:id` — remove. Recusa (409) se algum template
  referencia a fonte.

**Renderer:** `buildCss` recebe o data URI da fonte custom (resolvido pelo
`ConversionService` similar ao `resolveAssets`) e emite, quando aplicável:

```css
@font-face {
  font-family: '<family declarada pelo usuário no upload>';
  src: url(data:font/ttf;base64,...) format('truetype');
  font-weight: normal;
  font-style: normal;
}
```

O `body.font.family` no template, quando `customFontId` está setado, tem o
mesmo nome declarado no `@font-face`.

**Editor:** componente novo `FontPicker.tsx`:
- Dropdown com presets.
- Botão "usar fonte customizada" que abre um modal com upload + lista de
  fontes já subidas. Ao selecionar, popula `body.font.family` (com o nome
  declarado no upload) e `body.font.customFontId`.

## 3. Estilos de cabeçalho

### 3.1 Modelo de dados

Nova seção `headings` em `src/domain/template.ts`:

```ts
HeadingStyleSchema = z.object({
  color: hexColor,
  bold: z.boolean(),
  fontSizePt: fontSizePt,
});

HeadingsSchema = z.object({
  h1: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 20 }),
  h2: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 16 }),
  h3: HeadingStyleSchema.prefault({ color: '#111111', bold: true, fontSizePt: 13 }),
});
```

Adicionado ao `baseTemplateShape` com `.prefault({})`.

### 3.2 Renderização

Em `buildCss`, três blocos novos, depois do bloco geral de headings:

```css
h1 { color: <h1.color>; font-weight: <h1.bold ? 700 : 400>; font-size: <h1.fontSizePt>pt; }
h2 { color: <h2.color>; font-weight: <h2.bold ? 700 : 400>; font-size: <h2.fontSizePt>pt; }
h3, h4, h5, h6 { color: <h3.color>; font-weight: <h3.bold ? 700 : 400>; font-size: <h3.fontSizePt>pt; }
```

Notas:
- h4/h5/h6 herdam do h3 via seletor combinado — decisão explícita para
  evitar 3 níveis extras de configuração raramente usados.
- As regras gerais existentes (`break-after: avoid`, `margin`,
  `line-height`) permanecem — só cor/peso/tamanho passam a ser
  configuráveis.

### 3.3 Editor

Painel "Tipografia" (ou dentro da seção "Corpo") com 3 linhas — h1, h2, h3
— cada uma com:
- Input de cor (color picker + campo hex).
- Checkbox "negrito".
- Input numérico "tamanho (pt)" com validação 4–72.

## 4. Migração

`src/domain/templateMigration.ts` já existe (o repo tem histórico de
migrações). Ganha um passo `version 1 → version 2`:

```ts
{
  ...t,
  version: 2,
  cover: { enabled: false, applyHeaderFooter: false, elements: [] },
  body: {
    font: { family: t.body.fontFamily },  // move o string livre pro novo shape
    fontSizePt: t.body.fontSizePt,
    color: t.body.color,
    lineHeight: t.body.lineHeight,
  },
  headings: {
    h1: { color: '#111111', bold: true, fontSizePt: 20 },
    h2: { color: '#111111', bold: true, fontSizePt: 16 },
    h3: { color: '#111111', bold: true, fontSizePt: 13 },
  },
}
```

Templates carregados do disco em versão 1 passam pela migração antes de
serem validados pelo schema versão 2. Escrita subsequente já salva no
formato novo. Sem quebra pra usuários existentes.

## 5. Bundle export/import

`src/domain/templateBundle.ts` hoje inclui os assets de imagem embutidos.
Análogo: quando o template tem `body.font.customFontId`, o bundle inclui o
arquivo de fonte como base64 + manifest. No import, se a fonte não existe
localmente, é criada; se existe (mesmo hash de conteúdo), reutilizada.

## 6. OpenAPI e MCP

`web/src/lib/templateOpenApi.ts` reflete os novos campos no schema OpenAPI
exportado (usado pelas tools MCP e pelos botões "Copiar OpenAPI").

## 7. Testes

Adicionar em `tests/`:

**Cover:**
- Template com `cover.enabled=true, applyHeaderFooter=false` gera PDF com
  `pages = 1 + N_corpo`. Página 1 não tem header/footer (checa via
  `pdfjs-dist` que texto do header não aparece).
- Template com `applyHeaderFooter=true` tem header em todas as páginas,
  inclusive a primeira.
- Elemento de capa fora dos limites da página → erro de validação.
- `pageNumber` não é aceito como elemento de capa (schema recusa).

**Fonte:**
- POST /api/fonts com .ttf válido retorna id.
- GET /api/fonts/:id/data-uri retorna `data:font/ttf;base64,...`.
- Template com `customFontId` gera CSS com `@font-face` embutido.
- DELETE /api/fonts/:id recusa se um template referencia (409).

**Headings:**
- Template com `headings.h1.color='#ff0000'` gera CSS `h1 { color: #ff0000; ... }`.
- H4-H6 usam mesma regra do h3 (seletor combinado).

**Migração:**
- Template versão 1 no disco é lido, migrado e passa no schema v2.
- `body.fontFamily` vira `body.font.family` sem perda.

## 8. Impacto por arquivo

**Backend:**
- `src/domain/template.ts` — novos schemas, novo shape de body, versão 2.
- `src/domain/templateMigration.ts` — passo v1→v2.
- `src/domain/templateBundle.ts` — inclui fonte no export/import.
- `src/domain/fontPresets.ts` — novo, lista curada.
- `src/render/template.ts` — cover HTML, CSS de headings, `@font-face`.
- `src/conversion.ts` — merge de PDFs quando aplicável.
- `src/storage/fontRepo.ts` — novo.
- `src/routes/fonts.ts` — novo.
- `src/app.ts` — registra rota de fontes.
- `src/config.ts` — dir de fontes, limite de tamanho.
- `package.json` — nova dep `pdf-lib`.

**Frontend:**
- `web/src/lib/templateModel.ts` — tipos derivados atualizados.
- `web/src/lib/templateOpenApi.ts` — schema OpenAPI atualizado.
- `web/src/pages/TemplateEditor.tsx` — nova aba "Capa", painel de
  tipografia, integração com FontPicker.
- `web/src/components/CoverEditor.tsx` — novo, canvas de folha inteira.
- `web/src/components/HeadingsPanel.tsx` — novo.
- `web/src/components/FontPicker.tsx` — novo.
- `web/src/api.ts` — endpoints de fontes.

## 9. Decisões abertas para o plano

Estas ficam para o `writing-plans` decidir, não afetam a validade do
design:

- Ordem de merge de PDFs: `pdf-lib` na conversão, ou um utilitário à
  parte em `src/render/pdfMerge.ts`? Preferência inicial: utilitário
  separado, testável isolado.
- Editor da capa: um só canvas, ou canvas com zoom manual (já existe
  para bandas)? Preferência: reusar o zoom manual — consistência.
- `applyHeaderFooter=true` deve incluir a capa no `total` de páginas?
  Sim, é o comportamento natural (documento único). No caminho C
  (capa isolada), a capa fica fora do total — é a única forma sem
  mexer no Chromium.

## 10. Rollout

Sem feature flag. Migração é retrocompatível e a UI nova só aparece se o
usuário abrir a nova aba. Deploy padrão.
