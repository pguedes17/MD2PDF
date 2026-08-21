# DOCX → Template automático no md2pdf

**Data:** 2026-08-20
**Autor:** Pedro Guedes + Claude (brainstorm arquitetural)
**Status:** proposta — aguardando aprovação para virar plano de implementação

---

## 1. Contexto e problema

O md2pdf hoje resolve **uma metade** do problema: dado um `Template` já
existente (JSON validado por Zod, com page setup, header/footer por zonas,
tipografia e capa opcional) e um markdown, entrega um PDF fiel ao template.
Templates são criados **à mão** no editor visual (`web/`).

A outra metade continua manual: quando uma área da empresa (ex.: Bionexo)
já tem um `.docx` de referência com o "papel timbrado" oficial —
cabeçalho, rodapé, logos, cores, fontes, margens, capa —, reproduzir isso
no editor é trabalho tedioso e sujeito a erro. Isso trava a adoção: quem
consegue gerar markdown com IA rapidamente ainda esbarra em "e agora,
como faço virar o PDF que a empresa aceita?".

**Objetivo:** dado um `.docx`, produzir automaticamente um `Template`
válido do md2pdf que reproduza a identidade visual do documento —
tipografia, cores, cabeçalho/rodapé com textos e logo, geometria de
página — pronto para consumir markdown.

**Objetivo secundário:** deixar essa capacidade acessível via MCP, para
que agentes (Claude Code, Cursor, etc.) chamem "importa esse docx" e
depois "converte esse markdown com esse template" no mesmo fluxo.

---

## 2. Não-objetivos (escopo cortado deliberadamente)

O DOCX é um formato profundo. Tentar reproduzir tudo é onde projetos
assim falham. Ficam **fora** da primeira versão:

- **Corpo do documento.** O corpo vem do markdown do usuário. Ignoramos
  o `body` do docx (parágrafos, tabelas, listas numeradas, fields).
- **Layout pixel-perfect.** Word e Chromium têm modelos de layout
  diferentes. Miramos identidade visual (cores, fontes, geometria),
  não paridade tipográfica de kerning/first-line indent/tab stops.
- **Imagens vetoriais Windows-only.** `.emf` e `.wmf` embutidos não são
  renderizáveis por Chromium; viram warning pedindo substituição por
  PNG/SVG. Não vamos linkar libreoffice/inkscape.
- **Múltiplas seções com layouts distintos.** Se o docx tem seções com
  cabeçalhos diferentes ao longo do documento, importamos a **primeira**
  seção "default" e emitimos warning sobre as demais.
- **Numeração, sumário automático, campos ({DATE}, {SEQ}).** Ignorados.
- **Estilos além de Heading 1-3 e Normal.** Heading 4-6 já herdam h3 no
  schema; estilos custom (Callout, Quote, etc.) ficam para depois.
- **Fontes proprietárias embutidas.** Se o docx usa uma fonte que não
  está nos presets nem foi uploadada via `/api/fonts`, o mapeador tenta
  best-match e emite warning; não descriptografamos font-embedding do
  Word.
