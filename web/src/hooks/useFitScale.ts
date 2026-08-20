import { useLayoutEffect, useRef, useState } from 'react';

/** Milímetro CSS em pixels, a 96dpi. */
export const MM_TO_PX = 96 / 25.4;

export const mm = (value: number) => value * MM_TO_PX;

interface FitOptions {
  /** Folga horizontal reservada (réguas, respiro). */
  padding?: number;
  /** Folga vertical reservada. */
  paddingY?: number;
  max?: number;
  /**
   * Altura do conteúdo. Informando, a folha também encolhe para caber na altura
   * — que é o que faz a página inteira ser visível de uma vez, em vez de exigir
   * rolagem para ver o rodapé.
   */
  contentHeightPx?: number;
  /**
   * Sobrescreve o cálculo automático. Quando definido, `scale` fica igual a
   * este número e o hook ignora o tamanho do container. É como o editor
   * implementa zoom manual sem duplicar o wiring do ResizeObserver.
   */
  override?: number;
}

/**
 * Mede o espaço disponível e devolve o fator para o conteúdo caber nele.
 *
 * É o que permite desenhar a folha nas medidas reais — 210mm é 210mm — e só
 * depois encolher o conjunto para caber na tela.
 */
export function useFitScale(contentWidthPx: number, options: FitOptions = {}) {
  const { padding = 0, paddingY = 0, max = 1, contentHeightPx, override } = options;
  const ref = useRef<HTMLDivElement>(null);
  const rafHandles = useRef<number[]>([]);
  const [scale, setScale] = useState(override ?? 0);

  useLayoutEffect(() => {
    if (override !== undefined) {
      setScale(override);
      return;
    }
    const node = ref.current;
    // O container mede a largura; quem tem altura definida é o pai.
    const box = node?.parentElement ?? node;
    if (!node || !box) return;

    const measure = () => {
      const width = node.clientWidth - padding;
      if (width <= 0) return;

      let next = width / contentWidthPx;
      if (contentHeightPx) {
        const height = box.clientHeight - paddingY;
        if (height > 0) next = Math.min(next, height / contentHeightPx);
      }
      // Garante que o zoom fit sempre produz algo visível. Cai para a
      // fração mínima do ZoomBar (0.25) caso a medida ainda esteja em zero.
      const safe = next > 0 ? Math.min(max, next) : 0.25;
      setScale(safe);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (box !== node) observer.observe(box);
    // Medida inicial + duas re-medidas via rAF para pegar layouts que só
    // estabilizam depois do primeiro paint (troca de aba, mount recente).
    measure();
    const raf1 = requestAnimationFrame(() => {
      measure();
      // Segundo tick — necessário quando uma transição CSS ainda está
      // resolvendo dimensões do container.
      const raf2 = requestAnimationFrame(measure);
      rafHandles.current.push(raf2);
    });
    rafHandles.current.push(raf1);

    return () => {
      observer.disconnect();
      rafHandles.current.forEach(cancelAnimationFrame);
      rafHandles.current = [];
    };
  }, [contentWidthPx, contentHeightPx, padding, paddingY, max, override]);

  return { ref, scale };
}
