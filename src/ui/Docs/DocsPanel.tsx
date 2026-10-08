import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { FONTS, FONT_CATEGORIES, googleFontsUrl } from '../../scene/fontCatalog';
import { TOOLBAR_HELP, type HelpKey } from '../Toolbar/toolbarHelp';
import { useUiStore } from '../uiStore';
import './DocsPanel.scss';

/**
 * Documentazione di Construct: manuale per sezioni con indice a ancore e FAQ in fondo. I testi dei comandi vengono da
 * `toolbarHelp.ts` (gli stessi dei tooltip) e le immagini da `public/help`, per non duplicarli.
 */

/** Sezioni del manuale: l'indice e le ancore nascono da qui. */
const SECTIONS = [
  { id: 'cose', title: "Cos'è Construct" },
  { id: 'primi-passi', title: 'Primi passi' },
  { id: 'trasformare', title: 'Trasformare' },
  { id: 'combinare', title: 'Combinare e forare' },
  { id: 'modificare', title: 'Modificare' },
  { id: 'ripetizioni', title: 'Ripetizioni' },
  { id: 'piatti', title: 'Piatti e piano di stampa' },
  { id: 'codice', title: 'Codice OpenSCAD' },
  { id: 'openscad', title: 'OpenSCAD' },
  { id: 'font', title: 'Font' },
  { id: 'import-export', title: 'Importare ed esportare' },
  { id: 'salvataggio', title: 'Salvataggio e progetti' },
  { id: 'scorciatoie', title: 'Scorciatoie' },
  { id: 'faq', title: 'Domande frequenti' },
] as const;

/** Scheda di un comando: nome, cosa fa, come si usa e, se c'è, l'immagine di esempio. */
function Command({ id }: { id: HelpKey }) {
  const { name, what, how, image } = TOOLBAR_HELP[id];
  return (
    <div className="docs__command">
      <h4>{name}</h4>
      <p>{what}</p>
      <p className="docs__how">{how}</p>
      {image && (
        <img
          className="docs__image"
          src={`${import.meta.env.BASE_URL}help/${image}.webp`}
          alt={`Esempio: ${name}`}
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}
    </div>
  );
}

/** Sezione del manuale con il suo titolo ancorabile. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`docs-${id}`} className="docs__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Domanda con risposta a scomparsa. */
function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="docs__faq">
      <summary>{q}</summary>
      <div>{children}</div>
    </details>
  );
}

