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
  { id: 'profilo', title: 'Disegnare un Profilo' },
  { id: 'quote', title: 'Quote e vincoli del Profilo' },
  { id: 'ripetizioni', title: 'Ripetizioni' },
  { id: 'rilievi', title: 'Pattern e rilievi' },
  { id: 'texture', title: 'Texture da immagine (sperimentale)' },
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
        <p>Per una forma 2D disegnata a mano c&apos;è il <strong>Profilo</strong>: dalla libreria 2D, dal tasto destro sul vuoto o con <strong>Maiusc+P</strong> su un Profilo selezionato si apre una finestra di disegno con Penna, forme base, quote e vincoli. Come si usa è spiegato nelle sezioni <strong>Disegnare un Profilo</strong> e <strong>Quote e vincoli del Profilo</strong>.</p>
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

      <Section id="profilo" title="Disegnare un Profilo">
        <p>Il <strong>Profilo</strong> è una forma 2D disegnata a mano con curve di Bézier, che poi diventa un solido per estrusione. Serve per tutto ciò che non si ottiene con le forme della libreria: una staffa, una sagoma, un logo, un pezzo con una curva particolare. I disegni con misure esatte si fanno con le quote e i vincoli, spiegati nella sezione successiva.</p>

        <h4>Aprire il disegno</h4>
        <ol>
          <li>Scegli un Profilo dalla libreria 2D, oppure clic destro sul vuoto, oppure seleziona un Profilo già creato e premi <strong>Maiusc+P</strong> (o il pulsante nelle Proprietà).</li>
          <li>Si apre la finestra di disegno, con gli strumenti in alto, il disegno al centro, l’anteprima 3D e le opzioni a destra.</li>
          <li>Premi <strong>OK</strong> per applicare: la scena cambia in un solo passo di Annulla. Con Esc, se hai modificato qualcosa, ti viene chiesta conferma prima di chiudere.</li>
        </ol>

        <h4>Penna, Seleziona e Sposta vista</h4>
        <p>Con la <strong>Penna</strong> (P):</p>
        <ul>
          <li>un clic mette uno spigolo; un clic e trascina disegna una curva (si trascina la maniglia); tenendo premuto Alt (Opzione su Mac) durante il trascinamento il nodo resta uno spigolo;</li>
          <li>un clic su una curva già disegnata vi inserisce un nodo (Ctrl o ⌘ sospende l’inserimento);</li>
          <li>un clic su un estremo aperto riprende quel contorno;</li>
          <li>un clic sul primo nodo chiude il contorno; Invio, doppio clic o Esc lo terminano senza chiuderlo; Backspace toglie l’ultimo nodo.</li>
        </ul>
        <p>Con <strong>Seleziona</strong> (V):</p>
        <ul>
          <li>si trascinano nodi e maniglie; con il riquadro si scelgono più nodi (Maiusc aggiunge);</li>
          <li>un clic su una curva seleziona tutto il contorno, che si trascina anche dal riempimento;</li>
          <li>un doppio clic su un nodo ne cambia il tipo; Canc elimina i nodi scelti e le frecce li spostano di un passo di griglia (Maiusc: dieci passi).</li>
        </ul>
        <p>Con <strong>Sposta vista</strong> (H, la mano) si sposta il disegno nella vista; si può anche tenere premuto Spazio, oppure usare il tasto centrale o destro del mouse. La rotella ingrandisce. Annulla e Ripeti agiscono sul disegno, un passo alla volta: con la Penna ogni punto è un passo.</p>

        <h4>Forme base, Importa SVG e fori</h4>
        <ul>
          <li><strong>Rettangolo</strong> (R), <strong>Ellisse</strong> (C) e <strong>Poligono regolare</strong> (G, con il campo Lati): premi sul centro e trascina. Con Maiusc ottieni un quadrato, un cerchio o un poligono con l’angolo a multipli di 15°. Nascono come contorni normali, che poi si modificano nodo per nodo.</li>
          <li><strong>Importa SVG</strong> (pulsante in alto) aggiunge al disegno i contorni di un file SVG, conservandone le curve. Le misure sono in millimetri; non si leggono i fogli di stile (<code>style</code>) né gli <code>use</code>.</li>
          <li><strong>Fori</strong>: un contorno disegnato dentro un altro diventa un foro. Nell’elenco Percorsi compare il badge Foro.</li>
        </ul>

        <h4>Cerchio quotato, per i fori rotondi</h4>
        <ol>
          <li>Scegli lo strumento Cerchio (O), premi sul centro e trascina fino al raggio che vuoi.</li>
          <li>Il cerchio nasce con la quota del diametro (Ø): un clic sull’etichetta o sulla curva e digiti il valore esatto.</li>
          <li>Il centro si sposta trascinandolo (si muove il cerchio intero) oppure si quota come un nodo, per esempio con la distanza da un lato.</li>
          <li>Se il cerchio sta dentro un altro contorno è un foro. Il raggio di raccordo, il tipo di nodo e le maniglie non valgono sul cerchio.</li>
        </ol>

        <h4>Arrotondare uno spigolo con il Raggio</h4>
        <ol>
          <li>Con Seleziona scegli un nodo che sia uno spigolo tra due segmenti dritti.</li>
          <li>Nella sezione <strong>Punto selezionato</strong> scrivi il <strong>Raggio</strong> in millimetri.</li>
          <li>Lo spigolo diventa un arco tangente ai due lati. Se i segmenti non bastano il raggio si riduce e un messaggio lo dice.</li>
          <li>Con più nodi scelti il Raggio vale per tutti gli spigoli compatibili. Disegno, anteprima 3D, solido e codice OpenSCAD sono identici.</li>
        </ol>

        <h4>Estrusione lineare o rotazionale</h4>
        <p>Nella sezione <strong>Estrusione</strong> si sceglie come il disegno diventa solido. <strong>Lineare</strong>: si regolano Altezza, Torsione e Scala cima. <strong>Rotazionale</strong>: il disegno ruota attorno all’asse, con Angolo e Segmenti; il raggio è la distanza del disegno dall’asse, quindi si cambia spostando il disegno. Il pulsante <strong>Inverti asse di simmetria</strong> specchia la vista senza cambiare dati né solido. L’anteprima 3D si aggiorna mentre disegni.</p>

        <h4>Sagoma di rotazione (sperimentale)</h4>
        <p>È una funzione sperimentale: si accende in <strong>Impostazioni &gt; Funzioni sperimentali</strong>, voce «Sagoma di rotazione del Profilo». Con l’estrusione rotazionale la finestra mostra un selettore Profilo, Sagoma, Entrambe. La sagoma è la forma che il solido ha visto dall’alto (cerchio, poligono, rettangolo, stella o forma libera, anche con simmetria) e si modifica con gli stessi strumenti. Con OK il solido segue profilo, sagoma e angolo; nel codice OpenSCAD diventa un poliedro.</p>

        <h4>Convertire una forma in Profilo</h4>
        <p>Cerchio, quadrato, forme poligonali, profilati e SVG importati si trasformano in un Profilo modificabile con <strong>Converti in profilo</strong>, dal menu contestuale o dal pulsante nelle Proprietà. Il solido resta uguale e un solo Annulla riporta tutto com’era. L’eccezione è il cerchio con più di 12 lati, che diventa una curva e cambia di poco. Il testo non si converte.</p>
      </Section>

      <Section id="quote" title="Quote e vincoli del Profilo">
        <p>Le quote e i vincoli servono a disegnare con misure esatte e a tenere la forma quando la si modifica, come nei programmi CAD professionali. Si trovano nella finestra del Profilo: lo strumento <strong>Quota</strong> (D) e, nella colonna di destra, la sezione <strong>Quote e vincoli</strong> con l’elenco di tutto ciò che hai aggiunto.</p>

        <h4>Quote: fissare una misura</h4>
        <ol>
          <li>Scegli lo strumento <strong>Quota</strong> (D). Accanto agli strumenti scegli il modo: <strong>Allineata</strong> (distanza in linea retta), <strong>Orizzontale</strong>, <strong>Verticale</strong> oppure <strong>Angolo</strong>.</li>
          <li>Clicca un segmento, oppure due nodi. Per l’angolo clicca due segmenti (se hanno un nodo in comune è l’angolo tra i due lati).</li>
          <li>Digita il valore (millimetri, o gradi per l’angolo) e premi Invio: i nodi si spostano fino alla misura. Esc annulla.</li>
          <li>Per cambiare il valore più tardi clicca l’etichetta della quota sul disegno, oppure usa il campo <strong>Valore</strong> nell’elenco a destra. Con × o con Canc la quota si elimina.</li>
        </ol>
        <p>Su un segmento curvo la quota misura la distanza tra i due nodi (la corda).</p>

        <h4>Spostare le quote</h4>
        <p>Ogni quota nasce fuori dal disegno e senza sovrapporsi alle altre. Per spostarla, con Seleziona trascina l’<strong>etichetta</strong> (si muove lungo la linea) oppure la <strong>linea di quota</strong> (si allontana o si avvicina al disegno): è un passo di Annulla. Il pulsante <strong>Riposiziona quote</strong> ridispone tutte le quote di lunghezza in un colpo solo.</p>

        <h4>Quote di riferimento</h4>
        <p>Se una quota è già implicata dagli altri vincoli, o andrebbe in conflitto, non viene applicata e compare una barra con il pulsante <strong>Aggiungi come quota di riferimento</strong>. La quota di riferimento mostra la misura tra parentesi ma non vincola il disegno. Nell’elenco il pulsante <strong>Rendi pilotante</strong> la trasforma in una quota vera, se il disegno lo permette.</p>

        <h4>Vincoli: tenere la forma</h4>
        <p>I vincoli sono regole geometriche: Orizzontale, Verticale, Coincidente, Fisso, Parallelo, Perpendicolare, Uguale, Punto medio, Simmetrico e Collineare. Come si usano:</p>
        <ol>
          <li>Scegli ciò che serve. I <strong>nodi</strong> si scelgono con Seleziona (Maiusc+clic per più nodi); i <strong>segmenti</strong> con Alt+clic (Maiusc+Alt+clic per aggiungere un secondo segmento). Sotto i pulsanti un testo dice che cosa hai scelto.</li>
          <li>I pulsanti dei vincoli si accendono solo se la scelta basta. Ogni pulsante ha un tooltip con ciò che serve: per esempio Orizzontale vuole un segmento o due nodi, Coincidente due nodi, Fisso uno o più nodi, Parallelo, Perpendicolare, Uguale e Collineare due segmenti, Punto medio un nodo e un segmento, Simmetrico due nodi e un segmento che fa da asse.</li>
          <li>Premi il pulsante: il vincolo compare nell’elenco e il disegno si aggiorna. Da quel momento, trascinando un nodo, quelli vincolati lo seguono rispettando i vincoli.</li>
          <li>Per togliere un vincolo usa × nell’elenco, o Annulla.</li>
        </ol>

        <h4>Stato del disegno e conflitti</h4>
        <p>In fondo alla finestra una voce dice a che punto sei: <strong>sottovincolato</strong> (con i gradi di libertà che restano, cioè i modi in cui il disegno si può ancora muovere), <strong>completamente vincolato</strong> (0 gradi di libertà) oppure <strong>sovravincolato</strong>. I nodi completamente vincolati cambiano colore, quelli in conflitto diventano rossi. Un vincolo o una quota che metterebbe il disegno in conflitto non si applica: un messaggio spiega con quali vincoli andrebbe in conflitto.</p>

        <h4>Penna con lunghezza e angolo digitati</h4>
        <ol>
          <li>Con la Penna, dopo il primo nodo, digita una cifra (o premi Tab): vicino al nodo si aprono i campi <strong>Lunghezza</strong> e <strong>Angolo</strong>.</li>
          <li>Scrivi i valori; Tab passa da un campo all’altro. L’angolo è in gradi dall’asse X, in senso antiorario. Un campo lasciato vuoto segue il cursore.</li>
          <li>Invio crea il nodo e le quote corrispondenti, già posizionate fuori dal disegno. Esc chiude i campi senza toccare il disegno.</li>
        </ol>

        <h4>Vincoli automatici</h4>
        <p>Mentre disegni con la Penna, i vincoli ovvi si aggiungono da soli: un segmento entro 3 gradi dall’orizzontale o dalla verticale lo diventa, uno quasi perpendicolare al precedente lo diventa, un nodo sopra un altro nodo è coincidente. Il rettangolo nasce con i lati orizzontali e verticali. La casella <strong>Vincoli automatici</strong> è nella sezione Quote e vincoli e in <strong>Impostazioni &gt; Profilo</strong>; è accesa di default e la scelta si ricorda. Un vincolo aggiunto da solo si toglie dall’elenco o con Annulla.</p>

        <h4>Parametri ed espressioni</h4>
        <ol>
          <li>Nella sezione <strong>Parametri</strong> della colonna di destra scrivi un nome (una parola senza spazi, per esempio <code>larghezza</code>) e un valore, poi premi Aggiungi o Invio. Sono i parametri del Profilo, distinti da quelli del progetto.</li>
          <li>Nelle quote, nel diametro dei cerchi e nel raggio scrivi un’espressione al posto del numero, per esempio <code>larghezza/2 + 3</code>. L’etichetta mostra ƒ e il valore calcolato.</li>
          <li>Cambiando un parametro tutte le quote si rileggono e il disegno si risolve in un solo passo. Se un valore non è raggiungibile non cambia nulla.</li>
        </ol>
        <p>Un parametro usato da una quota non si può eliminare. Il Raggio di raccordo accetta un’espressione ma ricorda solo il numero calcolato.</p>

        <h4>Selezione multipla</h4>
        <ul>
          <li><strong>Raggio comune</strong>: con più nodi scelti il campo Raggio vale per tutti gli spigoli compatibili.</li>
          <li><strong>Rendi uguali</strong>: nell’elenco, Maiusc+clic sul nome di più quote le sceglie insieme. Compare un campo Valore comune per le lunghezze dello stesso tipo e, per due o più distanze, il pulsante <strong>Rendi uguali</strong>: la prima quota resta e le altre diventano di riferimento. Canc elimina tutte le quote scelte e Annulla le ripristina in un passo.</li>
        </ul>

        <h4>Se ridimensioni il Profilo</h4>
        <p>Se ridimensioni un Profilo che ha quote (con Ridimensiona, o dalle proprietà), le quote non si aggiornano da sole: aprendo il disegno un avviso dice di quanto è stato scalato (o di quanto il disegno si discosta dalle quote). Alla prossima modifica i nodi tornano alle misure delle quote, quindi per cambiare le dimensioni di un Profilo quotato modifica i valori delle quote. I parametri del Profilo non si scalano.</p>
      </Section>

      <Section id="ripetizioni" title="Ripetizioni">
        <p>Serie e Pattern creano gruppi modificabili: si cambiano i parametri, non le singole copie. I tipi di Pattern in rilievo (mattoni, borchie, rame, legno e, come funzione sperimentale, immagine) sono spiegati nella sezione Pattern e rilievi.</p>
        <Command id="array" />
        <Command id="pattern" />
      </Section>

      <Section id="rilievi" title="Pattern e rilievi">
        <p>Il <strong>Pattern</strong> (tasto Z) ripete un disegno su una faccia del pezzo. Nella tendina <strong>Tipo</strong> ci sono due famiglie, che si comportano in modo diverso:</p>
        <ul>
          <li><strong>Celle</strong> (Voronoi, Esagoni, Cerchi, Rombi, Triangoli): <em>forano</em> il pezzo, in modo passante o a tasca. Servono per griglie di alleggerimento, aerazione, decorazioni traforate.</li>
          <li><strong>Rilievo</strong> (Mattoni, Borchie, Rame battuto, Legno, e Immagine se attivata): <em>non forano</em>. Danno alla faccia una texture, scavando piccole fughe o aggiungendo bozze, e il pezzo resta pieno.</li>
        </ul>

        <h4>Come si applica un Pattern</h4>
        <ol>
          <li>Seleziona un solo oggetto e premi <strong>Z</strong> (o il pulsante Pattern). Parte dalla faccia superiore, quella rivolta verso +Z.</li>
          <li>Scegli il <strong>Tipo</strong> dalla tendina.</li>
          <li>Per usare un’altra faccia premi <strong>Scegli faccia</strong> e clicca una faccia piana dell’oggetto, anche inclinata; Esc termina la scelta. Il Pattern agisce su una faccia alla volta: per decorare un’altra faccia applicalo di nuovo.</li>
          <li>Regola i campi guardando l’anteprima dal vivo nella vista 3D. Il <strong>Margine</strong> è la cornice piena che resta attorno al disegno.</li>
          <li><strong>OK</strong> (o Invio) conferma, Esc annulla. Il risultato è un solo gruppo <strong>Pattern</strong>, un solo passo di Annulla: dalle Proprietà si cambiano ancora tipo e parametri, non le singole celle.</li>
        </ol>
        <p>Se il pezzo cambia misura dopo il Pattern, il pulsante <strong>Aggiorna all’ingombro</strong> nelle Proprietà ricalcola il disegno sulle misure attuali.</p>

        <h4>Pattern a celle (forano)</h4>
        <p>Con <strong>Voronoi</strong> le celle sono casuali ma riproducibili: lo stesso <strong>Seme</strong> dà sempre lo stesso disegno (<strong>Nuovo seme</strong> ne propone un altro) e si regolano Celle e Regolarità. Con gli altri tipi si regolano <strong>Passo</strong> e <strong>Rotazione</strong> della griglia. Per tutti: <strong>Modo</strong> (Fori: si tolgono le celle e restano le pareti; Solchi: si tolgono le pareti), <strong>Parete</strong>, <strong>Arrotondamento</strong> e <strong>Profondità</strong> (0 = passante; con una tasca puoi scegliere se partire da una faccia sola o da entrambe). Una parete sotto 0,8 mm è segnalata, perché in stampa è inaffidabile.</p>

        <h4>Mattoni</h4>
        <ol>
          <li>Scegli Tipo Mattoni e il <strong>Disegno</strong>: <strong>Sfalsati</strong> (file sfalsate di mezzo mattone), <strong>Spina di pesce</strong> o <strong>Cesto</strong> (la lunghezza del mattone si arrotonda a un multiplo dell’altezza, fuga compresa, perché il disegno si chiuda).</li>
          <li>Imposta <strong>Larghezza mattone</strong> e <strong>Altezza mattone</strong> (la fuga è esclusa), la <strong>Fuga</strong> e la <strong>Profondità fuga</strong>.</li>
        </ol>
        <p>Sono le fughe a essere scavate: i mattoni restano a livello della faccia. Consigli: fuga di almeno 0,8 mm (sotto, un avviso dice che tende a chiudersi in stampa); una profondità di qualche strato basta per vedere il disegno e non può superare lo spessore del pezzo meno 0,2 mm.</p>

        <h4>Borchie</h4>
        <ol>
          <li>Scegli Tipo Borchie e la forma nella tendina <strong>Disegno</strong>: <strong>Cupola</strong>, <strong>Cilindro smussato</strong> (con il campo Smusso) o <strong>Piramide</strong> (il lato è pari al diametro).</li>
          <li>Scegli la <strong>Griglia</strong>: <strong>Quadrata</strong> (file allineate) o <strong>Sfalsata</strong> (le file dispari spostate di mezzo passo).</li>
          <li>Imposta <strong>Passo</strong> (distanza tra i centri), <strong>Raggio</strong> e <strong>Altezza</strong>.</li>
        </ol>
        <p>Le borchie si aggiungono alla faccia: <strong>il pezzo cresce</strong> dell’altezza della borchia, quindi controlla che stia ancora nel volume di stampa. Avvisi e consigli: tra due basi servono almeno 0,8 mm, quindi passo di almeno 2 × raggio + 0,8 mm; raggio di almeno 1 mm e altezza di almeno 0,4 mm; la cupola non supera il suo raggio, perché più alta avrebbe un sottosquadro.</p>

        <h4>Rame battuto</h4>
        <ol>
          <li>Scegli Tipo Rame battuto e il <strong>Disegno</strong>: <strong>Martellato</strong> (una calotta per cella casuale), <strong>Sfaccettato</strong> (una faccetta piana inclinata per cella) o <strong>Scaglie</strong> (file sfalsate di calotte ovali che si sovrappongono).</li>
          <li>Il <strong>Seme</strong> decide il disegno; <strong>Nuovo seme</strong> ne prova un altro.</li>
          <li>Regola <strong>Diametro</strong> medio, <strong>Profondità</strong>, <strong>Variazione</strong> (0 = tutte uguali, 0,9 = molto diverse) e, tranne che per le Scaglie, <strong>Regolarità</strong>.</li>
        </ol>
        <p>La superficie si incava. Non ci sono più di 500 celle per faccia: oltre, le celle si allargano e un avviso lo dice. Con la variazione le celle più profonde arrivano a profondità × (1 + variazione), sempre entro lo spessore del pezzo meno 0,2 mm. Con un ugello da 0,4 mm non scegliere diametri troppo piccoli, perché i dettagli si perdono.</p>

        <h4>Legno</h4>
        <ol>
          <li>Scegli Tipo Legno e il <strong>Disegno</strong>: <strong>Doghe</strong> (file di doghe affiancate con venatura), <strong>Parquet (spina di pesce)</strong> (listelli; la lunghezza si arrotonda a un multiplo della larghezza, fuga compresa) o <strong>Tavola unica</strong> (venatura lunga con da 2 a 4 nodi, senza fughe).</li>
          <li>Per doghe e parquet imposta larghezza, lunghezza, <strong>Fuga</strong> e <strong>Profondità fuga</strong>.</li>
          <li>Per la venatura imposta <strong>Venatura</strong> (profondità massima, 0 = nessuna) e <strong>Anelli</strong> (distanza media tra gli anelli); il <strong>Seme</strong> cambia il disegno.</li>
        </ol>
        <p>Consigli: fuga di almeno 0,8 mm; una venatura sotto 0,3 mm si vede appena in stampa. La venatura è una mappa di altezze con un punto ogni 0,5 mm: su facce grandi il calcolo rallenta, e se serve velocità metti la Venatura a 0.</p>

        <h4>Avvisi, calcolo lento e codice OpenSCAD</h4>
        <p>Sotto i campi compaiono gli avvisi del tipo scelto (profondità ridotta allo spessore del pezzo, fughe troppo strette, borchie troppo vicine). Se il calcolo è lento un avviso in rosso lo dice e suggerisce che cosa ridurre: facce, celle o dettagli. L’anteprima dei rilievi è sempre semplificata, mentre dopo OK il risultato è a qualità piena; la casella <strong>Anteprima semplificata</strong> riguarda i Pattern a celle. Il codice OpenSCAD contiene il risultato già calcolato (celle oppure una mappa di altezze), quindi coincide con l’app, ma con disegni molto fitti può diventare voluminoso e un avviso ne indica il peso.</p>
        <p>Per portare un’immagine come texture vedi la sezione successiva.</p>
      </Section>

      <Section id="texture" title="Texture da immagine (sperimentale)">
        <p className="docs__note"><strong>Funzione sperimentale.</strong> Può essere lenta e conviene provarla con una stampa prima di fidarsi del risultato. È spenta di default: si accende in <strong>Impostazioni &gt; Funzioni sperimentali</strong>, voce «Texture da immagine del Pattern». A funzione spenta il tipo Immagine non compare nel Pattern, ma i Pattern già creati con un’immagine restano modificabili.</p>

        <h4>Come si usa</h4>
        <ol>
          <li>Accendi la funzione nelle Impostazioni, come indicato sopra.</li>
          <li>Seleziona un oggetto, premi Z e, nella tendina Tipo, scegli <strong>Immagine (sperimentale)</strong> (gruppo Rilievo).</li>
          <li>Scegli la <strong>Sorgente</strong>. Dalla libreria: Zigrinatura, Fibra di carbonio, Pelle, Pietra, Tessuto, Onde o Rumore, ciascuna con <strong>tre varianti</strong> (la tendina Variante o le miniature sotto). Oppure <strong>Carica immagine</strong> e scegli un file PNG, JPG o SVG (al massimo 20 MB).</li>
          <li>Guarda la miniatura in grigio, che è ciò che il Pattern usa davvero, e regola i campi qui sotto.</li>
          <li>Premi OK: il risultato è un gruppo Pattern modificabile come gli altri.</li>
        </ol>

        <h4>I campi</h4>
        <ul>
          <li><strong>Modo texture</strong>: <strong>Incavo</strong> (si scava dove l’immagine è più scura del livello medio, è il modo di partenza), <strong>Rilievo</strong> (si aggiunge dove è più chiara), <strong>Entrambi</strong>.</li>
          <li><strong>Piastrella</strong>: la larghezza in mm di una ripetizione dell’immagine sulla faccia; l’altezza segue le proporzioni. La casella <strong>Ripetizione</strong> la ripete su tutta la faccia; spenta, l’immagine compare una volta sola.</li>
          <li><strong>Rotazione</strong> e <strong>Scostamento X</strong> e <strong>Y</strong>: girano e spostano l’immagine sulla faccia.</li>
          <li><strong>Inversione</strong>: scambia il nero e il bianco (il bianco è la quota alta).</li>
          <li><strong>Livello medio</strong>: il grigio che resta a livello della faccia; più chiaro si rialza, più scuro si scava.</li>
          <li><strong>Ampiezza</strong>: la quota massima della texture in mm. L’incavo non supera lo spessore del pezzo meno 0,2 mm.</li>
          <li><strong>Sfocatura</strong>: in pixel dell’immagine, toglie la grana dei JPG e i gradini dei pixel grandi.</li>
        </ul>

        <h4>Che cosa succede all’immagine</h4>
        <p>L’immagine si converte in scala di grigi (la trasparenza conta come bianco) e si riduce a 512 pixel sul lato maggiore. Il progetto conserva solo questo grigio, una volta sola anche se lo usano più Pattern: il file originale non viene salvato. Nel codice OpenSCAD l’immagine è esportata come mappa di altezze (<code>zmap</code>), in un solo file.</p>

        <h4>Limiti e consigli</h4>
        <ul>
          <li>La texture vale su una <strong>faccia piana</strong> alla volta (anche inclinata): non avvolge un oggetto curvo né deforma una mesh intera.</li>
          <li>L’<strong>ampiezza</strong> deve superare lo strato di stampa: sotto 0,2 mm un avviso dice che la texture non si vede.</li>
          <li>Se i pixel dell’immagine misurano più di 0,3 mm sulla faccia compare un avviso: l’aspetto sarà a gradini. Riduci la piastrella o aumenta la sfocatura.</li>
          <li>La mappa ha un punto ogni 0,5 mm: su facce grandi o con molte ripetizioni il calcolo può essere lento e il file <code>.scad</code> molto grande. Riduci la faccia o scegli una texture meno fitta.</li>
          <li>Le immagini con buon contrasto e pochi dettagli minuti funzionano meglio: con un ugello da 0,4 mm i particolari più piccoli non si stampano.</li>
        </ul>
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
        <h4>Nella scena</h4>
        <ul>
          <li><strong>Z</strong>: Pattern (Invio conferma, Esc annulla). <strong>O</strong>: Serie. <strong>Maiusc+P</strong>: apre il disegno del Profilo selezionato.</li>
        </ul>
        <h4>Nella finestra del Profilo</h4>
        <ul>
          <li><strong>V</strong> Seleziona, <strong>P</strong> Penna, <strong>H</strong> Sposta vista (anche Spazio premuto).</li>
          <li><strong>R</strong> Rettangolo, <strong>C</strong> Ellisse, <strong>G</strong> Poligono regolare, <strong>O</strong> Cerchio quotato.</li>
          <li><strong>D</strong> Quota. Alt+clic su un segmento lo sceglie per i vincoli; Maiusc+clic aggiunge nodi o quote alla scelta.</li>
          <li><strong>Invio</strong> termina il contorno, <strong>Canc</strong> elimina nodi o quote scelti, le <strong>frecce</strong> spostano i nodi (Maiusc: dieci passi), <strong>Ctrl+Z</strong> e <strong>Ctrl+Maiusc+Z</strong> annullano e ripetono il disegno, <strong>Esc</strong> termina o chiude.</li>
        </ul>
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
        <Faq q="Perché un vincolo o una quota non si applica?">
          Perché metterebbe il disegno in conflitto con altri vincoli, oppure è già implicato da quelli che ci sono (il disegno è sovravincolato). Un messaggio dice con quali vincoli andrebbe in conflitto. Puoi togliere il vincolo che disturba dall&apos;elenco Quote e vincoli, oppure aggiungere la misura come quota di riferimento: compare tra parentesi e non vincola. Se manca la scelta giusta, il tooltip del pulsante dice che cosa servirebbe (per esempio due segmenti con Alt+clic).
        </Faq>
        <Faq q="Come sposto una quota del Profilo?">
          Con Seleziona trascina l&apos;etichetta, che si muove lungo la linea, oppure la linea di quota, che si allontana o si avvicina al disegno. Il pulsante Riposiziona quote le ridispone tutte fuori dal disegno e senza sovrapposizioni. Per cambiarne il valore clicca l&apos;etichetta.
        </Faq>
        <Faq q="Perché le quote non seguono il Profilo ridimensionato?">
          Ridimensionando un Profilo i valori delle quote non vengono riscritti: un avviso nella finestra del Profilo dice di quanto è stato scalato e, finché non lo modifichi, il disegno non cambia. Alla prossima modifica del disegno i nodi tornano alle misure delle quote. Per cambiare le dimensioni di un Profilo quotato modifica i valori delle quote.
        </Faq>
        <Faq q="Perché il Pattern a rilievo non fora?">
          È il suo scopo. I tipi del gruppo Celle (Voronoi, Esagoni, Cerchi, Rombi, Triangoli) forano il pezzo; i tipi del gruppo Rilievo (Mattoni, Borchie, Rame battuto, Legno e, come funzione sperimentale, Immagine) scavano fughe o aggiungono bozze sulla faccia e lasciano il pezzo pieno. Le Borchie, in più, fanno crescere il pezzo dell&apos;altezza della borchia. Per forare scegli un tipo a celle.
        </Faq>
        <Faq q="Come uso un&apos;immagine come texture?">
          È una funzione sperimentale: accendila in Impostazioni &gt; Funzioni sperimentali (Texture da immagine del Pattern). Poi seleziona il pezzo, premi Z, scegli il tipo Immagine (sperimentale), carica un PNG, JPG o SVG (o scegli un esempio della libreria) e regola modo, piastrella e ampiezza. Tutti i passi sono nella sezione Texture da immagine.
        </Faq>
        <Faq q="Il benvenuto compare a ogni avvio: come lo tolgo?">
          Togli la spunta da &quot;Mostra ogni volta&quot; nella schermata di benvenuto o nelle Impostazioni. Dal menu la schermata si riapre sempre.
        </Faq>
      </Section>
      </div>
    </div>
  );
}
