# Editor: posicionamento livre de elementos em cabeçalho e rodapé

**Status:** aprovado, aguardando plano de implementação
**Data:** 2026-08-19

## Motivação

O editor atual divide cabeçalho e rodapé em três zonas fixas (esquerda/centro/direita), o que impede casos legítimos como "dois elementos empilhados verticalmente no lado direito do cabeçalho". A UX de zonas também soa como uma limitação artificial para quem espera arrastar elementos livremente numa folha.

Este spec troca o modelo por posicionamento livre com **âncora horizontal + offset**, preservando o conceito de alinhamento (que sobrevive a mudanças de margem) e ganhando arrasto direto e empilhamento vertical.

## Modelo de dados

### Novo shape de elemento

Cada `TemplateElement` ganha três campos, todos com default:

```ts
align:      'left' | 'center' | 'right'    // default: 'left'
xOffsetMm:  number  // -200..200            // default: 0 (deslocamento a partir da âncora)
yMm:        number  //    0..60             // default: 0 (do topo da faixa)
```

Semântica:
- `align` é a âncora horizontal do elemento dentro da **área útil** da faixa (entre as margens laterais da página).
- `xOffsetMm` desloca a partir dessa âncora. Positivo puxa para dentro da folha (para `right` isso significa afastar-se da borda direita). Negativo puxa para fora.
- `yMm` é a distância do topo da faixa, absoluta.

### Novo shape de faixa

`BandSchema` deixa de ter `zones`:

```ts
{ heightMm: number, elements: TemplateElement[] }
```

`ZONE_NAMES` e `ZoneName` são removidos do domínio.

### Regra de sanidade (superRefine)

Para elementos com texto (`fontSizePt`), a altura estimada é `fontSizePt × 0.353 × 1.2` mm. Para imagens, é `heightMm`. Para `date` e `pageNumber`, mesma fórmula do texto.

Falha quando `yMm + alturaEstimada > band.heightMm` — o Chromium cortaria em silêncio. A mensagem aponta para `header.elements[i].yMm` ou `footer.elements[i].yMm`.

### Template inicial

`makeBlankTemplateInput` continua criando um footer com um `pageNumber` no canto direito — apenas com o novo shape: `{ type: 'pageNumber', align: 'right', xOffsetMm: 0, yMm: 0, format: '{page} / {total}' }`.

## Migração de templates persistidos

O schema aceita **apenas o formato novo** (com `elements`). A responsabilidade de aceitar o formato antigo (`zones`) fica **isolada no repo**.

`src/storage/templateRepo.ts` ganha `migrateTemplateJson(raw)`:

1. Se `band.elements` já existe, retorna sem tocar.
2. Se `band.zones` existe, achata na ordem `left → center → right`, atribuindo:
   - `zones.left[i]`   → `{ ...el, align: 'left',   xOffsetMm: 0, yMm: 0 }`
   - `zones.center[i]` → `{ ...el, align: 'center', xOffsetMm: 0, yMm: 0 }`
   - `zones.right[i]`  → `{ ...el, align: 'right',  xOffsetMm: 0, yMm: 0 }`
3. Remove a chave `zones` e escreve `elements`.
4. Persiste de volta no disco (self-healing na primeira leitura).

Só o repo conhece o formato antigo. Rotas, editor e renderer só lidam com o novo.

## Renderização (`src/render/template.ts`)

### Estrutura HTML

O renderer emite, para cada faixa:

```html
<div class="band" style="position: relative; box-sizing: border-box;
                         width: 100%; height: <heightMm>mm;
                         padding: 0 <marginRight>mm 0 <marginLeft>mm;
                         font-family: ...; font-size: 9pt;
                         line-height: 1.2;
                         -webkit-print-color-adjust: exact;
                         print-color-adjust: exact;">
  <div style="position: absolute; <regra-de-âncora>; top: <yMm>mm;">
    <!-- HTML do elemento (mesmo helper de hoje) -->
  </div>
  ...
</div>
```

### Função pura `elementPosition`

Extraída de `bandHtml` e exportada para reuso no frontend:

```ts
elementPosition(el: { align, xOffsetMm, yMm }): {
  top: string;
  left?: string;
  right?: string;
  transform?: string;
}
```

Regras:
- `align === 'left'`:   `{ top: '<y>mm', left: '<x>mm' }`  (offset positivo empurra para a direita, para dentro da folha)
- `align === 'right'`:  `{ top: '<y>mm', right: '<x>mm' }` (offset positivo empurra para a esquerda, para dentro da folha — em CSS, `right: 5mm` deixa o elemento 5mm afastado da borda direita)
- `align === 'center'`: `{ top: '<y>mm', left: 'calc(50% + <x>mm)', transform: 'translateX(-50%)' }` (offset positivo empurra para a direita)

Convenção uniforme: **`xOffsetMm` positivo sempre puxa o elemento para dentro da folha** (para longe da borda de âncora, no caso de `left` e `right`; para a direita, no caso de `center`). Isso deixa o botão "seta para a direita = mais offset" intuitivo, exceto no centro onde a direção é fixa.

O padding lateral da `.band` continua sendo `page.margins.{left,right}` (comportamento atual). As coordenadas dos elementos são relativas à **área útil**, não à página inteira — assim `align='left', xOffsetMm=0` fica exatamente na margem esquerda, como já fica hoje.

### Ordem e sobreposição

Ordem de renderização = ordem no array. Sem `z-index` explícito — quem vem depois fica por cima. Elementos empilhados via `yMm` diferentes nem tocam nisso.

### Risco Chromium: `transform: translateX(-50%)`

