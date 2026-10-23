import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/community/Root';
import './styles/base.css';
import './styles/phone.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('FixList root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
