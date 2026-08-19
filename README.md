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
git clone https://github.com/pguedes17/MD2PDF.git
cd MD2PDF

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
