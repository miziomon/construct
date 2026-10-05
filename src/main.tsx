import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPersistence } from './scene/persistence';
import { startKernelSync } from './kernel/useKernel';
import './styles/main.scss';

// Prima si ripristina la scena salvata, poi si collega il kernel (che calcola la scena già caricata)
void initPersistence().finally(startKernelSync);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
