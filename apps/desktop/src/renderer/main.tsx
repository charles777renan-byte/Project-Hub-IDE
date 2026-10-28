import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import { Toaster } from './components/Toaster';

// Os estilos não são importados aqui: o index.html liga os arquivos CSS por <link> (ver o comentário
// dele). HashRouter porque em produção o renderer roda de file://, onde as rotas não podem mudar o
// caminho do documento.
const container = document.getElementById('root');
if (container === null) {
  throw new Error('O index.html do renderer não tem o elemento #root.');
}

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
    <Toaster />
  </StrictMode>,
);
