import { useMemo, useState } from 'react';
import { fontInfo } from '../../scene/fontCatalog';
import { SYMBOL_GROUPS, SYMBOLS } from '../../scene/symbolCatalog';
import { useSceneStore } from '../../scene/store';
import { CharacterGroups } from './CharacterGroups';
import type { LibraryEntry } from './CharacterGroups';

/** Un simbolo come voce della libreria: tooltip e nome accessibile sono il suo nome in italiano. */
const entryOf = (s: (typeof SYMBOLS)[number]): LibraryEntry => ({ char: s.char, title: `Aggiungi simbolo: ${s.name}`, label: s.name, font: s.font });

const CATALOG = new Map(SYMBOLS.map((s) => [s.char, entryOf(s)]));
// Il nome in italiano serve anche al nome dell'oggetto creato
const NAMES = new Map(SYMBOLS.map((s) => [s.char, s.name]));

/**
 * Tab Simboli: elenco dei simboli Unicode con l'anteprima del carattere, per categoria (accordion), con ricerca,
 * Preferiti e Recenti. Un clic aggiunge una forma Testo estrusa con quel simbolo, nel font che lo contiene; l'oggetto
 * si chiama "Simbolo: <nome>".
 */
export default function SymbolsPanel() {
  const addText = useSceneStore((s) => s.addText);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      SYMBOL_GROUPS.map((g) => ({
        title: g.title,
        entries: g.symbols.filter((s) => !q || s.name.toLowerCase().includes(q) || s.char === q).map(entryOf),
      })).filter((g) => g.entries.length > 0),
    [q],
  );

  return (
    <div className="symbols">
      <input
        className="symbols__search"
        type="search"
        placeholder="Cerca un simbolo…"
        aria-label="Cerca un simbolo"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="shape-library__loading">Nessun simbolo trovato.</p>}
      <CharacterGroups
        prefix="symbols"
        groups={groups}
        catalog={CATALOG}
        searching={q !== ''}
        onAdd={(e) => addText({ text: e.char, font: fontInfo(e.font).id, origin: 'symbol', label: NAMES.get(e.char) })}
      />
    </div>
  );
}
