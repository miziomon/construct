import { EMOJI_FONT, EMOJI_GROUPS, EMOJIS } from '../../scene/emojiCatalog';
import { useSceneStore } from '../../scene/store';
import { CharacterGroups } from './CharacterGroups';
import type { LibraryEntry } from './CharacterGroups';

/** Codice Unicode di un'emoji per il tooltip, es. "U+1F602". */
const codeOf = (emoji: string) => `U+${emoji.codePointAt(0)!.toString(16).toUpperCase()}`;

const entryOf = (emoji: string): LibraryEntry => ({ char: emoji, title: `Aggiungi emoji: ${codeOf(emoji)}`, label: `Emoji ${codeOf(emoji)}`, font: EMOJI_FONT });

const GROUPS = EMOJI_GROUPS.map((g) => ({ title: g.title, entries: g.emoji.map(entryOf) }));
const CATALOG = new Map(EMOJIS.map((e) => [e, entryOf(e)]));

/**
 * Tab Emoji: le emoji per categoria (accordion), con Preferiti e Recenti. Un clic aggiunge una forma Testo estrusa con
 * quell'emoji nella versione monocromatica a contorno (le emoji a colori non hanno un contorno da estrudere: vale il
 * colore dell'oggetto). L'oggetto si chiama "Emoji <carattere>".
 */
export default function EmojiPanel() {
  const addText = useSceneStore((s) => s.addText);
  return (
    <div className="symbols">
      <CharacterGroups prefix="emoji" groups={GROUPS} catalog={CATALOG} onAdd={(e) => addText({ text: e.char, font: EMOJI_FONT, origin: 'emoji' })} />
    </div>
  );
}
