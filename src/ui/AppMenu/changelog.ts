export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  /** Righe di testo libero sotto il titolo della versione (es. "Primo POC."). */
  notes: string[];
  sections: ChangelogSection[];
}

/**
 * Legge il CHANGELOG.md (Keep a Changelog) e restituisce le versioni rilasciate, dalla più recente.
 * Ignora l'introduzione e la sezione "Non rilasciato".
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let section: ChangelogSection | undefined;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();

    // Titolo di versione: "## [0.2.0] - 2026-10-06"
    const head = /^##\s+\[(\d+\.\d+\.\d+)\]\s*-\s*(\S+)/.exec(line);
    if (head) {
      release = { version: head[1], date: head[2], notes: [], sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    // Qualsiasi altro "##" (intro, "Non rilasciato") chiude la versione corrente
    if (/^##\s/.test(line)) {
      release = undefined;
      section = undefined;
      continue;
    }
    if (!release) continue;

    const sub = /^###\s+(.+)/.exec(line);
    if (sub) {
      section = { title: sub[1], items: [] };
      release.sections.push(section);
    } else if (line.startsWith('- ') && section) {
      section.items.push(line.slice(2));
    } else if (line.trim() && !section) {
      release.notes.push(line.trim());
    }
  }
  return releases;
}
