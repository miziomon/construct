import { Suspense, lazy, useEffect } from 'react';
import { Toolbar } from './ui/Toolbar/Toolbar';
import { ShapeLibrary } from './ui/ShapeLibrary/ShapeLibrary';
import { Outliner } from './ui/Outliner/Outliner';
import { Sidebar } from './ui/Sidebar/Sidebar';
import { StatusBar } from './ui/StatusBar/StatusBar';
import { UpdatePrompt } from './ui/UpdatePrompt/UpdatePrompt';
import { Notifications } from './ui/notify/Notifications';
import { Viewport } from './viewport/Viewport';
import { useUiStore } from './ui/uiStore';
import { useShortcuts } from './hooks/useShortcuts';
import { importFiles } from './import/importFile';
import './App.scss';

// La modale del codice (e il generatore OpenSCAD) si scarica solo quando serve
const CodeModal = lazy(() => import('./ui/CodeModal/CodeModal'));

/** Colore di sfondo della pagina per la barra del browser (stessi valori del token "bg"). */
const THEME_COLORS = { light: '#e9eff6', dark: '#14171c' };

export default function App() {
  useShortcuts();
  const theme = useUiStore((s) => s.theme);
  const codeOpen = useUiStore((s) => s.codeOpen);

  // Il tema è un attributo sulla radice: le variabili CSS cambiano di conseguenza
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  }, [theme]);

  return (
    <div
      className="app"
      // Trascinando un file STL o 3MF nella finestra lo si importa
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Toolbar />
      <div className="app__body">
        <aside className="app__left" aria-label="Libreria e oggetti">
          <ShapeLibrary />
          <Outliner />
        </aside>
        <main className="app__center">
          <Viewport />
          <StatusBar />
        </main>
        <Sidebar />
      </div>
      {codeOpen && (
        <Suspense fallback={null}>
          <CodeModal />
        </Suspense>
      )}
      <UpdatePrompt />
      <Notifications />
    </div>
  );
}
