import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { sceneToOpenScad } from '../../codegen/openscad';
import { exportScad } from '../fileActions';
import './CodePanel.scss';

/** Codice OpenSCAD equivalente alla scena, in sola lettura (scena → codice). */
export default function CodePanel() {
  const scene = useSceneStore((s) => s.scene);
  const code = useMemo(() => sceneToOpenScad(scene), [scene]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard negata dal browser: l'utente può comunque selezionare il testo a mano
    }
  };

  return (
    <div className="code-panel">
      <div className="code-panel__actions">
        <button type="button" className="code-panel__button" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copiato' : 'Copia'}
        </button>
        <button type="button" className="code-panel__button" onClick={exportScad}>
          <Download size={14} />
          Scarica .scad
        </button>
      </div>
      <pre className="code-panel__code" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
