import { useState } from 'react';
import type { TemplateInput } from '@shared/domain/template.js';
import {
  bandClashes,
  collectVariables,
  requiredMarginMm,
  sheetSizeMm,
  type BandName,
} from '../lib/templateModel.js';

interface PageSettingsProps {
  template: TemplateInput;
  /** Id do template já persistido — o snippet o injeta no exemplo de request. */
  templateId?: string;
  onChange: (next: TemplateInput) => void;
}

const MARGIN_SIDES = [
  { key: 'top', label: 'superior' },
  { key: 'bottom', label: 'inferior' },
  { key: 'left', label: 'esquerda' },
  { key: 'right', label: 'direita' },
] as const;

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="label">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        type="number"
        className="measure"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
      />
    </label>
  );
}

function VariablesSection({
  template,
  templateId,
}: {
  template: TemplateInput;
  templateId?: string;
}) {
  const variables = collectVariables(template);
  const [copied, setCopied] = useState(false);

  const varsBody =
    variables.length === 0
      ? '"cliente": "..."'
      : variables.map((name) => `"${name}": "..."`).join(',\n    ');
  const snippet = `POST /api/convert
{
  "templateId": "${templateId ?? 'tpl_...'}",
  "markdown": "seu conteúdo",
  "variables": {
    ${varsBody}
  }
}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // sem clipboard permission — silenciosamente descartado
    }
  }

  return (
    <section className="pane__section">
      <span className="label pane__title">variáveis</span>

      {variables.length === 0 ? (
        <p className="hint">
          Escreva <code className="code">{'{{nome}}'}</code> em qualquer elemento de texto —
          a variável passa a aparecer aqui e vira campo esperado no request.
        </p>
      ) : (
        <>
          <div className="varlist">
            {variables.map((name) => (
              <span key={name} className="varchip">
                {name}
              </span>
            ))}
          </div>
          <p className="hint">
            Envie cada uma pelo campo <code className="code">variables</code> na hora de converter.
          </p>
        </>
      )}

      <div className="snippet">
        <button
          type="button"
          className="snippet__copy"
          onClick={() => void copy()}
          aria-label="copiar exemplo"
        >
          {copied ? 'copiado' : 'copiar'}
        </button>
        <pre>{snippet}</pre>
      </div>
    </section>
  );
}

export function PageSettings({ template, templateId, onChange }: PageSettingsProps) {
  const size = sheetSizeMm(template.page);

  const setBandHeight = (band: BandName, heightMm: number) =>
    onChange({ ...template, [band]: { ...template[band], heightMm } });

  const fixMargin = (band: BandName) => {
    const key = band === 'header' ? 'top' : 'bottom';
    onChange({
      ...template,
      page: {
        ...template.page,
        margins: { ...template.page.margins, [key]: requiredMarginMm(template, band) },
      },
    });
  };

  return (
    <>
      <section className="pane__section">
        <span className="label pane__title">template</span>
        <label className="field">
          <span className="label">nome</span>
          <input
            type="text"
            value={template.name}
            onChange={(event) => onChange({ ...template, name: event.target.value })}
          />
        </label>
      </section>

      <section className="pane__section">
        <span className="label pane__title">página</span>
        <label className="field">
          <span className="label">formato</span>
          <select
            value={template.page.format}
            onChange={(event) =>
              onChange({
                ...template,
                page: { ...template.page, format: event.target.value as 'A4' | 'Letter' },
              })
            }
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
        </label>

        <label className="field">
          <span className="label">orientação</span>
          <select
            value={template.page.orientation}
            onChange={(event) =>
              onChange({
                ...template,
                page: {
                  ...template.page,
                  orientation: event.target.value as 'portrait' | 'landscape',
                },
              })
            }
          >
            <option value="portrait">retrato</option>
            <option value="landscape">paisagem</option>
          </select>
        </label>

        <p className="stat">
          {size.width} × {size.height} mm
        </p>
      </section>

      <section className="pane__section">
        <span className="label pane__title">margens (mm)</span>
        <div className="grid-2">
          {MARGIN_SIDES.map(({ key, label }) => (
            <NumberField
              key={key}
              label={label}
              value={template.page.margins[key]}
              min={0}
              max={100}
              onChange={(value) =>
                onChange({
                  ...template,
                  page: { ...template.page, margins: { ...template.page.margins, [key]: value } },
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="pane__section">
        <span className="label pane__title">faixas (mm)</span>
        {(['header', 'footer'] as const).map((band) => (
          <div key={band}>
            <NumberField
              label={band === 'header' ? 'altura do cabeçalho' : 'altura do rodapé'}
              value={template[band].heightMm}
              min={0}
              max={60}
              onChange={(value) => setBandHeight(band, value)}
            />
            {bandClashes(template, band) && (
              <div className="notice notice--warn">
                A margem {band === 'header' ? 'superior' : 'inferior'} precisa ter pelo menos{' '}
                <strong className="measure">{requiredMarginMm(template, band)}mm</strong> para caber
                esta faixa. Do jeito que está, o PDF sai com a faixa cortada.
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => fixMargin(band)}>
                    Ajustar a margem
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="pane__section">
        <span className="label pane__title">corpo</span>
        <NumberField
          label="tamanho da fonte"
          suffix="pt"
          value={template.body.fontSizePt}
          min={6}
          max={24}
          onChange={(value) => onChange({ ...template, body: { ...template.body, fontSizePt: value } })}
        />
        <NumberField
          label="entrelinha"
          value={template.body.lineHeight}
          min={1}
          max={3}
          step={0.1}
          onChange={(value) => onChange({ ...template, body: { ...template.body, lineHeight: value } })}
        />
      </section>

      <VariablesSection template={template} templateId={templateId} />
    </>
  );
}
