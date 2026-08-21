// GC de assets órfãos: apaga arquivos em storage/assets/ que nenhum template
// em storage/templates/ referencia.
//
// Uso:
//   node scripts/gc-orphan-assets.mjs            # dry-run (só lista)
//   node scripts/gc-orphan-assets.mjs --apply    # apaga
//
// Usar MD2PDF_STORAGE=/caminho para apontar pra outro diretório de dados.

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = process.env.MD2PDF_STORAGE ?? path.resolve(process.cwd(), 'storage');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const ASSETS_DIR = path.join(ROOT, 'assets');

function readTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter((f) => f.startsWith('tpl_') && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')));
}

function referencedAssetIds(templates) {
  const ids = new Set();
  for (const t of templates) {
    for (const zone of ['header', 'footer', 'cover']) {
      for (const el of t[zone]?.elements ?? []) {
        if (el.type === 'image' && typeof el.assetId === 'string') ids.add(el.assetId);
      }
    }
  }
  return ids;
}

function assetsOnDisk() {
  if (!fs.existsSync(ASSETS_DIR)) return new Map();
  // Agrupa por asset id — cada asset tem <id>.meta.json + <id>.<ext>.
  const groups = new Map();
  for (const entry of fs.readdirSync(ASSETS_DIR)) {
    const m = entry.match(/^(ast_[A-Za-z0-9_-]+)\./);
    if (!m) continue;
    const id = m[1];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

const templates = readTemplates();
const referenced = referencedAssetIds(templates);
const assets = assetsOnDisk();

const orphans = [...assets.keys()].filter((id) => !referenced.has(id));

console.log(`storage:    ${ROOT}`);
console.log(`templates:  ${templates.length}`);
console.log(`assets:     ${assets.size}`);
console.log(`referenced: ${referenced.size}`);
console.log(`orphans:    ${orphans.length}`);

if (orphans.length === 0) {
  console.log('nada a fazer.');
  process.exit(0);
}

for (const id of orphans) {
  const files = assets.get(id);
  console.log(`  ${APPLY ? 'DELETE' : 'would delete'} ${id} (${files.join(', ')})`);
  if (APPLY) {
    for (const f of files) fs.unlinkSync(path.join(ASSETS_DIR, f));
  }
}

if (!APPLY) console.log('\ndry-run — rode com --apply pra remover de fato.');
