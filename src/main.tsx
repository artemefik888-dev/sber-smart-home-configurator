import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Configurator from '../app/components/Configurator';
import '../app/globals.css';

const root = document.getElementById('root');

if (!root) throw new Error('Корневой элемент приложения не найден.');

createRoot(root).render(
  <StrictMode>
    <Configurator />
  </StrictMode>,
);
