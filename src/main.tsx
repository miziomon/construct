import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Va prima di App: il primo avvio si decide guardando localStorage prima che gli store ci scrivano
import { isFirstVisit } from './ui/Welcome/firstVisit';
import App from './App';
import { useUiStore } from './ui/uiStore';
import { initPersistence } from './scene/persistence';
import { startKernelSync, useResultStore } from './kernel/useKernel';
import { useSceneStore } from './scene/store';
import './styles/main.scss';

// Solo nella build dei test end-to-end: i test leggono lo stato dell'app senza passare dalla UI
if (import.meta.env.MODE === 'e2e') window.__construct = { store: useSceneStore, results: useResultStore };

// Prima si ripristina la scena salvata, poi si collega il kernel (che calcola la scena già caricata)
// Al primo avvio, senza una scena da ripristinare, si mostra la schermata di benvenuto
void initPersistence()
  .then((restored) => {
    // Il benvenuto compare al primo avvio senza una scena da ripristinare, oppure a ogni avvio se l'utente lo ha scelto
    const always = useUiStore.getState().welcomeAlways;
    if ((isFirstVisit && !restored) || always) useUiStore.getState().setWelcomeOpen(true);
  })
  .finally(startKernelSync);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
