import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  parseAttributeValue: false,
});

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function findKey(node: unknown, name: string, prefix: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (!key.startsWith(prefix)) continue;
    if (localName(key.slice(prefix.length)).toLowerCase() === target) return key;
  }
  return undefined;
}

export function pick(node: unknown, name: string): any {
  const key = findKey(node, name, '');
  if (!key) return undefined;
  const value = (node as any)[key];
  return Array.isArray(value) ? value[0] : value;
}

export function pickAll(node: unknown, name: string): any[] {
  const key = findKey(node, name, '');
  if (!key) return [];
  const value = (node as any)[key];
  return Array.isArray(value) ? value : [value];
}

export function attr(node: unknown, name: string): string | undefined {
  const key = findKey(node, name, '@_');
  if (!key) return undefined;
  const value = (node as any)[key];
  return value == null ? undefined : String(value);
}
