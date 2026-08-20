type Style = { color: string; bold: boolean; fontSizePt: number };
type Value = { h1: Style; h2: Style; h3: Style };

interface Props {
  value: Value;
  onChange: (next: Value) => void;
}

const LEVELS: Array<keyof Value> = ['h1', 'h2', 'h3'];

export function HeadingsPanel({ value, onChange }: Props) {
  function setLevel<K extends keyof Value>(k: K, patch: Partial<Style>) {
    onChange({ ...value, [k]: { ...value[k], ...patch } });
  }

  return (
    <table>
      <thead><tr><th>Nível</th><th>Cor</th><th>Negrito</th><th>Tamanho (pt)</th></tr></thead>
      <tbody>
        {LEVELS.map((lvl) => (
          <tr key={lvl}>
            <td>{lvl.toUpperCase()}</td>
            <td>
              <input type="color" value={value[lvl].color}
                onChange={(e) => setLevel(lvl, { color: e.target.value })} />
              <input type="text" value={value[lvl].color}
                onChange={(e) => setLevel(lvl, { color: e.target.value })} size={7} />
            </td>
            <td>
              <input type="checkbox" checked={value[lvl].bold}
                onChange={(e) => setLevel(lvl, { bold: e.target.checked })} />
            </td>
            <td>
              <input type="number" min={4} max={72} value={value[lvl].fontSizePt}
                onChange={(e) => setLevel(lvl, { fontSizePt: Number(e.target.value) })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
