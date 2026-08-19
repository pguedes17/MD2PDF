import { describe, it, expect } from 'vitest';
import {
  TemplateInputSchema,
  TemplateSchema,
  makeBlankTemplateInput,
  applyVariables,
} from '../src/domain/template.js';

const validInput = () => ({
  name: 'Contrato Padrão',
  page: {
    format: 'A4' as const,
    orientation: 'portrait' as const,
    margins: { top: 35, right: 20, bottom: 25, left: 20 },
  },
  header: {
    heightMm: 25,
    elements: [
      { type: 'image' as const, assetId: 'ast_logo', heightMm: 12, align: 'left' as const, xOffsetMm: 0, yMm: 0 },
      { type: 'text' as const, value: 'ACME S/A', align: 'center' as const, xOffsetMm: 0, yMm: 0 },
    ],
  },
  footer: {
    heightMm: 15,
    elements: [
      { type: 'text' as const, value: 'Confidencial', align: 'left' as const, xOffsetMm: 0, yMm: 0 },
      { type: 'pageNumber' as const, format: 'Página {page} de {total}', align: 'right' as const, xOffsetMm: 0, yMm: 0 },
    ],
  },
});

describe('TemplateInputSchema', () => {
  it('aceita um template válido e aplica os defaults', () => {
    const parsed = TemplateInputSchema.parse(validInput());
    const text = parsed.header.elements[1]!;
    expect(text).toMatchObject({
      type: 'text',
      bold: false,
      fontSizePt: 9,
      color: '#444',
      align: 'center',
      xOffsetMm: 0,
      yMm: 0,
    });
    expect(parsed.body.fontSizePt).toBe(11);
  });

  it('aplica defaults de posição quando o elemento não os traz', () => {
    const input = validInput();
    (input.header.elements[0] as Record<string, unknown>).align = undefined;
    (input.header.elements[0] as Record<string, unknown>).xOffsetMm = undefined;
    (input.header.elements[0] as Record<string, unknown>).yMm = undefined;
    const parsed = TemplateInputSchema.parse(input);
    expect(parsed.header.elements[0]).toMatchObject({ align: 'left', xOffsetMm: 0, yMm: 0 });
  });

  it('rejeita margem superior menor que a altura do header', () => {
    const input = validInput();
    input.page.margins.top = 20; // header tem 25mm -> não cabe
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'page.margins.top');
    expect(issue?.message).toMatch(/30mm/);
  });

  it('rejeita margem inferior menor que a altura do footer', () => {
    const input = validInput();
    input.page.margins.bottom = 10; // footer tem 15mm
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.') === 'page.margins.bottom')).toBe(true);
  });

  it('aceita header de altura zero sem exigir margem', () => {
    const input = validInput();
    input.header = { heightMm: 0, elements: [] };
    input.page.margins.top = 15;
    expect(TemplateInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const input = { ...validInput(), name: '  ' };
    expect(TemplateInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejeita tipo de elemento desconhecido', () => {
    const input = validInput();
    (input.header.elements as unknown[]).push({ type: 'qrcode', align: 'left', xOffsetMm: 0, yMm: 0 });
    expect(TemplateInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejeita elemento que estoura a faixa (yMm + altura estimada > heightMm)', () => {
    const input = validInput();
    // texto 9pt ≈ 3.8mm × 1.2 line-height ≈ 4.6mm. Com yMm=24 numa faixa de 25mm, estoura.
    (input.header.elements as unknown[]).push({
      type: 'text',
      value: 'baixo demais',
      align: 'left',
      xOffsetMm: 0,
      yMm: 24,
    });
    const result = TemplateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.').startsWith('header.elements'))).toBe(true);
  });

  it('aceita imagem posicionada no limite exato', () => {
    const input = validInput();
    input.header.elements.length = 0;
    (input.header.elements as unknown[]).push({
      type: 'image',
      assetId: 'ast_ok',
      heightMm: 10,
      align: 'right',
      xOffsetMm: 0,
      yMm: 15, // 15 + 10 = 25 = heightMm exato
    });
    expect(TemplateInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('TemplateSchema', () => {
  it('exige id e timestamps', () => {
    expect(TemplateSchema.safeParse(validInput()).success).toBe(false);
    const full = {
      ...TemplateInputSchema.parse(validInput()),
      id: 'tpl_abc123',
      version: 1,
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    expect(TemplateSchema.safeParse(full).success).toBe(true);
  });
});

describe('makeBlankTemplateInput', () => {
  it('produz um template que passa na própria validação', () => {
    const blank = makeBlankTemplateInput('Novo');
    expect(TemplateInputSchema.safeParse(blank).success).toBe(true);
  });

  it('inicia com paginação alinhada à direita no rodapé', () => {
    const blank = makeBlankTemplateInput();
    expect(blank.header.elements).toEqual([]);
    expect(blank.footer.elements).toHaveLength(1);
    expect(blank.footer.elements[0]).toMatchObject({
      type: 'pageNumber',
      align: 'right',
      xOffsetMm: 0,
      yMm: 0,
    });
  });
});

describe('applyVariables', () => {
  it('substitui placeholders conhecidos', () => {
    expect(applyVariables('Cliente: {{cliente}}', { cliente: 'ACME' })).toBe('Cliente: ACME');
  });

  it('tolera espaços dentro das chaves', () => {
    expect(applyVariables('{{ cliente }}', { cliente: 'ACME' })).toBe('ACME');
  });

  it('troca placeholder sem valor por string vazia', () => {
    expect(applyVariables('X{{ausente}}Y', { cliente: 'ACME' })).toBe('XY');
  });

  it('não quebra sem variáveis', () => {
    expect(applyVariables('{{a}}', undefined)).toBe('');
    expect(applyVariables('texto puro', undefined)).toBe('texto puro');
  });
});
