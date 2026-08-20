import PizZip from 'pizzip';

export interface DocxArchive {
  text(path: string): string | null;
  bytes(path: string): Uint8Array | null;
  list(): string[];
}

export function openDocx(buf: Buffer): DocxArchive {
  const zip = new PizZip(buf);
  return {
    text(path) {
      const f = zip.file(path);
      return f ? f.asText() : null;
    },
    bytes(path) {
      const f = zip.file(path);
      return f ? new Uint8Array(f.asBinary().split('').map((c) => c.charCodeAt(0))) : null;
    },
    list() {
      return Object.keys(zip.files);
    },
  };
}
