/**
 * A marca é o próprio objeto do produto: uma folha com duas faixas — cabeçalho
 * e rodapé — que é exatamente o que o sistema controla. A faixa de cima é sólida
 * porque é onde mora a identidade; a de baixo é fina, como a numeração.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="MD2PDF"
      className="logomark"
    >
      <rect width="32" height="32" rx="7.5" className="logomark__plate" />
      <rect x="8.5" y="6" width="15" height="20" rx="1.5" className="logomark__sheet" />
      <rect x="8.5" y="6" width="15" height="4.5" rx="1.5" className="logomark__band" />
      <rect x="8.5" y="7.5" width="15" height="3" className="logomark__band" />
      <rect x="11" y="14" width="10" height="1.1" rx="0.55" className="logomark__rule" />
      <rect x="11" y="17" width="10" height="1.1" rx="0.55" className="logomark__rule" />
      <rect x="11" y="20" width="6" height="1.1" rx="0.55" className="logomark__rule" />
      <rect x="11" y="23.4" width="4" height="1.1" rx="0.55" className="logomark__foot" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      MD<span className="wordmark__pivot">2</span>PDF
    </span>
  );
}

export function Brand({ size = 26 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <Wordmark />
    </span>
  );
}