- **LLM no core do md2pdf.** O servidor continua determinístico. Onde
  precisa de julgamento (ex.: "esse bloco da primeira página é a capa
  ou é só um cabeçalho grande?"), o servidor faz escolha conservadora
  + warning; o agente que chama decide.

---

## 3. Alternativas consideradas

### A. Parser determinístico puro no md2pdf
Um endpoint que recebe o `.docx`, extrai XMLs, mapeia direto para
`TemplateInput` e persiste. Sem LLM em lugar nenhum.

- ✅ Zero custo variável, offline, testável com fixtures.
- ✅ Casa com a filosofia do repo (`render/template.ts` é uma função
  pura, sem I/O; a mesma coisa se aplica ao extrator).
- ❌ Casos ambíguos (o que é capa? qual preset de fonte usar?) precisam
  de heurística embutida — ou você acerta 80% e frustra 20%, ou
  configura ad infinitum.

### B. Parser + LLM chamado pelo servidor
Servidor extrai fatos, envia para um LLM com o Zod schema do template
como spec, LLM devolve o `TemplateInput`.

- ✅ Melhor qualidade nos ambíguos.
- ❌ Custo por chamada, latência, dependência de credencial, exige que
  o md2pdf saiba de LLMs (contraria o design atual).
- ❌ Mais uma coisa para debugar: "por que o LLM colocou o logo na
  direita hoje mas na esquerda ontem?".

### C. Parser determinístico + mapeador determinístico + LLM opcional no cliente ⭐
Duas rotas HTTP no md2pdf:

1. `analyze-docx` cospe **fatos brutos** (page setup, styles table,
   headers/footers já parseados, imagens já uploadadas como assets,
   fontes detectadas, warnings).
2. `from-docx` faz **A** por cima do analyze — best-effort determinístico
   com warnings claros — e persiste o template.

Quem usar via MCP (Claude Code, Cursor) tem duas opções:
- Chamar direto `from-docx` e aceitar o resultado (caminho rápido).
- Chamar `analyze-docx`, decidir o que é ambíguo com o cérebro do
  próprio agente, e criar o template via o `POST /api/templates` que
  já existe (caminho com julgamento).

**Recomendação: C.** Mantém o core puro e barato, e devolve o controle
para o agente do usuário — que já está com contexto do projeto — nos
casos onde acertar 100% via regra é impossível. Também é a que menos
altera a arquitetura atual: são só dois novos endpoints e um módulo
`src/docx/` isolado.

---

## 4. Arquitetura

### 4.1 Módulos novos

```
src/
  docx/                     ← NOVO. Puro, sem I/O de rede.
    unzip.ts                unzip via pizzip
    xml.ts                  wrapper fino sobre fast-xml-parser
    units.ts                twips→mm, EMUs→mm, half-points→pt
    pageSetup.ts            document.xml sectPr → page + margins
    styles.ts               styles.xml → { headings, body }
    theme.ts                theme1.xml → resolve cores/fontes por referência
    bands.ts                header{N}.xml + rels → BandElements
    images.ts               media/*.{png,jpg,svg,emf} → decisão + warnings
    fonts.ts                fontTable.xml + Normal.rFonts → mapeamento preset
    analyze.ts              orquestrador: docx bytes → DocxAnalysis
    toTemplate.ts           DocxAnalysis → TemplateInput + warnings
  routes/
    templates.ts            ← acrescenta analyze-docx e from-docx
```

**Por que separado de `render/`:** `render/` é a metade "saída" (template
→ PDF). `docx/` é a metade "entrada" (arquivo → template). São simétricos
e não têm por que compartilhar código; misturar geraria acoplamento sem
retorno.

Todos os módulos em `src/docx/` são puros: recebem bytes/objeto,
devolvem objeto. O único lugar com I/O é `routes/templates.ts` (recebe
multipart, chama assetRepo, chama templateRepo).

### 4.2 Endpoints novos

#### `POST /api/templates/analyze-docx`
- **Request:** `multipart/form-data`, campo `file` (o .docx).
- **Response 200 (`application/json`):**
  ```json
  {
    "analysis": {
      "page": { "format": "A4", "orientation": "portrait",
                "margins": {"top": 34, "right": 20, "bottom": 24, "left": 20} },
      "headers": { "default": {...}, "first": {...} },
      "footers": { "default": {...} },
      "styles": {
        "body": { "family": "Calibri", "fontSizePt": 11, "color": "#000000", "lineHeight": 1.15 },
        "headings": {
          "h1": { "family": "Calibri Light", "bold": false, "fontSizePt": 20, "color": "#2E74B5" },
          "h2": { ... },
          "h3": { ... }
        }
      },
      "images": [
        { "docxPath": "word/media/image2.png", "assetId": "ast_...",
          "widthEmu": 1234567, "heightEmu": 456789, "widthMm": 33.2, "heightMm": 12.1 }
      ],
      "fonts": {
        "detected": ["Calibri", "Calibri Light"],
        "presetMatches": { "Calibri": "Arial, Helvetica, sans-serif" },
        "unmatched": []
      }
    },
    "warnings": [
      { "code": "EMF_NOT_SUPPORTED",
        "message": "word/media/image1.emf é EMF; Chromium não renderiza. Substitua por PNG/SVG." },
      { "code": "MULTIPLE_SECTIONS",
        "message": "Docx tem 3 seções; só a primeira foi importada." }
    ]
  }
  ```
- **Efeitos colaterais:** imagens renderizáveis são uploadadas via
  `assetRepo` para que a resposta já traga `assetId`s utilizáveis. Isso
  economiza um segundo request do agente para colar o logo no template.
- **Não persiste template.** É "raio-X" do docx.

#### `POST /api/templates/from-docx`
- **Request:** mesmo multipart. Query opcional `?name=` (nome do
  template; default = docProps/core.xml `<dc:title>` ou nome do arquivo).
- **Response 200:**
  ```json
  {
    "template": { /* Template completo, já persistido */ },
    "warnings": [ /* mesmas do analyze */ ],
    "assetIds": ["ast_..."]
  }
  ```
- **Efeitos colaterais:** imagens uploadadas (via assetRepo) + template
  persistido (via templateRepo).
- Falha se `TemplateInputSchema` rejeitar o resultado do mapeamento
  (indica bug no mapeador — não é situação normal).

Ambos os endpoints entram no OpenAPI que o botão "Copiar OpenAPI"
gera, então a sua ferramenta OpenAPI→MCP os empacota como tools
automaticamente. Nada especial a fazer para o MCP.

### 4.3 Fluxo de dados

```
docx bytes
   │
   ▼
[unzip.ts] ──► { "word/document.xml": string, "word/media/x.png": Buffer, ... }
   │
   ├──► [pageSetup.ts]  ─► page + margins
   ├──► [styles.ts]     ─┐
   ├──► [theme.ts]      ─┤─► { body, headings }
   ├──► [fonts.ts]      ─┘
   ├──► [bands.ts]      ─► headers/footers com placeholders de asset
   └──► [images.ts]     ─► uploads em assetRepo, devolve mapa docxPath→assetId
   │
   ▼
[analyze.ts]  ─► DocxAnalysis (com warnings coletadas)
   │
   ▼               (só em from-docx)
[toTemplate.ts]  ─► TemplateInput
   │
   ▼
[templateRepo.save] ─► Template persistido
```

Cada módulo tem sua Zod schema de saída, então o contrato interno é
tão rígido quanto o externo. `DocxAnalysis` é um `z.infer` de um
schema exportado — o mesmo tipo é usado pelo mapeador e pela rota.

### 4.4 Tabela de mapeamento DOCX → Template

Coração da coisa. Cada linha vira teste com fixture.

| Fato do DOCX | Onde no Template | Regra |
|---|---|---|
| `document.xml` `w:sectPr/w:pgSz` | `page.format`, `page.orientation` | 11906×16838 twips = A4 portrait; 16838×11906 = A4 landscape; 12240×15840 = Letter portrait. Fora disso: default A4 portrait + warning `UNKNOWN_PAGE_SIZE` |
| `w:sectPr/w:pgMar` (`top/right/bottom/left` em twips) | `page.margins` | `mm = twips × 25.4 / 1440` arredondado a inteiros |
| `w:sectPr/w:pgMar/@w:header` | `header.heightMm` | Distância do topo da página até o topo do header; convertida para mm, com mínimo garantido por `BAND_MARGIN_SLACK_MM` do schema (se conflitar, ajusta a margem para caber) |
| `w:sectPr/w:pgMar/@w:footer` | `footer.heightMm` | Idem |
| `styles.xml` estilo `Normal` `w:rPr` | `body` | `w:rFonts/@w:ascii` → resolvido via `theme1.xml` se `+mn-lt` → fonts.ts pesquisa preset; `w:sz` (half-points) / 2 → `fontSizePt`; `w:color/@w:val` → `#RRGGBB` |
| `styles.xml` estilo `Heading1..3` | `headings.h1..h3` | `w:b` presente → `bold: true`; `w:sz/2` → `fontSizePt`; cor idem |
| `styles.xml` linha do parágrafo (`w:spacing/@w:line`) | `body.lineHeight` | Line rule `auto`: divide por 240. `atLeast/exact`: converte para múltiplo do fontSizePt |
| `header{N}.xml` parágrafo com texto | `header.zones[align].elements[]` (text) | Alinhamento vem de `w:jc` (left/center/right/both→left). Cor/tamanho/bold do run |
| `header{N}.xml` `w:drawing` com `a:blip/@r:embed` | `header.zones[align].elements[]` (image) | Resolve `rId` em `_rels/header{N}.xml.rels` → arquivo mídia → upload via assetRepo → `assetId`. `heightMm` de `wp:extent/@cy` (EMU) / 36000 |
| `theme1.xml` `a:clrScheme` | (usado durante resolução) | Referências `w:themeColor="accent1"` viram RGB via schema. Sem theme: default #000 |
| `theme1.xml` `a:fontScheme` | (usado durante resolução) | `+mn-lt` = minor Latin (corpo), `+mj-lt` = major Latin (títulos) |
| `fontTable.xml` | `fonts.detected` (só metadata) | Lista de fontes vistas; útil para o warning e para o `presetMatches` |
| Primeira página do header (`w:titlePg`) | `cover.applyHeader/applyFooter` | Se `w:titlePg` presente e `header2.xml` = first-page header não-vazio → provavelmente há capa. Heurística conservadora: só marca `cover.enabled=true` se há **imagem + texto grande** no `header2` E o body começa numa page-break. Senão, warning `POSSIBLE_COVER_IGNORED` |
| `docProps/core.xml` `<dc:title>` | `template.name` | Fallback: nome do arquivo sem extensão |

**Zonas do header/footer.** Word não tem "3 zonas" — usa `w:jc` (justify)
por parágrafo, `w:ptab` (tab stops) ou tabelas de 1×3. Regras:
- 1 tabela `w:tbl` de 1 linha × 3 colunas dentro do header → cada célula
  vira uma zona (`left/center/right`).
- Parágrafos separados com `w:jc` diferentes → cada um cai na sua zona.
- Um parágrafo só sem `w:jc` → zona `center` (default do Word) ou
  `left` se detectarmos indentação zero explícita.

### 4.5 Warnings

Todo warning tem `code` (enum string) e `message` (human, em pt-BR).
Códigos previstos:

| Code | Quando |
|---|---|
| `EMF_NOT_SUPPORTED` | Imagem `.emf`/`.wmf` no header/footer. Sugere substituição |
| `UNKNOWN_PAGE_SIZE` | `w:pgSz` não bate com A4 nem Letter. Fallback A4 |
| `MULTIPLE_SECTIONS` | Docx tem >1 seção com layouts distintos; só a primeira foi usada |
| `FONT_NOT_MATCHED` | Fonte detectada não bateu com preset nem com fonts uploadadas. Fallback = default preset |
| `POSSIBLE_COVER_IGNORED` | Heurística de capa não convenceu; capa fica desligada |
| `HEADER_HAS_TABLE_STYLE` | Tabela dentro do header tem estilo custom que ignoramos |
| `EVEN_PAGE_HEADER_IGNORED` | Docx tem header de páginas pares distinto do default; ignorado |
| `THEME_COLOR_FALLBACK` | Cor de tema não resolvida (arquivo theme malformado); usou #000 |

Warnings **nunca** quebram a resposta — o template é sempre entregue.
São informação para o agente/usuário decidir se ajusta.

### 4.6 Bibliotecas novas

- `pizzip` (~50KB): unzip síncrono do docx. Já é dependência transitiva
  de `docxtemplater` — provavelmente já cabe.
- `fast-xml-parser` (~100KB): parser de XML puro-JS, sem `libxml2`. Zero
  dependência nativa (o que combina com o Node 22 puro do projeto).
- **Não** vamos usar `mammoth`: ele foca em converter para HTML e joga
  fora quase toda a informação de layout que precisamos.

Total: ~2 dependências, ambas puro JS. `npm install` continua rápido.

---

## 5. Integração MCP

O README já menciona:
> Os botões **"Copiar OpenAPI"** no editor e na lista de templates já
> geram um spec OpenAPI 3.0.3 com `output` fixado em `"path"`, pronto
> para virar tool MCP.

Vamos:
1. Estender o gerador de OpenAPI para incluir `analyze-docx` e
   `from-docx` como paths, com `multipart/form-data` bem descrito
   (schema do `DocxAnalysis` inline; content-type do upload).
2. Adicionar um segundo botão na lista de templates: **"Copiar OpenAPI
   (importar do Word)"** — spec reduzido só com os 2 endpoints novos +
   `POST /api/assets`, para agentes que só querem importar.

A sua ferramenta OpenAPI→MCP pega isso pronto. Zero código MCP no
md2pdf; a fronteira continua REST.

Fluxo típico do agente:
```
1. Agente recebe do usuário:  "importa esse docx e converte esse .md"
2. tool `postTemplatesFromDocx({file}) → { template.id, warnings }`
3. (opcional) agente mostra warnings ao usuário
4. tool `postConvert({templateId, markdown, output: 'path'}) → { path }`
5. Agente devolve o caminho do PDF
```

---

## 6. UX no editor (fase posterior)

Na `TemplateList`: botão **"Importar de .docx"**. Multipart para
`from-docx`, ao terminar navega para `TemplateEditor` do template
gerado com um **banner** listando as warnings clicáveis (cada uma leva
para a seção afetada — margem, header, capa, etc.).

Se o usuário abrir o editor e clicar "Reimportar", oferecemos
`analyze-docx` com diff visual entre o template atual e o que sairia
de novo — mas isso é fase 3+.

---

## 7. Estratégia de testes

Fixtures em `tests/fixtures/docx/`. Começamos com **três**:

1. `bionexo-requisitos.docx` — o `.docx` já no repo (renomeado, sem
   espaços). Documento real, complexo, com EMF e cabeçalho com logo.
2. `minimal.docx` — 1 header simples com texto, 1 footer com página
   X/Y, sem imagem. Sanity check.
3. `cover.docx` — primeira página distinta (título grande + logo
   centralizado). Verifica a heurística de capa.

Cada teste faz o roundtrip:
```
docx bytes → analyze() → assertions em cada campo
docx bytes → toTemplate() → TemplateInputSchema.parse() (não pode falhar)
docx bytes → toTemplate() → renderTemplate() → PDF por Chromium
                                                → pdfjs-dist lê headers/footers
                                                → assertion: bate com o docx
```

O último passo reusa a infra já existente em `tests/` (README:
"testes que abrem o PDF gerado com pdfjs-dist"). O ganho é grande:
mudanças no schema ou no render quebram teste de import junto.

Unit tests em cada módulo `src/docx/*.ts` com XMLs mínimos inline como
fixture — mantém os testes rápidos e específicos.

---

## 8. Rollout em fases

**Fase 0 — Spike (1 dia).** Escrever `analyze.ts` bare-bones que roda
sobre `bionexo-requisitos.docx` e imprime o `DocxAnalysis`. Objetivo:
confirmar que os 4 XMLs (document, styles, theme, header1) dão tudo
que a tabela §4.4 promete. Se não der, este design volta para
brainstorm. Código é throwaway.

**Fase 1 — Módulos puros + analyze-docx (3-5 dias).** Toda a pasta
`src/docx/`, com testes unitários. Endpoint `analyze-docx`. Uploads de
imagem via assetRepo. Nada persiste template ainda.

**Fase 2 — Mapeador + from-docx (2-3 dias).** `toTemplate.ts` com a
tabela §4.4 traduzida em código. Endpoint `from-docx`. Teste
end-to-end: docx → PDF renderizado.

**Fase 3 — OpenAPI + MCP (1 dia).** Gerador de OpenAPI cobre os 2 novos
endpoints. Botão "Copiar OpenAPI (importar)" na `TemplateList`.
Documentação no README seção "Importando do Word".

**Fase 4 — Editor UX (2-3 dias).** Botão "Importar de .docx" na
`TemplateList`, banner de warnings no editor.

**Fase 5 — Heurística de capa refinada (aberta).** Só depois de rodar em
docs reais e ver onde a heurística conservadora frustra o usuário.

Total até fase 3 (o essencial para o seu fluxo MCP): **~1.5 semanas**
de trabalho focado.

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Docx real usa OLE object (`oleObject1.bin` no bionexo) que carrega EMF | Warning `EMF_NOT_SUPPORTED` já cobre; docx com só EMF vira template sem logo, mas funcional |
| Fonte proprietária (Bionexo Sans, Segoe UI Variable) | Preset best-match + warning; usuário sobe .ttf via `/api/fonts` se quiser fidelidade |
| Theme referenciando cores por acento não resolve | Fallback #000 + warning `THEME_COLOR_FALLBACK`; usuário edita no editor |
| Docx de fornecedor mudou versão do Word e quebra parser | Testes com fixtures reais garantem regressão; adicionar novo docx que quebrou como fixture |
| Multipart de docx grande estoura memória | Fastify já tem `attachFieldsToBody` config; limitar a 20MB e responder 413 |

---

## 10. Perguntas em aberto (não bloqueiam começar)

Nenhuma dessas impede a Fase 0-2; só precisam estar decididas antes da
Fase 3.

1. **Persistência do docx original.** Guardar o `.docx` fonte junto do
   template (para reimportação futura)? Custa storage mas habilita
   "reimportar sobre alterações do docx original".
2. **`from-docx` deve retornar 201 ou 200?** 201 é ortodoxo (criou
   recurso), mas os outros POSTs do projeto retornam 200. Manter
   consistência.
3. **Rate-limit.** Analyze roda parser XML pesado; se agente entrar em
   loop, come CPU. Talvez um limite simples por IP na Fase 1.
4. **Assets órfãos.** Se `from-docx` uploadar imagens e o template for
   deletado, quem limpa os assets? Já existe esse problema no
   fluxo normal (deletar template não deleta assets). Seguir política
   atual e não introduzir divergência.

---

## 11. Próximos passos

Depois da sua aprovação deste spec:

1. Rodar o skill `superpowers:writing-plans` para transformar as
   fases §8 num plano executável com tasks discretas.
2. Executar a Fase 0 (spike) antes de comprometer com o resto do
   plano — se a extração de fatos do docx real não confirmar a tabela
   §4.4, este spec volta ao brainstorm.
3. Fases 1-3 numa branch dedicada (`feat/docx-import`), integrando via
   PR ao main quando o teste end-to-end passar sobre os 3 fixtures.
