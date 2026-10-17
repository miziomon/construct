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
  { id: 'parametri', title: 'Parametri e formule' },
  { id: 'avvisi', title: 'Avvisi di stampabilità' },
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
        <p>Il risultato si esporta in <strong>STL</strong> e <strong>3MF</strong>, pronti per lo slicer, oppure come <strong>codice OpenSCAD</strong> equivalente; un&apos;<strong>immagine PNG</strong> con le quattro viste (alto, fronte, lato, isometrica) in una griglia 2×2, utile per documentare il pezzo: nel passo Immagine scegli lo sfondo (tema attuale, bianco o trasparente) e, con più piatti, quale fotografare. Si possono importare file STL, 3MF, SVG e OpenSCAD.</p>
        <p>Tutto resta sul tuo dispositivo: nulla viene inviato a un server, e Construct funziona anche offline come PWA. Il progetto è open source (licenza MIT) su <a href="https://github.com/miziomon/construct" target="_blank" rel="noopener noreferrer">github.com/miziomon/construct</a>, realizzato da Maurizio Pelizzone / MAVIDA.</p>
        <h4>Per chi è</h4>
        <p>Per chi stampa in 3D e vuole modellare rapidamente i propri pezzi: supporti, scatole, adattatori, ricambi e piccoli oggetti, con misure esatte in millimetri.</p>
        <h4>Cosa non è</h4>
        <p>Non è un programma di scultura né di disegno tecnico quotato: non ci sono pennelli per modellare in modo organico e non si producono tavole con quote e viste normalizzate.</p>
      </Section>

      <Section id="primi-passi" title="Primi passi">
        <p>Construct è diviso in quattro aree. A sinistra la <strong>libreria</strong> con le forme 3D e 2D, i simboli e le emoji: un clic aggiunge la forma al centro del piatto. Al centro la <strong>vista 3D</strong>, dove si selezionano e si spostano gli oggetti. In alto la <strong>barra strumenti</strong> con i comandi, e a destra le <strong>proprietà</strong> dell&apos;oggetto selezionato (nome, posizione, rotazione, misure, colore), con in fondo gli avvisi di stampabilità. Sotto la libreria, sulla barra di sinistra, c&apos;è l&apos;<strong>elenco degli oggetti</strong>, con le schede dei piatti e dei parametri: la maniglia tra le due sezioni si trascina per cambiarne l&apos;altezza (doppio clic: misura iniziale; con il fuoco, le frecce su e giù), e la misura si ricorda.</p>
        <p>Per una forma 2D disegnata a mano c&apos;è il <strong>Profilo</strong>: dalla libreria 2D, dal tasto destro sul vuoto o con <strong>Maiusc+P</strong> su un Profilo selezionato si apre una finestra di disegno con la <strong>Penna</strong> (clic per uno spigolo, clic e trascina per una curva, con Alt (Opzione su Mac) premuto durante il trascinamento il nodo è uno spigolo, un clic su una curva già disegnata vi inserisce un nodo, un clic su un estremo aperto riprende quel contorno, clic sul primo nodo per chiudere, trascinando ne disegni la maniglia) e lo strumento <strong>Seleziona</strong> per spostare nodi e maniglie (un clic su una curva seleziona tutto il contorno, che si trascina anche dal riempimento) e lo strumento <strong>Sposta vista</strong> (H, la mano) per spostare la vista; si sposta anche con Spazio o con il tasto centrale o destro. Le <strong>forme base</strong> Rettangolo (R), Ellisse (C) e Poligono regolare (G, con il campo Lati) si trascinano dal centro (Maiusc: quadrato, cerchio, angolo a 15°) e nascono come contorni modificabili; <strong>Importa SVG</strong> aggiunge i contorni di un file SVG conservandone le curve (non si leggono <code>style</code> e <code>use</code>). Cerchio, quadrato, forme poligonali, profilati e SVG si trasformano in un Profilo con <strong>Converti in profilo</strong> (menu contestuale o Proprietà), a solido invariato, tranne per i cerchi con più di 12 lati, che diventano una curva. In rotazione il pulsante <strong>Inverti asse di simmetria</strong> specchia la vista. I contorni dentro altri diventano fori, l&apos;estrusione può essere lineare o rotazionale e l&apos;anteprima 3D si aggiorna mentre disegni. Con OK la scena cambia in un solo passo.</p>
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
        <p>Rifiniture pensate per la stampa: raccordi e smussi sugli spigoli, guscio per svuotare, taglio in due parti, specchiatura e allineamento, e due comandi per mettere il pezzo nel verso giusto sul piatto.</p>
        <Command id="extrude" />
        <Command id="fillet" />
        <Command id="chamfer" />
        <Command id="corner" />
        <Command id="shell" />
        <Command id="split" />
        <p>Con <strong>Dividi</strong> il piano di taglio si sceglie per asse e quota, e si può inclinare: imposta l&apos;<strong>angolo</strong> (45° per un taglio diagonale) e l&apos;asse attorno a cui il piano ruota. Le due metà restano due oggetti parametrici (intersezioni con un cubo di taglio) che si possono ancora spostare o ruotare.</p>
        <p>Nella sezione <strong>Connettori</strong> si aggiungono gli incastri per rimontare il pezzo: il <strong>Perno</strong> è unito a una metà e ha la sede nell&apos;altra; con le <strong>Spine</strong> ogni metà ha un foro e le spine compaiono in un oggetto a parte, sdraiate sul piatto. Si sceglie la forma (tonda o quadrata), il diametro, la profondità, il numero, la distanza tra i centri e la posizione della fila rispetto al centro del taglio. La <strong>tolleranza</strong> è il gioco per lato tra perno e sede (0,2 mm va bene per la maggior parte delle stampanti): senza, dopo la stampa l&apos;incastro non entra. Se un connettore esce dal pezzo compare un avviso e la sua sagoma diventa rossa.</p>
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

      <Section id="parametri" title="Parametri e formule">
        <p>Un <strong>parametro</strong> è una misura con un nome, come una variabile di OpenSCAD: <code>spessore = 2</code>. Si creano e si modificano nella finestra <strong>Parametri</strong> (menu, voce Parametri…, oppure il pulsante Gestisci parametri… della scheda Parametri a destra), con nome, formula e nota; valgono per tutti i piatti. Un parametro può usare altri parametri (<code>altezza = 2 * spessore</code>); i nomi hanno solo lettere senza accenti, cifre e trattino basso. La scheda <strong>Parametri</strong> della barra sinistra, accanto a Oggetti e Piatti, ne mostra l&apos;elenco, in sola lettura: un clic sul nome seleziona nella vista gli oggetti che lo usano. Rinominare un parametro usato chiede conferma elencando chi viene aggiornato.</p>
        <p>Per legare un campo a un parametro fai <strong>doppio clic sul nome del campo</strong> nel pannello Proprietà (Altezza, Raggio, Posizione X...): si apre un piccolo selettore con i parametri e una riga Formula, dove puoi scrivere anche un calcolo (<code>2 * spessore + 1</code>); con <strong>Nuovo parametro…</strong> ne crei uno al volo, senza aprire la finestra. Gli oggetti con campi legati portano l&apos;icona <strong>fx</strong> nell&apos;elenco degli oggetti. Valgono gli operatori, <code>PI</code>, le funzioni <code>min</code>, <code>max</code>, <code>abs</code>, <code>sqrt</code>, <code>round</code>, <code>floor</code>, <code>ceil</code>, <code>sin</code>, <code>cos</code> (angoli in gradi) e il condizionale <code>a ? b : c</code>; i decimali si scrivono col punto, perché la virgola separa gli argomenti. Posizione, rotazione, dimensioni, altezza, Guscio, Ripetizione, Raccordo e Smusso si possono legare.</p>
        <p>Un campo legato non ha più lo slider né il campo da scrivere: mostra l&apos;icona <strong>fx</strong> con il valore, che non si modifica. Cambiando il parametro il campo si ricalcola e l&apos;oggetto si ridimensiona, con la base che resta sul piatto. Il gizmo, le quote e il ridimensionamento proporzionale (tasto R) non cambiano i campi legati: scalano gli altri. Per lo stesso motivo, con una misura legata il <strong>lucchetto delle proporzioni</strong> resta aperto e disattivato (ogni misura libera cambia da sola) finché non togli il parametro. Per tornare alla modifica manuale fai di nuovo doppio clic sul nome del campo e premi <strong>Togli parametro</strong>. Il codice OpenSCAD esportato ha i parametri come variabili in testa, in un blocco <code>/* [Parametri] */</code> che il Customizer di OpenSCAD mostra con i suoi cursori, e i campi legati usano i nomi. Dove il valore è derivato (posizioni dentro un Raggruppa, Raccordi e Smussi, Guscio) il codice ha il numero.</p>
      </Section>

      <Section id="avvisi" title="Avvisi di stampabilità">
        <p>In fondo alla colonna destra, sotto le proprietà, la sezione <strong>Avvisi</strong> elenca i problemi che renderebbero difficile o impossibile la stampa; se ce ne sono, la barra di stato mostra un contatore (&laquo;3 avvisi&raquo;) che la apre. La sezione parte <strong>chiusa</strong>: si apre solo quando lo decidi tu, dall&apos;intestazione o dal contatore. I controlli leggono la geometria già calcolata e si aggiornano da soli, poco dopo ogni modifica; quelli sulle pareti sottili e sulle parti sospese li fa il kernel dopo una breve pausa (con modelli molto complessi possono richiedere qualche secondo, e se superano i sei secondi l&apos;avviso dice che il controllo è incompleto).</p>
        <p>Gli <strong>errori</strong> (in rosso, in cima all&apos;elenco) sono la mesh non valida, l&apos;oggetto che affonda sotto il piano o esce dal volume di stampa (con lo scarto in mm per asse) e le formule che non si calcolano. Le <strong>attenzioni</strong> (in giallo) sono gli oggetti sospesi, non appoggiati al piano né a un altro oggetto, le <strong>pareti sottili</strong> (più sottili della parete minima, 0,8 mm di default: il kernel taglia il pezzo in sezioni lungo i tre assi e toglie ciò che è più stretto del minimo), le <strong>parti staccate e sospese</strong> dentro un oggetto che per il resto sta sul piano (un pezzo che galleggia, ad esempio una cella isolata di un Pattern) e gli <strong>sbalzi</strong>: le superfici rivolte in basso con un&apos;inclinazione dalla verticale oltre l&apos;angolo scelto (45° di default), con la loro area in mm². La faccia appoggiata al piano o sulla cima di un altro oggetto non conta.</p>
        <p>Un clic su un avviso seleziona l&apos;oggetto; sugli sbalzi e sulle pareti sottili mostra anche, in arancione nella vista, le zone coinvolte (un secondo clic le nasconde). Dalle Impostazioni, sezione Stampabilità, si spengono i controlli e si regolano l&apos;angolo di sbalzo, l&apos;altezza utile della stampante e la parete minima. Il controllo delle pareti è un&apos;approssimazione a sezioni (non trova una parete più sottile del passo tra due sezioni se non si estende per più sezioni): non sostituisce l&apos;anteprima dello slicer. Un avviso che non ti interessa (una sfera ha sempre la calotta in sbalzo) si <strong>ignora</strong> con l&apos;icona a destra: finisce nell&apos;elenco Ignorati in fondo alla sezione, da cui si ripristina uno alla volta, oppure tutti insieme con il pulsante <strong>Visualizza tutti</strong> (sempre visibile, anche con l&apos;elenco chiuso); la scelta si salva nel progetto e vale per quell&apos;oggetto e quel tipo di avviso. Sono segnalazioni, non blocchi: la stampa si può esportare comunque.</p>
      </Section>

      <Section id="piatti" title="Piatti e piano di stampa">
        <p>Un progetto può avere più <strong>piatti</strong>, ciascuno con i suoi oggetti: si vede un piatto alla volta e si gestiscono dalla scheda Piatti sotto la libreria. Il 3MF esporta tutti i piatti affiancati, l&apos;STL ne chiede uno.</p>
        <p>Le dimensioni del <strong>piano di stampa</strong> (256 × 256 mm all&apos;inizio) si cambiano dalla barra di stato o dal menu del clic destro nel vuoto, anche con i preset delle stampanti. Il comando Piatto (tasto P) lo mostra o lo nasconde.</p>
        <Command id="bed" />
        <p>Con la finestra stretta (sotto i 1440 px) i pulsanti di vista meno usati (Ortografica, Operandi, Piatto, Tema e Codice) si raccolgono nella tendina <strong>Altro</strong>, con le stesse funzioni e le stesse scorciatoie. Mentre è aperto uno strumento con pannello (Raccordo, Guscio, Dividi, Misura...) la barra si ferma e resta attivo solo il pulsante dello strumento, che si chiude anche con Esc.</p>
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
          <li>Qualità delle curve: <code>$fn</code>, <code>$fa</code> e <code>$fs</code>, con lo scope dinamico di OpenSCAD (valgono anche nei moduli e nelle funzioni richiamati). <code>echo</code> e <code>assert</code> vengono ignorati.</li>
        </ul>
        <h4>Supportato con limiti</h4>
        <ul>
          <li><code>text</code>: il font si cerca tra quelli di Construct (vedi la sezione Font) e la posizione è stimata, perché le misure dei glifi possono differire da quelle di OpenSCAD.</li>
          <li><code>color</code>: la trasparenza (alpha) si scarta, la scena non ha trasparenza per oggetto.</li>
          <li><code>offset</code> annidati (apertura e chiusura): si sommano in un contorno netto, ma le punte non vengono arrotondate come in OpenSCAD. <code>offset(chamfer = true)</code> dà angoli vivi.</li>
          <li><code>linear_extrude</code> con <code>scale</code> diversa per X e Y: vale un solo valore.</li>
          <li><code>minkowski</code>: la “pennellata” (dal secondo operando in poi, se è una sfera, un cilindro o un cono) si calcola con i segmenti che tengono l’errore di corda entro 0,01 mm, invece di quelli del nodo: il risultato differisce al massimo di 0,01 mm e il calcolo è molto più rapido; il codice esportato conserva il <code>$fn</code> originale. Con superfici concave molto curve e fitte (un guscio sferico) il calcolo può comunque richiedere qualche secondo, in secondo piano.</li>
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
