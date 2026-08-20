import type { ReactNode } from 'react';

/** Nome dos ícones disponíveis. Cada um é um SVG de traço no viewBox 24x24. */
export type IconName =
  | 'plus'
  | 'upload'
  | 'copy'
  | 'check'
  | 'files'
  | 'trash'
  | 'edit'
  | 'file-down'
  | 'braces'
  | 'external-link';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** Definição do miolo de cada ícone. Traço `currentColor` para herdar do botão. */
const ICONS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  files: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  'file-down': (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M12 12v6" />
      <path d="M9 15l3 3 3-3" />
    </>
  ),
  braces: (
    <>
      <path d="M8 3H6a3 3 0 0 0-3 3v3a3 3 0 0 1-3 3 3 3 0 0 1 3 3v3a3 3 0 0 0 3 3h2" />
      <path d="M16 3h2a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3 3 3 0 0 0-3 3v3a3 3 0 0 1-3 3h-2" />
    </>
  ),
  'external-link': (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
};

/**
 * Ícone SVG monocromático. `currentColor` herda a cor do botão que o contém,
 * então o mesmo ícone se adapta a botões accent/ghost/quiet/danger sem
 * precisar de variantes por classe.
 */
export function Icon({ name, size = 15, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}
