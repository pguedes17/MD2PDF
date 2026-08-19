import { useEffect, useState } from 'react';
import { TemplateList } from './pages/TemplateList.js';
import { TemplateEditor } from './pages/TemplateEditor.js';
import { TemplateConvert } from './pages/TemplateConvert.js';

type Route =
  | { name: 'list' }
  | { name: 'editor'; templateId: string }
  | { name: 'convert'; templateId: string };

/** Roteamento por hash: poucas telas não justificam uma biblioteca de rotas. */
function currentRoute(): Route {
  const hash = window.location.hash;
  const editor = hash.match(/^#\/templates\/(tpl_[A-Za-z0-9_-]+)$/);
  if (editor?.[1]) return { name: 'editor', templateId: editor[1] };
  const convert = hash.match(/^#\/convert\/(tpl_[A-Za-z0-9_-]+)$/);
  if (convert?.[1]) return { name: 'convert', templateId: convert[1] };
  return { name: 'list' };
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const back = () => {
    window.location.hash = '';
  };

  if (route.name === 'editor') {
    return <TemplateEditor templateId={route.templateId} onBack={back} />;
  }

  if (route.name === 'convert') {
    return <TemplateConvert templateId={route.templateId} onBack={back} />;
  }

  return (
    <TemplateList
      onOpen={(id) => {
        window.location.hash = `#/templates/${id}`;
      }}
      onConvert={(id) => {
        window.location.hash = `#/convert/${id}`;
      }}
    />
  );
}
