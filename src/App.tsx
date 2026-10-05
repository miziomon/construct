import { Toolbar } from './ui/Toolbar/Toolbar';
import { ShapeLibrary } from './ui/ShapeLibrary/ShapeLibrary';
import { Outliner } from './ui/Outliner/Outliner';
import { Sidebar } from './ui/Sidebar/Sidebar';
import { StatusBar } from './ui/StatusBar/StatusBar';
import { UpdatePrompt } from './ui/UpdatePrompt/UpdatePrompt';
import { Notifications } from './ui/notify/Notifications';
import { Viewport } from './viewport/Viewport';
import { useShortcuts } from './hooks/useShortcuts';
import './App.scss';

export default function App() {
  useShortcuts();

  return (
    <div className="app">
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
