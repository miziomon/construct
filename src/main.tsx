import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPersistence } from './scene/persistence';
import { startKernelSync, useResultStore } from './kernel/useKernel';
import { useSceneStore } from './scene/store';
import './styles/main.scss';

// Solo nella build dei test end-to-end: i test leggono lo stato dell'app senza passare dalla UI
if (import.meta.env.MODE === 'e2e') window.__webcad = { store: useSceneStore, results: useResultStore };

// Prima si ripristina la scena salvata, poi si collega il kernel (che calcola la scena già caricata)
void initPersistence().finally(startKernelSync);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
