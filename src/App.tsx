import { Toolbar } from './ui/Toolbar/Toolbar';
import { ShapeLibrary } from './ui/ShapeLibrary/ShapeLibrary';
import { Outliner } from './ui/Outliner/Outliner';
import { Sidebar } from './ui/Sidebar/Sidebar';
import { StatusBar } from './ui/StatusBar/StatusBar';
import { UpdatePrompt } from './ui/UpdatePrompt/UpdatePrompt';
import { Notifications } from './ui/notify/Notifications';
import { Viewport } from './viewport/Viewport';
import { useShortcuts } from './hooks/useShortcuts';
import { importFiles } from './import/importFile';
import './App.scss';

export default function App() {
  useShortcuts();

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
      <UpdatePrompt />
      <Notifications />
    </div>
  );
}
