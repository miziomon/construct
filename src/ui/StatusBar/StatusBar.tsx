import { useMemo } from 'react';
import { useResultStore } from '../../kernel/useKernel';
import { useUiStore } from '../uiStore';
import { BedDialog } from './BedDialog';
import './StatusBar.scss';

/** Barra di stato: misure e validità della mesh complessiva dei solid (utile prima di stampare). */
export function StatusBar() {
  const { meshes, ms, busy, error } = useResultStore();
  const bedSize = useUiStore((s) => s.bedSize);
  const setBedDialogOpen = useUiStore((s) => s.setBedDialogOpen);

  const stats = useMemo(() => {
    const solids = meshes.filter((m) => !m.isHole && !m.empty);
    if (!solids.length) return undefined;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const m of solids) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], m.bbox.min[i]);
        max[i] = Math.max(max[i], m.bbox.max[i]);
      }
    }
    return {
      size: max.map((v, i) => v - min[i]),
      volumeCm3: solids.reduce((a, m) => a + m.volume, 0) / 1000,
      triangles: solids.reduce((a, m) => a + m.indices.length / 3, 0),
      valid: solids.every((m) => m.status === 'NoError'),
    };
  }, [meshes]);

  return (
    <footer className="status-bar">
      {/* Dimensioni del piano di stampa: un clic apre la finestra per cambiarle */}
      <button type="button" className="status-bar__item status-bar__bed" title="Dimensioni del piano di stampa: clicca per modificarle" onClick={() => setBedDialogOpen(true)}>
        Piano {bedSize.width} × {bedSize.depth} mm
      </button>
      {error ? (
        <span className="status-bar__item status-bar__item--error">Errore del kernel: {error}</span>
      ) : stats ? (
        <>
          <span className="status-bar__item">Ingombro {stats.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
          <span className="status-bar__item">Volume {stats.volumeCm3.toFixed(2)} cm³</span>
          <span className="status-bar__item">{stats.triangles.toLocaleString('it-IT')} triangoli</span>
          <span className={`status-bar__item ${stats.valid ? 'status-bar__item--ok' : 'status-bar__item--error'}`}>{stats.valid ? 'Mesh valida' : 'Mesh non valida'}</span>
        </>
      ) : (
        <span className="status-bar__item">Nessun solido nella scena</span>
      )}
      <span className="status-bar__spacer" />
      <span className="status-bar__item">{busy ? 'Calcolo…' : `Calcolo ${ms.toFixed(0)} ms`}</span>
      <span className="status-bar__item">v{__APP_VERSION__}</span>
      <BedDialog />
    </footer>
  );
}
