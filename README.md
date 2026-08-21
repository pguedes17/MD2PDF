<div align="center">

# MD2PDF

**API que converte Markdown em PDF aplicando um template salvo** — cabeçalho, rodapé,
margens e numeração em todas as páginas.

Você monta o papel timbrado uma vez num editor visual, copia o id dele, e a partir
daí uma única chamada converte qualquer Markdown com aquela identidade visual.

</div>

---

## Sumário

- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Rodando](#rodando)
- [Convertendo](#convertendo)
- [Quebra de página](#quebra-de-página)
- [Endpoints](#endpoints)
- [O template](#o-template)
- [Como está montado](#como-está-montado)
- [Importando do Word](#importando-do-word)
- [Segurança](#segurança)
- [Configuração](#configuração)
- [Testes](#testes)
- [Deploy](#deploy)
- [Problemas comuns](#problemas-comuns)

---

## Requisitos

| | Versão | Observação |
|---|---|---|
| **Node.js** | **22 LTS ou superior** | O projeto usa `type: module` e top-level `await`. Testado no 22.21.0 |
| **npm** | 10 ou superior | Vem junto com o Node 22 |
| **Chromium** | baixado automaticamente | ~300 MB, instalado pelo Playwright no `npm install` |
| Sistema | Windows, macOS ou Linux | Em Linux servidor, veja [Deploy](#deploy) |

Confira o que você tem:

```bash
node --version   # precisa ser v22.x ou maior
npm --version
```

Se precisar instalar ou trocar de versão, use o [nvm](https://github.com/nvm-sh/nvm)
(`nvm install 22 && nvm use 22`) ou o [nvm-windows](https://github.com/coreybutler/nvm-windows).

---

## Instalação

```bash
git clone https://github.com/pguedes17/md2pdf.git
cd md2pdf

npm install   # dependências da API e do editor + baixa o Chromium
```

Um comando só: o `postinstall` baixa o Chromium usado para imprimir e instala as
dependências do editor.
São cerca de 300 MB na primeira vez. Se ele falhar (proxy, rede), rode manualmente:

```bash
npx playwright install chromium
```

Nada mais precisa ser configurado: não há banco de dados. Os templates viram
arquivos JSON e as imagens ficam em disco, dentro de `./storage`, criado sozinho
no primeiro uso.

---

## Rodando

### Desenvolvimento

Dois processos, em terminais separados:

```bash
npm run dev       # API em http://localhost:3000, com reload
npm run dev:web   # editor em http://localhost:5173, com HMR
```

Abra **http://localhost:5173**. O Vite encaminha as chamadas `/api/*` para a porta
3000 sozinho.

### Produção (um processo só)

```bash
npm start   # compila o editor e sobe tudo em http://localhost:3000
```

O `npm start` roda o build do editor antes de subir, e o próprio servidor serve
os arquivos compilados — em produção é um processo e uma porta.

Se preferir separar as etapas (num Dockerfile, por exemplo):

```bash
npm run build:web        # compila o editor em web/dist
npx tsx src/server.ts    # sobe sem rebuildar
```

> Os arquivos do editor (`web/dist`) são gerados no build e não vêm no
> repositório. Se você subir o servidor sem eles, a raiz responde uma página
> dizendo exatamente isso — a API continua funcionando normalmente.

### Scripts disponíveis

| Script | O que faz |
|--------|-----------|
| `npm run dev` | API com reload automático |
| `npm start` | Compila o editor e sobe a API servindo tudo junto |
| `npm run dev:web` | Editor com HMR (porta 5173) |
| `npm run build:web` | Compila o editor para `web/dist` |
| `npm run setup:web` | Instala só as dependências do editor |
| `npm run build` | Checagem de tipos da API (sem emitir arquivos) |
| `npm test` | Suíte completa |
| `npm run test:watch` | Testes em modo watch |

---

## Convertendo

```bash
curl -X POST http://localhost:3000/api/convert \
  -H "content-type: application/json" \
  -d '{
        "templateId": "tpl_SxDtnui3k9ru",
        "markdown": "# Contrato\n\nTexto...\n\n<!-- pagebreak -->\n\n# Anexo A",
        "variables": { "numero": "2026/0413" },
        "filename": "contrato.pdf"
      }' \
  --output contrato.pdf
```

Resposta padrão: `application/pdf` binário, com `Content-Disposition: attachment`.

Mandando `accept: application/json`, vem o PDF em base64 junto dos metadados:

```json
{
  "filename": "contrato.pdf",
  "templateId": "tpl_SxDtnui3k9ru",
  "pages": 3,
  "bytes": 63024,
  "pdfBase64": "JVBERi0..."
}
```

### Em Node

```js
const response = await fetch('http://localhost:3000/api/convert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ templateId: 'tpl_…', markdown: '# Olá' }),
});
const pdf = Buffer.from(await response.arrayBuffer());
```

### Campos do request

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `markdown` | sim | O conteúdo. Não pode ser vazio |
| `templateId` | sim | O id copiado do editor |
| `variables` | não | Preenche os `{{placeholders}}` do cabeçalho e do rodapé |
| `filename` | não | Nome sugerido no download. O padrão é o nome do template |
| `output` | não | `binary` (default), `base64` ou `path` — veja abaixo |

### Modo `output: "path"` (pensado para tools MCP)

Devolve JSON com o **caminho absoluto** de um PDF já gravado em disco no host
da API, evitando trafegar binário/base64:

```bash
curl -X POST http://localhost:3000/api/convert \
  -H "content-type: application/json" \
  -d '{ "templateId": "tpl_...", "markdown": "# Doc", "output": "path" }'
```

```json
{
  "path": "C:/.../storage/outputs/contrato-20260819T143012-a1b2c3.pdf",
  "filename": "contrato-20260819T143012-a1b2c3.pdf",
  "templateId": "tpl_...",
  "pages": 1,
  "bytes": 4123
}
```

O arquivo cai em `MD2PDF_OUTPUT_DIR` (default `./storage/outputs`). O servidor
roda um scheduler que apaga automaticamente os PDFs mais antigos que
`MD2PDF_OUTPUT_TTL_MS` (default 24 h), varrendo a pasta a cada
`MD2PDF_OUTPUT_CLEANUP_INTERVAL_MS` (default 1 h). Uma varredura extra roda na
subida do servidor. Definir qualquer um desses valores como `0` desliga a
limpeza automática.

O botão **"Copiar OpenAPI"** no header da lista de templates copia um único
spec OpenAPI 3.0.3 com TODAS as operations que viram tools MCP: importar
docx, listar templates, ler detalhes de um template e converter markdown.
Cole em OAS2MCP (ou equivalente) uma vez só; funciona com qualquer template.

---

## Quebra de página

O conteúdo flui e quebra sozinho quando enche a página. Para forçar uma quebra,
escreva no Markdown:

```markdown
<!-- pagebreak -->
```

Além disso o CSS gerado já cuida do que costuma sair feio:

- título nunca fica órfão no pé da página;
- tabela, imagem e bloco de código não partem no meio quando cabem inteiros na
  página seguinte;
- o `<thead>` se repete quando uma tabela atravessa páginas.

---

## Endpoints

| Método | Rota | O que faz |
|--------|------|-----------|
| `POST` | `/api/convert` | **Markdown + templateId → PDF** |
| `GET` | `/api/templates` | Lista os templates |
| `POST` | `/api/templates` | Cria |
| `GET` | `/api/templates/:id` | Lê |
| `PUT` | `/api/templates/:id` | Atualiza |
| `DELETE` | `/api/templates/:id` | Remove |
| `POST` | `/api/templates/:id/preview` | PDF de exemplo do template |
| `POST` | `/api/assets` | Upload de imagem (multipart, campo `file`) |
| `GET` | `/api/assets/:id` | Serve a imagem |
| `DELETE` | `/api/assets/:id` | Remove a imagem |
| `POST` | `/api/fonts` | Upload de fonte customizada (.ttf/.otf) |
| `GET` | `/api/fonts` | Lista as fontes |
| `GET` | `/api/fonts/:id` | Serve o binário da fonte |
| `DELETE` | `/api/fonts/:id` | Remove (erro 409 se referenciada por template) |
| `POST` | `/api/templates/analyze-docx` | Analisa um .docx e devolve os fatos + warnings, sem criar template |
| `POST` | `/api/templates/from-docx` | Analisa um .docx e cria o template automaticamente |
| `GET` | `/health` | Sinal de vida |

Erros vêm sempre no mesmo formato:

```json
{ "error": "validation_failed", "message": "validação falhou",
  "issues": [{ "path": "page.margins.top", "message": "..." }] }
```

| Status | Quando |
|--------|--------|
| `400` | Validação, id malformado, markdown vazio |
| `404` | Template ou asset inexistente |
| `422` | O template aponta para uma imagem que foi apagada |
| `500` | Falha na impressão (com `requestId` no log) |

---

## O template

Cabeçalho e rodapé têm três zonas — esquerda, centro, direita. Em cada zona você
põe elementos:

| Tipo | Para quê |
|------|----------|
| `image` | logo, enviada via `/api/assets` |
| `text` | texto fixo; aceita `{{variavel}}`, resolvida na conversão |
| `pageNumber` | `{page}` e `{total}`, preenchidos página a página |
| `date` | data do momento da conversão |

```json
{
  "name": "Contrato de Transporte",
  "page": { "format": "A4", "orientation": "portrait",
            "margins": { "top": 34, "right": 20, "bottom": 24, "left": 20 } },
  "header": { "heightMm": 24, "zones": {
    "left":  [{ "type": "image", "assetId": "ast_...", "heightMm": 11 }],
    "center": [],
    "right": [{ "type": "text", "value": "Contrato {{numero}}" }] }},
  "footer": { "heightMm": 14, "zones": {
    "left":  [{ "type": "text", "value": "Documento confidencial" }],
    "center": [],
    "right": [{ "type": "pageNumber", "format": "Página {page} de {total}" }] }}
}
```

> **A margem precisa acomodar a faixa.** `margins.top` tem que ser pelo menos
> `header.heightMm + 5`, e o mesmo vale para o rodapé. Sem isso o Chromium corta a
> faixa **sem avisar** — então o schema recusa, e o editor desenha o conflito na
> folha em vez de só mostrar uma mensagem.

### Capa (opcional)

Quando `cover.enabled` é `true`, o template gera uma primeira página customizada com
layout completamente livre. Elementos (texto, imagem, data) são posicionados por
coordenadas absolutas em milímetros, sem hierarquia de fluxo. Suporta `{{variáveis}}`
resolvidas na conversão.

O checkbox "aplicar header/footer na capa" controla se a faixa de cabeçalho/rodapé
aparece na página 1. Quando desligado (padrão), a capa é gerada como PDF separado e
concatenada ao documento — a numeração `{page}/{total}` do rodapé começa em `1/N` a
partir da página 2 (primeira página do conteúdo).

### Fonte

`body.font.family` escolhe uma fonte web-safe da lista curada de presets. Para fontes
customizadas, use `body.font.customFontId` referenciando um upload feito via
`POST /api/fonts`. Fontes customizadas são automaticamente embutidas no PDF como
`@font-face` com encapsulamento base64, sem dependências externas.

### Cabeçalhos

`headings.h1`, `headings.h2` e `headings.h3` configuram independentemente cor, negrito
e tamanho para cada nível. Os níveis h4, h5 e h6 herdam o estilo de h3 automaticamente.

---

## Como está montado

```
src/
  config.ts              porta, caminhos, limites
  domain/template.ts     schema Zod — a fonte da verdade do formato
  conversion.ts          costura storage + render + Chromium
  render/
    markdown.ts          markdown-it + sanitize-html + <!-- pagebreak -->
    template.ts          Template → headerHtml/footerHtml/css   ← COMPARTILHADO
    pdf.ts               Chromium sempre vivo, com fila e timeout
    pdfInfo.ts           contagem de páginas do PDF pronto
  storage/               um JSON por template, imagens em disco
  routes/                templates, assets, convert
web/                     editor visual (React + Vite)
tests/                   unitários + integração (gera PDF de verdade)
```

**`render/template.ts` é o centro do projeto.** Ela é uma função pura: não importa
`fs`, nem Playwright, nem Fastify. Por isso o editor no browser importa exatamente
o mesmo módulo que o servidor usa para imprimir — o preview bate com o PDF porque
é o mesmo código, não uma segunda implementação do layout.

### Bibliotecas

| Pacote | Papel |
|--------|-------|
| `fastify` | servidor HTTP |
| `playwright` | Chromium headless que imprime |
| `markdown-it` | Markdown → HTML |
| `sanitize-html` | limpeza do HTML gerado |
| `zod` | schema e validação |
| `react` + `vite` | editor visual |
| `vitest` + `pdfjs-dist` | testes que abrem o PDF gerado |

---

## Importando do Word

Quando você já tem um `.docx` com o papel timbrado da empresa, o md2pdf
consegue extrair o template automaticamente:

```bash
curl -X POST http://localhost:3000/api/templates/from-docx?name=Bionexo \
  -F "file=@meu-timbrado.docx"
```

A resposta traz:

```json
{
  "template": { "id": "tpl_abc...", "name": "Bionexo", "...": "..." },
  "warnings": [
    { "code": "EMF_NOT_SUPPORTED", "message": "word/media/image1.emf é EMF; ..." }
  ],
  "assetIds": ["ast_..."]
}
```

Guarde o `template.id` e use como qualquer template criado à mão:

```bash
curl -X POST http://localhost:3000/api/convert \
  -H "content-type: application/json" \
  -d '{"templateId":"tpl_abc...","markdown":"# Doc","output":"path"}'
```

### O que é importado

- Formato e orientação da página (A4/Letter, portrait/landscape)
- Margens
- Cabeçalho e rodapé da seção default (texto, alinhamento, tipografia, logo)
- Fonte, tamanho, cor e altura de linha do corpo (via estilo `Normal`)
- Estilos de `Heading 1/2/3` (cor, negrito, tamanho)
- Imagens PNG/JPG/SVG/GIF/WebP embutidas nos cabeçalhos/rodapés

### O que **não** é importado

- Corpo do documento (isso vem do markdown que você envia depois)
- Tabelas de estilo, numeração automática, campos, sumário
- Imagens EMF/WMF (não renderizam em Chromium — vira warning)
- Capa personalizada (a heurística é conservadora; edite depois se quiser)

### Usando via MCP

O botão **"Copiar OpenAPI"** no header da lista de templates copia um
único spec OpenAPI 3.0.3 com quatro operações:

1. `importTemplateFromDocx` — recebe o `.docx`, devolve `template.id`
2. `listTemplates` — lista os templates existentes (id, nome, timestamps)
3. `getTemplate` — detalhes de um template (o agente inspeciona para descobrir `{{variáveis}}`)
4. `convertWithTemplate` — recebe `templateId` + markdown (+ variables), devolve o path do PDF

Cole em qualquer ferramenta OpenAPI→MCP (OAS2MCP e similares) uma vez só —
funciona com qualquer template criado, agora e no futuro. Agentes (Claude,
Copilot, Cursor) fazem o fluxo completo: "crie um template do docx X e
depois converta o markdown Y com ele".

### Analisar sem persistir

Se você quer inspecionar o que seria importado antes de criar o template:

```bash
curl -X POST http://localhost:3000/api/templates/analyze-docx \
  -F "file=@meu.docx"
```

Devolve o mesmo `{ analysis, warnings }` sem criar template no disco.

---

## Segurança

O Markdown vem de fora, então o pipeline trata a entrada como não confiável:

- HTML cru desligado no parser, e `sanitize-html` por cima como segunda camada;
- JavaScript **desligado** na página do Chromium;
- recurso externo bloqueado por padrão — uma `<img src="http://...">` no Markdown
  não faz o servidor alcançar a rede interna;
- ids validados por formato antes de virarem caminho de arquivo.

**Não há autenticação no MVP.** Antes de expor isso na internet, coloque a API
atrás de um proxy autenticado ou de uma rede privada.

---

## Configuração

Tudo por variável de ambiente, nenhuma obrigatória:

| Variável | Padrão | O que muda |
|----------|--------|------------|
| `PORT` | `3000` | Porta da API |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `MD2PDF_STORAGE` | `./storage` | Onde ficam templates e imagens |
| `MD2PDF_OUTPUT_DIR` | `./storage/outputs` | PDFs gerados no modo `output: "path"` |
| `MD2PDF_OUTPUT_TTL_MS` | `86400000` (24 h) | Idade máxima dos PDFs em `MD2PDF_OUTPUT_DIR`; `0` desliga a limpeza |
| `MD2PDF_OUTPUT_CLEANUP_INTERVAL_MS` | `3600000` (1 h) | Frequência da varredura de limpeza; `0` desliga a limpeza |
| `MAX_CONCURRENT` | `4` | Conversões simultâneas |
| `CONVERSION_TIMEOUT_MS` | `30000` | Teto por conversão |

---

## Testes

```bash
npm test
```

Os testes de PDF não checam só que "gerou algo": eles **geram documentos de
verdade e os abrem com `pdfjs-dist`**, conferindo o número de páginas, o
cabeçalho e o rodapé em cada página, e a paginação fechando certo (`3 de 3` na
última).

---

## Deploy

Em Linux, o Chromium precisa de algumas bibliotecas de sistema:

```bash
npx playwright install --with-deps chromium
```

Em Docker, parta de uma imagem que já traz tudo:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run setup:web && npm run build:web
ENV MD2PDF_STORAGE=/data
VOLUME /data
EXPOSE 3000
# build já feito acima; sobe direto, sem recompilar a cada container
CMD ["npx", "tsx", "src/server.ts"]
```

Monte um volume em `/data`: é lá que ficam os templates e as imagens. Sem volume,
tudo se perde quando o container reinicia.

---

## Problemas comuns

**A logo não aparece no PDF.**
Confira se o `assetId` do template ainda existe em `/api/assets/:id`. Se foi
apagado, a conversão devolve `422`. Imagens sempre são embutidas como `data:` URI
— URL externa não funciona dentro de cabeçalho e rodapé no Chromium.

**O cabeçalho aparece cortado.**
A margem é menor que a faixa. Aumente `margins.top` para pelo menos
`header.heightMm + 5`, ou use o botão "Ajustar a margem" no editor.

**`browserType.launch: Executable doesn't exist`.**
O Chromium não foi baixado. Rode `npx playwright install chromium`.

**Conversão devolvendo timeout.**
Documento muito grande ou markdown patológico. Aumente `CONVERSION_TIMEOUT_MS`.

**A raiz responde "editor não compilado".**
Os arquivos do editor não vêm no repositório. Rode `npm run build:web` (ou
simplesmente `npm start`, que já faz isso).

**Uma imagem no Markdown não carrega.**
Recurso externo é bloqueado de propósito. Embuta a imagem como `data:` URI dentro
do próprio Markdown.
