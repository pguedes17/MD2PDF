import { useEffect, useState } from 'react';
import { TemplateList } from './pages/TemplateList.js';
import { TemplateEditor } from './pages/TemplateEditor.js';

/** Roteamento por hash: duas telas não justificam uma biblioteca de rotas. */
function currentTemplateId(): string | null {
  const match = window.location.hash.match(/^#\/templates\/(tpl_[A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function App() {
  const [templateId, setTemplateId] = useState<string | null>(currentTemplateId);

  useEffect(() => {
    const onHashChange = () => setTemplateId(currentTemplateId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (templateId) {
    return (
      <TemplateEditor
        templateId={templateId}
        onBack={() => {
          window.location.hash = '';
        }}
      />
    );
  }

  return (
    <TemplateList
      onOpen={(id) => {
        window.location.hash = `#/templates/${id}`;
      }}
    />
  );
}
