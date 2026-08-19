export interface FontPreset {
  family: string;
  label: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
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

export const DEFAULT_FONT_FAMILY = FONT_PRESETS[0]!.family;

export function isPresetFamily(family: string): boolean {
  return FONT_PRESETS.some((p) => p.family === family);
}
