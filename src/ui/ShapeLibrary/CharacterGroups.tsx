import { useEffect, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Star } from 'lucide-react';
import { useUiStore } from '../uiStore';
import { AccordionGroup } from './AccordionGroup';
import { previewFamily, registerPreviewFonts } from './previewFonts';

/** Un carattere della libreria (simbolo o emoji) con tutto ciò che serve a mostrarlo e ad aggiungerlo. */
export interface LibraryEntry {
  char: string;
  /** Testo del tooltip, es. "Aggiungi simbolo: Stella piena". */
  title: string;
  /** Nome accessibile del pulsante. */
  label: string;
  /** Font del catalogo che contiene il glifo (anche per l'anteprima). */
  font: string;
}

interface Props {
  /** Prefisso delle chiavi di gruppo e di preferiti/recenti (`symbols` o `emoji`). */
  prefix: 'symbols' | 'emoji';
  groups: { title: string; entries: LibraryEntry[] }[];
  /** Tutti i caratteri del catalogo, per ritrovare Preferiti e Recenti dalle chiavi salvate. */
  catalog: Map<string, LibraryEntry>;
  /** Mostra tutti i gruppi aperti e nasconde Preferiti e Recenti (ricerca in corso). */
  searching?: boolean;
  onAdd: (entry: LibraryEntry) => void;
}

/** Un carattere con la stella dei preferiti (visibile con il mouse sopra o con il focus, sempre se è un preferito). */
function Item({ entry, itemKey, onAdd }: { entry: LibraryEntry; itemKey: string; onAdd: (entry: LibraryEntry) => void }) {
  const favorite = useUiStore((s) => s.libraryFavorites.includes(itemKey));
  const toggle = useUiStore((s) => s.toggleLibraryFavorite);
  return (
    <div className="symbols__cell">
      <button type="button" className="symbols__item" title={entry.title} aria-label={entry.label} onClick={() => onAdd(entry)}>
        <span className="symbols__glyph" style={{ fontFamily: `${previewFamily(entry.font)}, sans-serif` }} aria-hidden="true">
          {entry.char}
        </span>
      </button>
      <button
        type="button"
        className={`symbols__star${favorite ? ' symbols__star--on' : ''}`}
        aria-pressed={favorite}
        aria-label={`${favorite ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}: ${entry.label}`}
        title={favorite ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}
        onClick={() => toggle(itemKey)}
      >
        <Star size={11} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Gruppi di caratteri delle tab Simboli ed Emoji: Preferiti e Recenti in cima (se ce ne sono), poi le categorie come
 * accordion, con il pulsante "Apri tutto / Chiudi tutto". Un clic su un carattere lo aggiunge e lo mette tra i Recenti.
 */
export function CharacterGroups({ prefix, groups, catalog, searching = false, onAdd }: Props) {
  const favorites = useUiStore((s) => s.libraryFavorites);
  const recent = useUiStore((s) => s.libraryRecent);
  const groupsOpen = useUiStore((s) => s.libraryGroupsOpen);
  const setGroupsOpen = useUiStore((s) => s.setLibraryGroupsOpen);
  const pushRecent = useUiStore((s) => s.pushLibraryRecent);

  // Le anteprime usano il font di simboli appena è pronto
  const [, setReady] = useState(0);
  useEffect(() => {
    void registerPreviewFonts().then(() => setReady((n) => n + 1));
  }, []);

  /** Voci salvate come chiavi `prefix:carattere`, ritrovate nel catalogo (le sconosciute si ignorano). */
  const fromKeys = (keys: string[]): LibraryEntry[] =>
    keys.flatMap((k) => (k.startsWith(`${prefix}:`) ? [catalog.get(k.slice(prefix.length + 1))].filter((e): e is LibraryEntry => !!e) : []));
  const favoriteEntries = fromKeys(favorites);
  const recentEntries = fromKeys(recent);

  const groupKeys = groups.map((g) => `${prefix}:${g.title}`);
  // Il primo gruppo è aperto finché l'utente non decide altrimenti (stesso predefinito di AccordionGroup)
  const isOpen = (key: string, i: number) => groupsOpen[key] ?? i === 0;
  const allOpen = groupKeys.length > 0 && groupKeys.every(isOpen);
  const Toggle = allOpen ? ChevronsDownUp : ChevronsUpDown;

  const add = (entry: LibraryEntry) => {
    pushRecent(`${prefix}:${entry.char}`);
    onAdd(entry);
  };
  const grid = (entries: LibraryEntry[]) => (
    <div className="symbols__grid">
      {entries.map((entry) => (
        <Item key={entry.char} entry={entry} itemKey={`${prefix}:${entry.char}`} onAdd={add} />
      ))}
    </div>
  );

  return (
    <>
      {!searching && (
        <div className="symbols__toolbar">
          <button type="button" className="symbols__toggle-all" onClick={() => setGroupsOpen(groupKeys, !allOpen)} title={allOpen ? 'Chiudi tutte le categorie' : 'Apri tutte le categorie'}>
            <Toggle size={14} aria-hidden="true" />
            {allOpen ? 'Chiudi tutto' : 'Apri tutto'}
          </button>
        </div>
      )}
      {!searching && favoriteEntries.length > 0 && (
        <AccordionGroup id={`${prefix}:__favorites`} title="Preferiti" count={favoriteEntries.length} defaultOpen>
          {grid(favoriteEntries)}
        </AccordionGroup>
      )}
      {!searching && recentEntries.length > 0 && (
        <AccordionGroup id={`${prefix}:__recent`} title="Recenti" count={recentEntries.length} defaultOpen>
          {grid(recentEntries)}
        </AccordionGroup>
      )}
      {groups.map((group, i) => (
        // Con una ricerca in corso i gruppi con risultati si aprono (senza cambiare quelli ricordati)
        <AccordionGroup key={group.title} id={`${prefix}:${group.title}`} title={group.title} count={group.entries.length} defaultOpen={i === 0} forceOpen={searching}>
          {grid(group.entries)}
        </AccordionGroup>
      ))}
    </>
  );
}