Chromium em `headerTemplate`/`footerTemplate` aceita `position: absolute`, mas pode causar sub-pixel blur em texto centralizado via `transform`. **Primeira tentativa: `transform`.** Se o preview sair borrado, o fallback é gerar `left: <calculatedLeftMm>mm` medindo a largura via `<span>` invisível — abordagem mais complexa, evitada até prova de necessidade.

## Editor (frontend)

### Painel esquerdo (`PageSettings`)

Inalterado. Formato de página, margens, altura das faixas, corpo.

### Faixa na folha (`Sheet.tsx`)

- Some as três divisórias tracejadas e o conceito visual de "zona".
- Cada faixa vira uma superfície única. Clique no fundo seleciona a faixa (mostra lista de elementos no inspector). Clique num elemento seleciona o elemento.
- Cada elemento é um `<div>` posicionado por `elementPosition` (importada do backend via `@shared`), com `pointer-events: auto`, `cursor: move`, e outline de acento quando selecionado.

### Arrastar (pointer events)

- `pointerdown` no elemento → captura o pointer, guarda `origem = { clientX, clientY, xOffsetMm, yMm, align }`.
- `pointermove` → calcula `dxScreenMm = (clientX − origem.clientX) × mmPerPx` e `dyMm` análogo. **Como `xOffsetMm` positivo significa "para dentro da folha", para `align === 'right'` o delta horizontal é invertido: `dxOffsetMm = align === 'right' ? -dxScreenMm : dxScreenMm`.** `mmPerPx` sai da escala atual da folha. Atualiza estado local (não persiste até `pointerup`).
- `pointerup` → confirma via `onChange`.

`mmPerPx` é derivado de `1 / scale × mmPerCssPx`, onde `scale` já é computado pelo `useFitScale` e `mmPerCssPx = 96 / 25.4`.

### Snap horizontal

Ao arrastar, cálculo em qual "faixa de snap" o cursor está (esquerda 0–33%, centro 33–66%, direita 66–100% da área útil da faixa). Quando o cursor entra numa faixa **e o offset resultaria a ≤ 2mm da âncora canônica**, muda `align` para aquela faixa e zera `xOffsetMm`.

Efeito: quem arrasta livre continua livre. Quem quer alinhar só solta perto da âncora.

Guia visual: uma linha vertical fina, cor de acento, aparece durante o snap.

### Snap vertical

Apenas em `yMm = 0` (topo) e `yMm = band.heightMm − alturaEstimada` (base), tolerância 1mm. Nada além disso.

### Chip de posição

Durante o drag, chip pequeno próximo ao elemento com `x: <sinal><n>mm  y: <n>mm`. Desaparece ao soltar.

### Atalhos de alinhamento (inspector)

Grupo de três botões grudados: `⇤ esq.` `↔ centro` `⇥ dir.` — setam `align` e zeram `xOffsetMm`. `yMm` intacto. `yMm` e `xOffsetMm` também são editáveis por inputs numéricos.

### Teclado (elemento selecionado)

- Setas: nudge de 1mm no eixo.
- Shift + setas: nudge de 0,25mm.
- Delete / Backspace: remove.
- Esc: desseleciona.

### Inspetora

- Título: só o nome da faixa (`Cabeçalho` / `Rodapé`). Sem "zona".
- Lista dos elementos da faixa em ordem de renderização. Reordenar não é MVP.
- Seleção passa a ser `{ band: 'header' | 'footer', index: number } | null`. A noção de `zone` some.
- Bloco "posição" novo: 3 botões de âncora + inputs `x offset (mm)` e `y (mm)`.
- Botão "adicionar" cria elemento com defaults `align='left', xOffsetMm=0, yMm=0`.

## Arquivos afetados

**Backend:**
- `src/domain/template.ts` — schema, `makeBlankTemplateInput`, superRefine, remoção de `ZONE_NAMES`.
- `src/render/template.ts` — reescrita de `bandHtml`, remoção de `zoneHtml`, exportação de `elementPosition`.
- `src/storage/templateRepo.ts` — `migrateTemplateJson` + escrita self-healing.

**Frontend:**
- `web/src/lib/templateModel.ts` — novo tipo `Selection`, helpers ajustados, novo `applyDragDelta`.
- `web/src/components/Sheet.tsx` — remoção de zonas, elementos como handles arrastáveis, guia de snap.
- `web/src/components/Inspector.tsx` — sem zonas no título, bloco "posição".
- `web/src/pages/TemplateEditor.tsx` — ajuste do tipo `Selection` e da chamada ao editor de faixa.
- `web/src/styles.css` — remoção de `.slot/.slot__zone`; novos `.el-handle`, `.snap-guide`, `.pos-badge`, `.align-shortcut`.

## Testes

- `tests/render/template.test.ts` — cada âncora + offset produz o CSS correto; faixa vazia continua omitindo header; superRefine falha quando o elemento estoura a faixa.
- `tests/domain/template.test.ts` — migração `zones → elements` na ordem `left → center → right`; migração idempotente para JSON já migrado.
- Sem testes de interação de drag no frontend (não há infra de testes web hoje).

## Ordem de execução

1. Schema + migração + testes de domínio.
2. Renderer + testes (o preview do editor depende desta função pura).
3. `templateModel.ts`.
4. `Sheet.tsx` (arrasto + snap + guia).
5. `Inspector.tsx` (bloco de posição + atalhos + teclado).
6. Estilos e polimento.

## Fora de escopo

- Reordenar elementos via drag na lista.
- Snap a elementos vizinhos (magnetismo entre elementos).
- Alinhamento vertical (`valign: top | middle | bottom`).
- Rotação.
- Undo/redo.
