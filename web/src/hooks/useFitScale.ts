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
      setScale(Math.min(max, next));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (box !== node) observer.observe(box);
    measure();

    return () => observer.disconnect();
  }, [contentWidthPx, contentHeightPx, padding, paddingY, max, override]);

  return { ref, scale };
}
