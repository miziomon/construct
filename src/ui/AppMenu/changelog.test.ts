import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';

const SAMPLE = `# Changelog

## Come si rilascia una versione

1. Passo uno.

## [Non rilasciato]

- Voce da ignorare

## [0.2.0] - 2026-10-06

### Aggiunto
- Prima voce con \`codice\`
- Seconda voce

### Modificato
- Terza voce

## [0.1.0] - 2026-10-05

Primo POC.

### Aggiunto
- Voce vecchia
`;

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE);

  it('restituisce solo le versioni rilasciate, dalla più recente', () => {
    expect(releases.map((r) => r.version)).toEqual(['0.2.0', '0.1.0']);
    expect(releases[0].date).toBe('2026-10-06');
  });

  it('raggruppa le voci per sezione', () => {
    expect(releases[0].sections).toEqual([
      { title: 'Aggiunto', items: ['Prima voce con `codice`', 'Seconda voce'] },
      { title: 'Modificato', items: ['Terza voce'] },
    ]);
  });

  it('conserva il testo libero sotto il titolo della versione', () => {
    expect(releases[1].notes).toEqual(['Primo POC.']);
  });

  it('non include l\'introduzione né "Non rilasciato"', () => {
    expect(JSON.stringify(releases)).not.toContain('Voce da ignorare');
    expect(JSON.stringify(releases)).not.toContain('Passo uno');
  });
});
