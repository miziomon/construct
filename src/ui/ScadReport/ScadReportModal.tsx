import { useMemo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useScadReport } from '../../import/scad/reportStore';
import type { ScadReport } from '../../import/scad/reportStore';
import '../CodeModal/CodeModal.scss';
import { tokenizeLine } from '../CodeModal/highlight';
import { Modal } from '../Modal/Modal';
import './ScadReportModal.scss';

/** Righe di codice mostrate prima e dopo quella del problema. */
const CONTEXT = 2;
/** Le righe molto lunghe (file minificati) si tagliano: il frammento deve restare leggibile. */
const MAX_LINE = 160;

/** Frammento del codice attorno a una riga (numerata da 1), con la riga del problema segnata. */
function excerpt(lines: string[], line: number) {
  const from = Math.max(1, line - CONTEXT);
  const to = Math.min(lines.length, line + CONTEXT);
  const rows: { n: number; text: string; hit: boolean }[] = [];
  for (let n = from; n <= to; n++) {
    const text = lines[n - 1].replace(/\t/g, '  ');
    rows.push({ n, text: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text, hit: n === line });
  }
  return rows;
}

function summary(report: ScadReport, errors: number, notes: number): string {
  const parts: string[] = [];
  if (report.imported === 0) parts.push('Non è stato importato nessun oggetto.');
  else parts.push(`Importati ${report.imported} ${report.imported === 1 ? 'oggetto' : 'oggetti'}.`);
  if (errors) parts.push(`${errors} ${errors === 1 ? 'parte non gestita o saltata' : 'parti non gestite o saltate'}.`);
  if (notes) parts.push(`${notes} ${notes === 1 ? 'nota' : 'note'} su approssimazioni.`);
  return parts.join(' ');
}

/**
 * Dettaglio di ciò che non si è importato da un file OpenSCAD: per ogni problema il messaggio, la riga e un frammento
 * del codice originale con la riga evidenziata. Si apre da sola quando l'importazione salta qualcosa o fallisce.
 */
export default function ScadReportModal() {
  const report = useScadReport((s) => s.report);
  const close = useScadReport((s) => s.close);
  const lines = useMemo(() => (report ? report.source.replace(/\r\n?/g, '\n').split('\n') : []), [report]);
  if (!report) return null;

  // Prima gli errori, poi le note; a parità di livello, in ordine di riga
  const sorted = [...report.issues].sort((a, b) => (a.level === b.level ? (a.line ?? 0) - (b.line ?? 0) : a.level === 'error' ? -1 : 1));
  const errors = report.issues.filter((i) => i.level === 'error').length;
  const notes = report.issues.length - errors;

  return (
    <Modal open title={`Importazione di ${report.fileName}`} size="large" onClose={close}>
      <div className="scad-report">
        <p className="scad-report__summary">{summary(report, errors, notes)}</p>
        <ol className="scad-report__list" aria-label="Problemi trovati">
          {sorted.map((issue, i) => (
            <li key={i} className={`scad-report__item scad-report__item--${issue.level}`}>
              <div className="scad-report__head">
                {issue.level === 'error' ? <AlertTriangle size={16} aria-label="Errore" /> : <Info size={16} aria-label="Nota" />}
                <span className="scad-report__message">{issue.message}</span>
                {issue.line !== null && issue.line > 0 && <span className="scad-report__line">riga {issue.line}</span>}
              </div>
              {issue.line !== null && issue.line > 0 && issue.line <= lines.length && (
                <pre className="scad-report__code" aria-label={`Codice vicino alla riga ${issue.line}`}>
                  {excerpt(lines, issue.line).map((row) => (
                    <div key={row.n} className={`scad-report__row${row.hit ? ' scad-report__row--hit' : ''}`}>
                      <span className="scad-report__number" aria-hidden="true">{row.n}</span>
                      <code>
                        {tokenizeLine(row.text).map((t, j) => (t.kind === 'text' ? t.text : <span key={j} className={`code-view__tok code-view__tok--${t.kind}`}>{t.text}</span>))}
                      </code>
                    </div>
                  ))}
                </pre>
              )}
            </li>
          ))}
        </ol>
        <p className="scad-report__foot">Il resto del file è stato importato. Le parti non gestite sono elencate in Documentazione, sezione Codice OpenSCAD.</p>
      </div>
    </Modal>
  );
}