export default function DocsPanel() {
  const setPanel = useUiStore((s) => s.setAppPanel);
  // Contenitore che scorre e sezione attualmente in vista (evidenziata nell'indice)
  const content = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  // Evidenzia la voce dell'indice mentre si scorre: vale la sezione che attraversa la fascia alta del contenuto
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Tra le sezioni appena entrate nella fascia sceglie la più in alto
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id.replace('docs-', ''));
      },
      { root, rootMargin: '0px 0px -75% 0px' },
    );
    root.querySelectorAll('section.docs__section').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  /** Scorre fino alla sezione dentro il pannello, senza toccare l'URL della pagina. */
  const jump = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    setActive(id);
    document.getElementById(`docs-${id}`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="docs">
      {/* Sidebar fissa a sinistra (riga in alto su schermi stretti): non scorre con il contenuto */}
      <nav className="docs__index" aria-label="Indice della documentazione">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#docs-${s.id}`} className={active === s.id ? 'is-active' : undefined} aria-current={active === s.id ? 'true' : undefined} onClick={jump(s.id)}>{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="docs__content" ref={content}>
      <Section id="cose" title="Cos'è Construct">
        <p><strong>Construct</strong> è un editor CAD 3D che funziona nel browser, pensato per la stampa 3D. Si costruisce a partire da forme semplici (solidi 3D, forme 2D, simboli, emoji e testo), che si combinano con le operazioni booleane (unione, differenza, intersezione, fori) e si rifiniscono con raccordi, smussi, guscio, serie e pattern.</p>
        <p>Il risultato si esporta in <strong>STL</strong> e <strong>3MF</strong>, pronti per lo slicer, oppure come <strong>codice OpenSCAD</strong> equivalente. Si possono importare file STL, 3MF, SVG e OpenSCAD.</p>
        <p>Tutto resta sul tuo dispositivo: nulla viene inviato a un server, e Construct funziona anche offline come PWA. Il progetto è open source (licenza MIT) su <a href="https://github.com/miziomon/construct" target="_blank" rel="noopener noreferrer">github.com/miziomon/construct</a>, realizzato da Maurizio Pelizzone / MAVIDA.</p>
        <h4>Per chi è</h4>
        <p>Per chi stampa in 3D e vuole modellare rapidamente i propri pezzi: supporti, scatole, adattatori, ricambi e piccoli oggetti, con misure esatte in millimetri.</p>
        <h4>Cosa non è</h4>
        <p>Non è un programma di scultura né di disegno tecnico quotato: non ci sono pennelli per modellare in modo organico e non si producono tavole con quote e viste normalizzate.</p>
      </Section>

      <Section id="primi-passi" title="Primi passi">
        <p>Construct è diviso in quattro aree. A sinistra la <strong>libreria</strong> con le forme 3D e 2D, i simboli e le emoji: un clic aggiunge la forma al centro del piatto. Al centro la <strong>vista 3D</strong>, dove si selezionano e si spostano gli oggetti. In alto la <strong>barra strumenti</strong> con i comandi, e a destra l&apos;<strong>elenco degli oggetti</strong> e le <strong>proprietà</strong> dell&apos;oggetto selezionato (nome, posizione, rotazione, misure, colore).</p>
        <p>Si seleziona con un clic (Maiusc+clic per aggiungerne altri, Alt+clic per scegliere un singolo oggetto dentro un gruppo). Le unità sono i millimetri, l&apos;asse Z va verso l&apos;alto. La vista si ruota trascinando e si ingrandisce con la rotella.</p>
        <Command id="select" />
        <Command id="duplicate" />
        <Command id="delete" />
        <Command id="undo" />
        <Command id="redo" />
      </Section>

      <Section id="trasformare" title="Trasformare">
        <p>Ogni oggetto si sposta, ruota e ridimensiona con i gizmo della vista oppure digitando i valori esatti nelle proprietà. Le quote X, Y e Z sull&apos;oggetto selezionato sono cliccabili: si scrive la misura in millimetri.</p>
        <Command id="translate" />
        <Command id="rotate" />
        <Command id="resize" />
        <Command id="extrude" />
      </Section>

      <Section id="combinare" title="Combinare e forare">
        <p>Più oggetti si combinano in gruppi: Raggruppa li muove insieme senza fonderli, Unisci ne fa un solo solido. Un oggetto impostato come Foro toglie materiale a ciò con cui si sovrappone.</p>
        <Command id="group" />
        <Command id="union" />
        <Command id="hull" />
        <Command id="minkowski" />
        <Command id="ungroup" />
        <Command id="hole" />
        <Command id="ghost" />
        <Command id="lock" />
      </Section>

      <Section id="modificare" title="Modificare">
        <p>Rifiniture pensate per la stampa: raccordi e smussi sugli spigoli, guscio per svuotare, specchiatura e allineamento, e due comandi per mettere il pezzo nel verso giusto sul piatto.</p>
        <Command id="fillet" />
        <Command id="chamfer" />
        <Command id="corner" />
        <Command id="shell" />
        <Command id="mirror" />
        <Command id="align" />
        <Command id="measure" />
        <Command id="drop" />
        <Command id="layflat" />
      </Section>

      <Section id="ripetizioni" title="Ripetizioni">
        <p>Serie e Pattern creano gruppi modificabili: si cambiano i parametri, non le singole copie.</p>
        <Command id="array" />
        <Command id="pattern" />
      </Section>

      <Section id="piatti" title="Piatti e piano di stampa">
        <p>Un progetto può avere più <strong>piatti</strong>, ciascuno con i suoi oggetti: si vede un piatto alla volta e si gestiscono dalla scheda Piatti sotto la libreria. Il 3MF esporta tutti i piatti affiancati, l&apos;STL ne chiede uno.</p>
        <p>Le dimensioni del <strong>piano di stampa</strong> (256 × 256 mm all&apos;inizio) si cambiano dalla barra di stato o dal menu del clic destro nel vuoto, anche con i preset delle stampanti. Il comando Piatto cambia come si vede: completo, solo griglia e bordo, nascosto.</p>
        <Command id="bed" />
      </Section>

      <Section id="codice" title="Codice OpenSCAD">
        <p>Il comando <strong>Codice</strong> (tasto C) mostra il codice OpenSCAD generato dalla scena. Si aggiorna a ogni modifica e si può copiare o scaricare. Dal menu Esporta si ottiene un file <code>.scad</code> (con il testo, uno ZIP con i font). Quali comandi OpenSCAD si possono importare è spiegato nella sezione successiva.</p>
        <Command id="code" />
      </Section>

      <Section id="openscad" title="OpenSCAD">
        <p>Un file <code>.scad</code> si legge come codice, si valuta e diventa oggetti veri della scena, in un solo passo di Annulla. Quello che non si capisce viene saltato e, se manca qualcosa, si apre una finestra con ogni problema, la riga e un frammento del codice originale. Il codice che Construct genera usa solo comandi che la stessa importazione sa rileggere.</p>
        <h4>Supportato</h4>
        <ul>
          <li>Primitive: <code>cube</code>, <code>sphere</code>, <code>cylinder</code>, <code>circle</code>, <code>square</code>, <code>polygon</code> (anche con <code>paths</code>), <code>text</code> (anche con <code>spacing</code>).</li>
          <li>Da 2D a 3D: <code>linear_extrude</code> (anche con torsione), <code>rotate_extrude</code>, <code>offset</code>.</li>
          <li>Trasformazioni: <code>translate</code>, <code>rotate</code>, <code>scale</code>, <code>mirror</code>, <code>resize</code>, <code>multmatrix</code>, <code>color</code> (nomi CSS, esadecimali e terne).</li>
          <li>Booleane, inviluppo e somma di Minkowski: <code>union</code>, <code>difference</code>, <code>intersection</code>, <code>hull</code>, <code>minkowski</code>, <code>intersection_for</code>, <code>render</code>.</li>
          <li>Linguaggio: variabili, <code>module</code> e <code>function</code>, <code>children()</code>, <code>for</code>, <code>if</code>, <code>let</code>, list comprehension, funzioni anonime, intervalli <code>[inizio:passo:fine]</code>, operatori matematici e logici, modificatori <code>*</code>, <code>%</code> e <code>!</code>.</li>
          <li>Funzioni: trigonometriche (in gradi), <code>abs</code>, <code>sqrt</code>, <code>pow</code>, <code>exp</code>, <code>ln</code>, <code>log</code>, <code>floor</code>, <code>ceil</code>, <code>round</code>, <code>sign</code>, <code>min</code>, <code>max</code>, <code>len</code>, <code>norm</code>, <code>cross</code>, <code>concat</code>, <code>str</code>, <code>chr</code>, <code>ord</code>, <code>lookup</code>, <code>search</code>, <code>rands</code> e i controlli <code>is_undef</code>, <code>is_num</code>, <code>is_list</code>, <code>is_string</code>, <code>is_bool</code>, <code>is_function</code>.</li>
          <li>Qualità delle curve: <code>$fn</code>, <code>$fa</code> e <code>$fs</code>. <code>echo</code> e <code>assert</code> vengono ignorati.</li>
        </ul>
        <h4>Supportato con limiti</h4>
        <ul>
          <li><code>text</code>: il font si cerca tra quelli di Construct (vedi la sezione Font) e la posizione è stimata, perché le misure dei glifi possono differire da quelle di OpenSCAD.</li>
          <li><code>color</code>: la trasparenza (alpha) si scarta, la scena non ha trasparenza per oggetto.</li>
          <li><code>offset</code> annidati (apertura e chiusura): si sommano in un contorno netto, ma le punte non vengono arrotondate come in OpenSCAD. <code>offset(chamfer = true)</code> dà angoli vivi.</li>
          <li><code>linear_extrude</code> con <code>scale</code> diversa per X e Y: vale un solo valore.</li>
          <li><code>minkowski</code>: corretto e veloce con solidi separati o con facce piane; con superfici concave molto curve e fitte (per esempio un guscio sferico) il calcolo può richiedere qualche secondo, in secondo piano.</li>
        </ul>
        <h4>Non ancora supportato</h4>
        <ul>
          <li><code>polyhedron</code> e <code>import()</code> di altri file.</li>
          <li><code>use</code> e <code>include</code> di file e librerie (BOSL2, MCAD...): i moduli richiamati risultano sconosciuti.</li>
          <li><code>projection</code>, <code>surface</code>, <code>roof</code> e <code>fill</code>.</li>
          <li>Funzioni poco usate come <code>parent_module</code>, <code>textmetrics</code> e i dizionari (<code>object</code>, <code>has_key</code>).</li>
        </ul>
        <p>L&apos;elenco di ciò che manca, con la difficoltà di ciascun comando, è tenuto aggiornato in <code>docs/da-fare.md</code>.</p>
      </Section>

      <Section id="font" title="Font">
        <p>Il testo e i simboli usano questi font, tutti di <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">Google Fonts</a> con licenza SIL Open Font License: si possono usare e ridistribuire liberamente. Sono inclusi nell&apos;app (funzionano anche offline) e finiscono nello ZIP dell&apos;export OpenSCAD, che li richiama con <code>use &lt;file.ttf&gt;</code> e <code>text(font = &quot;Famiglia:style=Stile&quot;)</code>. Il nome tra parentesi è lo stile del file; il link porta alla pagina del font.</p>
        {[...FONT_CATEGORIES, 'Simboli' as const].map((category) => (
          <div key={category}>
            <h4>{category === 'Simboli' ? 'Simboli ed emoji' : category}</h4>
            <ul>
              {FONTS.filter((f) => f.category === category).map((f) => (
                <li key={f.id}>
                  <a href={googleFontsUrl(f)} target="_blank" rel="noopener noreferrer">{f.family}</a> ({f.style})
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section id="import-export" title="Importare ed esportare">
        <p>Dal menu <strong>Importa</strong> (o trascinando i file nella finestra) si aprono file <strong>STL</strong> e <strong>3MF</strong> (solidi chiusi), <strong>SVG</strong> (diventano forme 2D estruse, con unità in millimetri) e <strong>OpenSCAD</strong>. Dal menu <strong>Esporta</strong> si ottengono STL, 3MF e OpenSCAD.</p>
        <p>L&apos;STL è una mesh unica, il formato più diffuso per gli slicer. Il 3MF conserva i colori, con un oggetto per ogni colore, e contiene tutti i piatti.</p>
      </Section>

      <Section id="salvataggio" title="Salvataggio e progetti">
        <p>Con il <strong>salvataggio automatico</strong> (attivo di default) la scena si salva nel browser a ogni modifica e si ritrova alla riapertura. Dal menu si può anche salvare il progetto in un file da conservare o condividere, e riaprirlo con Apri progetto. Nelle Impostazioni si regolano salvataggio, quote, passi di spostamento e aggancio, e si possono cancellare tutti i dati salvati.</p>
        <Command id="new" />
      </Section>

      <Section id="scorciatoie" title="Scorciatoie">
        <p>Quasi ogni comando ha una scorciatoia da tastiera, indicata anche nei tooltip della barra. L&apos;elenco completo è nel pannello dedicato.</p>
        <p><button type="button" className="docs__link" onClick={() => setPanel('shortcuts')}>Apri le scorciatoie da tastiera</button></p>
      </Section>

      <Section id="faq" title="Domande frequenti">
        <Faq q="Dove sono salvati i miei dati?">
          Solo nel tuo browser (localStorage e IndexedDB): nulla viene inviato a un server. Cambiando browser o dispositivo il progetto non c&apos;è, quindi per spostarlo salvalo in un file dal menu. Dalle Impostazioni puoi cancellare tutti i dati.
        </Faq>
        <Faq q="Funziona offline?">
          Sì: dopo il primo caricamento Construct è una PWA e si usa anche senza connessione. Puoi installarla dal browser.
        </Faq>
        <Faq q="Perché un file .scad non si importa del tutto?">
          L&apos;import legge un sottoinsieme di OpenSCAD. Gli elementi non supportati (per esempio <code>polyhedron</code>, <code>projection</code>, <code>import()</code>) vengono saltati e un avviso li elenca. Controlla l&apos;elenco nella sezione OpenSCAD.
        </Faq>
        <Faq q="STL o 3MF?">
          L&apos;STL contiene solo la forma di un piatto. Il 3MF conserva anche i colori e tutti i piatti: usalo se il tuo slicer lo supporta, altrimenti l&apos;STL va sempre bene.
        </Faq>
        <Faq q="Come si annulla un errore?">
          Con Ctrl+Z (Ctrl+Y per ripetere) o con i pulsanti della barra. Ogni operazione conta un solo passo, anche quelle con anteprima; la linea del tempo mostra la cronologia.
        </Faq>
        <Faq q="Come stampo più piatti?">
          Crea i piatti dalla scheda Piatti e metti su ciascuno i suoi oggetti. L&apos;STL esporta un piatto alla volta (te lo chiede), il 3MF li esporta tutti affiancati.
        </Faq>
        <Faq q="Come faccio un foro o una cavità?">
          Imposta un oggetto come Foro e uniscilo a un solido, oppure usa Guscio per svuotare un pezzo mantenendo pareti di spessore costante.
        </Faq>
        <Faq q="Il benvenuto compare a ogni avvio: come lo tolgo?">
          Togli la spunta da &quot;Mostra ogni volta&quot; nella schermata di benvenuto o nelle Impostazioni. Dal menu la schermata si riapre sempre.
        </Faq>
      </Section>
      </div>
    </div>
  );
}
