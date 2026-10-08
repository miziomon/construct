import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { sceneToOpenScad } from '../../codegen/openscad';
import { PLATE_GAP } from '../../scene/plates';
import { exportScad } from '../fileActions';
import { Modal } from '../Modal/Modal';
import { useUiStore } from '../uiStore';
import { tokenizeLine } from './highlight';
import './CodeModal.scss';

/** Modale (80% della finestra) con il codice OpenSCAD equivalente alla scena, in sola lettura e colorato. */
export default function CodeModal() {
  const setCodeOpen = useUiStore((s) => s.setCodeOpen);
  const scene = useSceneStore((s) => s.scene);
  const spacing = useUiStore((s) => s.bedSize.width + PLATE_GAP);
  const code = useMemo(() => sceneToOpenScad(scene, { plateSpacing: spacing }), [scene, spacing]);
  // Righe già scomposte in segmenti: si ricalcolano solo quando cambia il codice
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n').map(tokenizeLine), [code]);
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
    <Modal open title="Codice OpenSCAD" size="large" onClose={() => setCodeOpen(false)}>
      <div className="code-view">
        <div className="code-view__actions">
          <button type="button" className="modal__button" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copiato' : 'Copia'}
          </button>
          <button type="button" className="modal__button" onClick={exportScad}>
            <Download size={14} />
            Scarica .scad
          </button>
          <span className="code-view__info">{lines.length} righe, sola lettura</span>
        </div>
        <div className="code-view__scroller" tabIndex={0}>
          <pre className="code-view__code">
            {lines.map((tokens, i) => (
              // Le righe non cambiano ordine: l'indice è una chiave stabile
              <div key={i} className="code-view__line">
                <span className="code-view__number" aria-hidden="true">{i + 1}</span>
                <code className="code-view__text">
                  {tokens.map((t, j) => (t.kind === 'text' ? t.text : <span key={j} className={`code-view__tok code-view__tok--${t.kind}`}>{t.text}</span>))}
                </code>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
