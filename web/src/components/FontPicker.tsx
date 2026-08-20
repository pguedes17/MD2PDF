import { useEffect, useState } from 'react';
import { FONT_PRESETS, DEFAULT_FONT_FAMILY } from '@shared/domain/fontPresets.js';
import { listFonts, uploadFont, deleteFont } from '../api.js';
import type { FontMeta } from '../api.js';

interface Props {
  value: { family: string; customFontId?: string };
  onChange: (next: { family: string; customFontId?: string }) => void;
}

export function FontPicker({ value, onChange }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [customFonts, setCustomFonts] = useState<FontMeta[]>([]);
  const [uploadingFamily, setUploadingFamily] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showModal) return;
    listFonts()
      .then(setCustomFonts)
      .catch(() => {});
  }, [showModal]);

  const usingCustom = !!value.customFontId;

  function openModal() {
    setError(null);
    setUploadingFamily('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  async function handleDelete(fontId: string) {
    try {
      await deleteFont(fontId);
      setCustomFonts(await listFonts());
    } catch {
      setError('Erro ao excluir fonte.');
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadingFamily.trim()) {
      setError('Informe o nome da família antes de enviar o arquivo.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const meta = await uploadFont(file, uploadingFamily.trim());
      onChange({ family: meta.family, customFontId: meta.fontId });
      closeModal();
    } catch {
      setError('Erro ao enviar fonte. Verifique o arquivo e tente novamente.');
    } finally {
      setUploading(false);
      // reset file input
      e.target.value = '';
    }
  }

  return (
    <div>
      <label className="field">
        <span className="label">Fonte do corpo</span>
        <select
          value={usingCustom ? '__custom__' : value.family}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              openModal();
              return;
            }
            onChange({ family: e.target.value, customFontId: undefined });
          }}
        >
          {FONT_PRESETS.map((p) => (
            <option key={p.family} value={p.family}>
              {p.label}
            </option>
          ))}
          <option value="__custom__">— Fonte customizada… —</option>
        </select>
      </label>

      {usingCustom && (
        <div className="hint" style={{ marginTop: 4 }}>
          Fonte custom em uso: <strong>{value.family}</strong>{' '}
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onChange({ family: DEFAULT_FONT_FAMILY, customFontId: undefined })}
          >
            remover
          </button>
        </div>
      )}

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Escolher fonte customizada"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            style={{
              background: 'var(--color-surface, #1e1e1e)',
              border: '1px solid var(--color-border, #333)',
              borderRadius: 8,
              padding: 24,
              minWidth: 360,
              maxWidth: 480,
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ margin: '0 0 16px' }}>Escolher fonte customizada</h3>

            {customFonts.length === 0 ? (
              <p className="hint">Nenhuma fonte enviada ainda.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                {customFonts.map((f) => (
                  <li
                    key={f.fontId}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
                  >
                    <button
                      type="button"
                      className="btn btn--sm"
                      style={{ flex: 1, textAlign: 'left' }}
                      onClick={() => {
                        onChange({ family: f.family, customFontId: f.fontId });
                        closeModal();
                      }}
                    >
                      {f.family} <em style={{ opacity: 0.6 }}>({f.filename})</em>
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => void handleDelete(f.fontId)}
                    >
                      excluir
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <hr style={{ margin: '16px 0', opacity: 0.2 }} />
            <h4 style={{ margin: '0 0 10px' }}>Enviar nova fonte</h4>

            <label className="field" style={{ marginBottom: 8 }}>
              <span className="label">Nome da família</span>
              <input
                type="text"
                placeholder="ex.: MinhaFonte, sans-serif"
                value={uploadingFamily}
                onChange={(e) => setUploadingFamily(e.target.value)}
                disabled={uploading}
              />
            </label>

            <label className="field" style={{ marginBottom: 12 }}>
              <span className="label">Arquivo (.ttf ou .otf)</span>
              <input
                type="file"
                accept=".ttf,.otf"
                disabled={uploading}
                onChange={(e) => void handleFileChange(e)}
              />
            </label>

            {error && (
              <div className="notice notice--warn" style={{ marginBottom: 12 }}>
                {error}
              </div>
            )}

            {uploading && <p className="hint">Enviando…</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--sm btn--ghost" onClick={closeModal}>
                fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
