# Audit di SenseLayer rispetto alla track Silent Specs

**Data:** 26 settembre 2026  
**Ambito:** prodotto, accessibilità, modello informativo, architettura, demo e priorità per l’hackathon.  
**Metodo:** analisi del brief, del codice, dei contratti, della documentazione e dei test. Nessuna modifica al progetto durante l’audit. Test automatici: 36 superati su 36; controllo TypeScript superato. Nessuna verifica visiva dal vivo, nuova prova con microfono/modelli reali o validazione con utenti effettuata nell’ambito di questo audit.

## A. Verdetto esecutivo

**Terrei SenseLayer. Cambierei nettamente il prodotto presentato, senza cambiare dominio né riscrivere il motore.**

Il prodotto più forte dentro l’architettura attuale è questo:

> **Recuperare un cambio di piano: prima dovevamo fare X, ora facciamo Y, perché Z. E a me viene chiesto W.**

È un’interpretazione molto diretta di Silent Specs. La visione di una piattaforma universale di percezione, invece, diluisce la submission e introduce promesse che il prototipo non dimostra.

Il problema principale è che **il motore rappresenta la conversazione come stato, mentre l’interfaccia presenta ancora una trascrizione con un riepilogo modale**. L’investimento tecnico non si traduce ancora pienamente nel vantaggio percepibile dall’utente.

C’è anche un problema concreto: **il percorso rapido di attenzione viene rallentato dalla stessa interfaccia che dovrebbe mostrarlo**. Questo va sistemato prima di rivendicare una percezione “a due velocità”.

Ho esaminato codice, contratti, documentazione e test. Ho eseguito i test automatici: **36 superati su 36**, insieme al controllo TypeScript. Non ho modificato il progetto durante l’audit. Il browser non era disponibile: non ho verificato visivamente l’interfaccia né ripetuto la prova con microfono e modelli reali. La vostra prova end-to-end resta un risultato da voi riportato; non equivale a una validazione con utenti.

## B. Quanto SenseLayer risponde davvero alla track

**L’aderenza è forte, ma dipende da cosa fate vedere.**

| Richiesta della track | Situazione attuale | Giudizio |
|---|---|---|
| Recuperare informazioni perse | Catch-up basato sui cambiamenti | Centrato |
| Recuperare il significato | Decisioni, risoluzioni e supersessioni | Buona base, presentazione incompleta |
| Recuperare il motivo di una decisione | Fonti consultabili, motivo non strutturato | Lacuna sostanziale |
| Recuperare una domanda rivolta all’utente | Richieste personali e rilevamento del nome | Centrato, con problemi di latenza e ciclo di vita |
| Recuperare un cambio di istruzioni | Possibile attraverso supersessione | Potenziale forte, poco esplicito nella UI |
| Recuperare mentre la conversazione continua | Snapshot e watermark adeguati; replay messo in pausa dalla UI | Promessa non ancora dimostrata bene |
| Scegliere una situazione specifica | Riunione universitaria | Adeguata, da rendere più concreta |

Non dovete implementare tutti gli esempi degli organizzatori. Conversazioni parallele, suoni ambientali e gaming sono **direzioni alternative**, non una checklist.

La deriva rispetto al brief avviene quando il progetto diventa:

- un sistema di notifiche del nome;
- un assistente generale per riunioni;
- un’architettura di percezione futura raccontata attraverso un diagramma.

La prova decisiva è più semplice: **dopo aver perso un passaggio, la persona capisce cosa è valido adesso e riesce a partecipare?**

## C. Cosa stiamo facendo bene

Ci sono scelte tecniche che sostengono davvero questa promessa.

- **Conservare lo stato corrente.** Permette di distinguere una proposta, una decisione e una decisione successivamente sostituita.
- **Separare lettura del recupero e riconoscimento delle richieste.** Sono azioni diverse e non devono spostare indistintamente gli stessi cursori.
- **Usare snapshot con un limite immutabile.** Gli aggiornamenti arrivati durante la lettura possono restare disponibili per il recupero successivo.
- **Far convergere replay e microfono.** Il fallback può attraversare lo stesso motore, senza una seconda applicazione costruita soltanto per la demo.
- **Vincolare le proposte del modello.** ID, transizioni e riferimenti restano sotto controllo applicativo.
- **Mantenere le fonti originali.** L’utente può verificare l’interpretazione senza affidarsi a una citazione inventata dal modello.

Anche la distinzione tra «forse scegliamo cinese» e «scegliamo burritos» è pertinente: evita di trasformare una preferenza in una decisione.

Ma questi sono **mezzi**. Alla giuria interessa il comportamento che rendono possibile, non il numero di invarianti del reducer.

## D. Dove il prodotto è debole o fuori fuoco

### 1. L’interfaccia neutralizza il percorso rapido

Nel percorso live, l’invio della trascrizione passa attraverso un blocco globale delle azioni. La risposta del server arriva dopo l’analisi semantica; durante l’attesa il polling dello stato viene saltato e il pulsante di recupero è disabilitato. Testo e richiesta vengono mostrati alla risposta.

Quindi il backend può riconoscere subito «Emilio?», ma **l’utente può comunque aspettare il modello**. Inoltre, il client serializza gli invii: una frase lenta ritarda l’invio delle successive. Questo comportamento è visibile in [App.tsx](../apps/web/src/App.tsx) (riga 65) e [live.ts](../apps/web/src/live.ts) (riga 95).

È un difetto funzionale, non una rifinitura.

### 2. Un errore semantico può interrompere anche l’accesso alle parole

Il server conserva l’evento ma restituisce un errore se l’analisi fallisce. Il frontend non aggiunge quella frase alla propria trascrizione e il componente live tratta il fallimento come fatale.

**Il fallimento dell’arricchimento non dovrebbe togliere anche la trascrizione.** Questa contraddizione di accessibilità conta più di qualsiasi nuovo provider.

### 3. Il replay si ferma proprio quando dovrebbe dimostrare il recupero

Aprire il catch-up mette il replay in pausa; il ciclo di avanzamento si arresta anche mentre il pannello è aperto. Si vede in [App.tsx](../apps/web/src/App.tsx) (riga 129).

La track descrive una conversazione che continua mentre recuperi. La demo attuale può nascondere esattamente quella difficoltà.

### 4. Il sistema non sa quando l’utente ha smesso di seguire

La baseline è **l’ultimo recupero confermato**, non l’ultimo momento realmente seguito.

Chi ascolta o legge per venti minuti senza usare il pulsante può ricevere un recupero molto più ampio dei venti secondi appena persi. Il watermark è corretto tecnicamente; la sua corrispondenza con l’esperienza dell’utente è un’ipotesi.

### 5. L’assenza di risultati viene presentata con troppa sicurezza

La UI dice «nessun nuovo aggiornamento importante» e suggerisce di tornare alla conversazione. Ma zero elementi può significare:

- nessun cambiamento riconosciuto;
- elaborazione incompleta;
- contenuto non rappresentabile dal modello;
- un errore precedente.

Serve una formulazione limitata dalla copertura: **«Nessun nuovo cambiamento rilevato; analisi completata fino alle…»**. Il testo attuale è in [App.tsx](../apps/web/src/App.tsx) (riga 234).

### 6. Provenienza e verità vengono facilmente confuse

La validazione controlla che gli ID esistano e includano un evento nuovo. **Non controlla che la frase citata implichi davvero la decisione proposta.**

Un’interpretazione sbagliata può citare una trascrizione autentica e superare tutti i controlli strutturali. È il limite di [parseDeltaOps](../packages/shared/src/contracts.ts) (riga 96).

Potete dire «interpretazioni verificabili e stato protetto». Non potete dire «allucinazioni impedite».

## E. Audit del modello informativo

Non aggiungerei dieci nuove categorie. Cambierei il rapporto tra quelle esistenti e ciò che l’utente deve capire.

| Elemento | Raccomandazione |
|---|---|
| **Argomento** | Mantenerlo come contesto nell’intestazione; raramente merita una scheda autonoma. |
| **Decisioni** | Mantenerle, privilegiando quelle ancora valide e i cambiamenti rispetto al piano precedente. |
| **Motivo** | Aggiungere un attributo opzionale della decisione, con riferimenti specifici. |
| **Cambi di istruzione** | Renderli espliciti usando la supersessione già presente. Nessuna nuova gerarchia oggi. |
| **Domande aperte** | Mostrare quelle necessarie al rientro, non tutte indistintamente. |
| **Domande risolte** | Conservare il ciclo di vita; eliminare la categoria visiva quando duplica la decisione. |
| **Richieste personali** | Distinguere richiamo, domanda e incarico. Non sono equivalenti. |
| **Azioni da svolgere** | Riutilizzare le richieste, senza costruire un gestore di progetti. |
| **Urgenza** | Rappresentarla soltanto quando espressa; non dedurla dal nome o dal tono. |
| **Rilevanza temporale** | Usare creazione, risoluzione, sostituzione ed eventuali scadenze esplicite. |
| **Thread e relazioni tra parlanti** | Rinviare. Non sono sostenuti dall’acquisizione live attuale. |
| **Informazioni superate** | Conservarle come storia; mostrarle quando spiegano il cambiamento. |

**Il motivo è una lacuna seria.** La fonte risponde a «da dove viene questa interpretazione?». Il motivo risponde a «perché il gruppo ha cambiato piano?». Sono domande diverse.

Per oggi basta un campo concettualmente equivalente a:

```text
motivo: { testo, riferimenti_alla_trascrizione }
```

Non serve un’entità autonoma con ID, grafo causale e ciclo di vita separato.

Regole indispensabili:

- Estrarre soltanto motivi esplicitamente collegati alla decisione.
- Non trasformare vicinanza temporale in causalità.
- Non attribuire automaticamente alla decisione finale il motivo di una proposta precedente.
- Se il motivo manca, ometterlo o indicare «Motivo non esplicitato».
- Mostrare la frase sorgente a richiesta.

L’aggiunta di un motivo pronunciato successivamente richiede anche un aggiornamento della decisione esistente. È utile, ma può aspettare: per la prima versione potete supportare il motivo disponibile al momento della creazione.

Ci sono poi due problemi concreti nelle richieste:

1. **«Ho visto» non significa «ho fatto».** Attualmente le richieste riconosciute spariscono dalle viste che mostrano solo quelle attive. Un incarico può quindi scomparire prima di essere completato.
2. **Una chiamata ripetuta può non tornare più.** La deduplicazione considera anche richiami identici già riconosciuti: dopo «Emilio?» e «Got it», un successivo «Emilio?» può non generare un nuovo richiamo. Il controllo è in [state.ts](../apps/server/src/state.ts) (riga 154).

Occorre distinguere la duplicazione dello **stesso evento** dalla ripetizione legittima di una richiesta.

## F. Audit di “I MISSED THAT”

**Il pulsante è una scelta ragionevole.** Dà controllo e non richiede di rilevare automaticamente l’attenzione. Il nome è secondario; l’intervallo e il risultato sono molto più importanti.

L’esperienza migliore sarebbe un pannello stabile di questo tipo:

> **Dall’ultimo recupero confermato**  
> **Cambio di piano:** desktop → mobile.  
> **Motivo:** sul proiettore si legge meglio.  
> **Serve una risposta:** puoi verificare l’accesso sul mobile?  
> **Ancora aperto:** chi presenta l’architettura?

Non servono quattro grandi schede. Cambiamento e motivo devono apparire come un’informazione collegata.

Per un rientro di 3–5 secondi:

1. **Una o due informazioni dominanti.** La richiesta di risposta immediata può precedere il cambio di piano.
2. **Nessuna riscrittura durante la lettura.** Conservare la snapshot.
3. **Un segnale discreto per il presente.** «È arrivato un altro aggiornamento», senza spostare il testo sotto gli occhi.
4. **Fonti e dettagli progressivi.** Disponibili, ma non obbligatori per capire il punto.
5. **Conferma esplicita.** Chiudere non significa aver letto; leggere non significa accettare o completare un compito.

I 3–5 secondi devono essere un **obiettivo per orientarsi**, non una promessa di comprensione completa per qualunque utente e qualunque intervallo.

Due accortezze:

- Se mostrate solo tre elementi, gli altri devono essere chiaramente accessibili. Non segnate silenziosamente come letta un’intera snapshot contenente elementi mai mostrati.
- «Ancora aperto» non deve fingere di essere l’elenco completo delle pendenze: oggi il filtro del catch-up esclude le domande precedenti alla baseline che non sono cambiate.

Il dialogo modale può restare provvisoriamente. Sostituirlo con un pannello laterale non è più importante di eliminare i blocchi e rendere visibili nuovi aggiornamenti.

## G. Recovery vs Attention

**Il recupero deve essere la funzione principale. L’attenzione deve servirlo.**

Il messaggio centrale è: «Ti aiutiamo a ricostruire ciò che vale adesso». Il richiamo personale aggiunge: «Questa parte potrebbe richiedere una tua risposta».

L’attuale carta personale ha tre problemi:

- seleziona la prima richiesta attiva, non quella dimostrabilmente più urgente;
- confonde un richiamo con una richiesta operativa;
- resta visiva, quindi può non raggiungere chi sta guardando altrove.

«Emilio?» dovrebbe diventare **«Ti hanno chiamato»**, non suggerire automaticamente l’esistenza di un compito.

Anche la regola «un falso interrupt è peggiore del silenzio» va ridimensionata. È un compromesso ragionevole per questo prototipo in una riunione a basso rischio. Non è una preferenza universale delle persone sorde o ipoacusiche.

La vibrazione futura è coerente con il problema dell’attenzione visiva. **Non costituisce però innovazione dimostrata finché non esiste un’interazione reale, controllabile e valutata.** Gli occhiali e gli altri wearable meritano al massimo una frase finale.

## H. Miglior scenario d’uso

Terrei il gruppo universitario, ma lo restringerei così:

> **Tre studenti preparano una presentazione. Uno controlla il codice sul portatile. In quei venticinque secondi cambia il piano della demo e gli viene rivolta una domanda.**

È migliore di «riunione generica» perché rende evidente:

- il motivo legittimo per cui lo sguardo è altrove;
- il piano precedente;
- il cambiamento;
- il rischio di tornare con un’istruzione ormai sbagliata;
- l’azione necessaria per partecipare.

Il destinatario iniziale deve essere descritto con precisione: una persona sorda o ipoacusica che utilizza testo/sottotitoli in quel contesto. Non tutti hanno le stesse preferenze comunicative. Anche le indicazioni per riunioni accessibili richiedono di considerare gli accomodamenti necessari ai partecipanti effettivi. [Indicazioni del Center for Excellence in Disabilities](https://wvats.cedwvu.org/accessible-meetings/)

Le alternative non sono migliori oggi:

| Scenario | Potenziale | Motivo per non sceglierlo ora |
|---|---|---|
| Cambio delle istruzioni di un esercizio | Molto aderente alla track | Introduce riferimenti a lavagna, materiali e docente da chiarire |
| Cena con conversazioni laterali | Situazione riconoscibile | Il vostro modello cattura male sottintesi e relazioni tra scambi |
| Gaming | Azione immediata e demo efficace | Mancano legami con giocatori, luoghi e obiettivi |
| Storia dei suoni domestici | Recupera eventi senza traccia | Richiede una nuova capacità percettiva |

**Raccomandazione ferma: nessuna ricostruzione di conversazioni parallele oggi.** Raggruppare frasi per argomento non dimostra chi rispondeva a chi. Senza attribuzione affidabile dei parlanti e gestione delle sovrapposizioni, una mappa rischia di rendere più autorevole un’interpretazione sbagliata.

## I. Migliorie concrete

### Separare accesso alle parole e interpretazione

L’accettazione della trascrizione deve restituire rapidamente l’evento acquisito e l’eventuale richiamo. La semantica può continuare nella coda esistente, mentre il polling aggiorna lo stato.

Il recupero deve restare utilizzabile e dichiarare se gli ultimi interventi sono ancora in elaborazione. Non serve introdurre un nuovo sistema di streaming per ottenere questo risultato.

### Costruire una sola unità di recupero convincente

**Prima → ora + motivo espresso + conseguenza personale.**

Usate la supersessione già disponibile. Aggiungete il motivo opzionale. Eliminate la duplicazione tra una decisione e la risoluzione della domanda che l’ha generata.

### Rendere osservabili limiti e freschezza

Distinguete almeno:

- acquisizione del microfono;
- testo ricevuto;
- interpretazione in corso o fallita;
- punto fino al quale il recupero è completo.

Il contatore locale degli elementi “non visti” può divergere dal watermark server. Finché non deriva dallo stesso criterio, è preferibile eliminarlo anziché presentarlo come misura di ciò che l’utente ha perso.

### Verificare il beneficio, non soltanto le funzioni

Una piccola prova dovrebbe chiedere, dopo un’interruzione visiva:

- Qual è il piano adesso?
- Perché è cambiato?
- Cosa viene chiesto a te?
- Cosa resta da decidere?

Confrontate la correttezza e il tempo di recupero usando gli stessi contenuti con trascrizione e con SenseLayer. Se non avete persone sorde o ipoacusiche disponibili, una prova interna serve a scoprire difetti, **non a validare l’accessibilità per quella popolazione**.

Misurate separatamente fine della frase, comparsa del testo, comparsa del richiamo e aggiornamento semantico. L’attuale commit audio aspetta circa 800 ms di silenzio, prima degli altri passaggi: non avete basi per promettere una risposta istantanea.

Sul piano dell’interazione: conservare testo scalabile, focus visibile, tastiera, controllo dell’autoscroll, significati non affidati al solo colore e assenza di sparizioni temporizzate. Ridurre interruzioni e contenuti superflui è coerente con le indicazioni cognitive supplementari W3C; questo non certifica conformità né efficacia del vostro prodotto. [W3C: aiutare gli utenti a mantenere il focus](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/)

## J. Idee radicali / pivot possibili

| Variante | Perché potrebbe essere migliore | Cosa riusa | Cosa richiede di nuovo | Fattibilità oggi |
|---|---|---|---|---|
| **Recupero dei cambi di piano** | Collega direttamente cambiamento, motivo e conseguenza | Decisioni, supersessione, fonti, richieste | Motivo opzionale e nuova gerarchia visiva | **Alta: raccomandata** |
| **Riavvolgimento semantico** | L’utente indica «ero arrivato qui» e recupera da quel punto | Eventi, log e catch-up | Selezione della baseline e interrogazione dell’intervallo | Media; versione limitata possibile |
| **Istruzioni correnti personali** | Risponde a «che cosa devo fare adesso?» | Richieste, decisioni, supersessione | Distinzione lettura/completamento e vista persistente | Media; rischio di diventare un task manager |
| **Mappa delle conversazioni** | Recupera collegamenti, risposte e scambi paralleli | Eventi e provenienza | Thread, attribuzione, relazioni e navigazione | Bassa |
| **Memoria degli eventi sonori** | Recupera eventi che altrimenti spariscono | Log, timestamp, routing e parte della UI | Classificazione dei suoni, rilevanza e provenienza | Bassa |

La prima è un **cambio sostanziale di fuoco**, pur riutilizzando quasi tutta l’infrastruttura.

La memoria sonora potrebbe condividere principi architetturali, ma il riconoscimento di un suono e la sua rilevanza non si ottengono cambiando soltanto il tipo di evento. Aggiungere oggi un campanello simulato dimostrerebbe ampiezza narrativa, non una capacità utile.

## K. Cosa tagliare

Prima della valutazione smetterei di sviluppare o enfatizzare:

- la piattaforma universale di percezione;
- nuovi provider e confronti tra modelli;
- diarizzazione e mappe dei thread;
- un evento sonoro aggiunto soltanto per fare scena;
- wearable e aptica simulati come se fossero già integrazioni;
- inferenze su emozioni, sarcasmo o intenzioni;
- rilevamento automatico dello sguardo;
- dashboard con una scheda per ogni categoria interna;
- spiegazioni del reducer nel flusso utente;
- affermazioni di assenza di allucinazioni;
- promesse di recupero completo in un tempo fisso.

Terrei il nome **SenseLayer**. Un cambio di marchio non corregge nessuno dei problemi decisivi.

## L. Demo ideale

**Durata: circa 130 secondi. Obiettivo: dimostrare un cambio di piano recuperato mentre il presente continua.**

Questa è una demo obiettivo dopo gli interventi P0. Il copione è riportato in italiano; l’attuale acquisizione è configurata in inglese. Per il microfono usate una versione nella lingua già collaudata. Il copione italiano può essere usato nel replay testuale con interpretazione verificata: non presumete che sia già supportato dal percorso live.

### 0–15 secondi: problema

Dite:

> «Durante una riunione di progetto, controllare il codice significa distogliere lo sguardo dai sottotitoli. In quel momento il gruppo può cambiare piano.»

Mostrate la trascrizione disponibile. Non nascondetela per costruire artificialmente il bisogno.

### 15–30 secondi: baseline

Sara:

> «Per la presentazione usiamo la versione desktop.»

Emilio è ancora al passo e conferma il recupero iniziale. Il giudice deve sapere che questo è il punto di partenza.

### 30–60 secondi: informazione persa

Emilio guarda il codice per controllare un collegamento.

Conversazione:

- **Marta:** «Sul proiettore il testo della versione desktop si legge male.»
- **Luca:** «Potremmo ingrandirlo, oppure usare la versione mobile.»
- **Sara:** «Passiamo alla versione mobile, perché sul proiettore il testo si legge meglio. Abbandoniamo la demo desktop.»
- **Luca:** «Chi presenta l’architettura?»
- **Sara:** «Emilio, puoi verificare adesso che il bottone di accesso funzioni sul mobile?»

Qui ci sono una proposta, una decisione esplicita, un motivo, una domanda aperta e una richiesta personale.

### 60–85 secondi: recupero

Emilio apre il pannello. Il giudice vede:

> **Desktop → mobile**  
> **Motivo:** testo più leggibile sul proiettore.  
> **Per te:** verifica il bottone di accesso sul mobile.  
> **Aperto:** chi presenta l’architettura?

Emilio risponde:

> «Controllo l’accesso sul mobile.»

La prova è l’azione coerente con il nuovo piano. Non basta mostrare che sono comparse delle schede.

### 85–105 secondi: la conversazione continua

Con il pannello ancora aperto, Luca dice:

> «L’architettura la presento io.»

Il recupero in lettura rimane stabile; compare un’indicazione di nuovo aggiornamento. Dopo la conferma, il recupero successivo mostra la risoluzione.

Questo dimostra perché servono snapshot e watermark.

### 105–120 secondi: fonte e controllo

Aprite la fonte del motivo. Mostrate anche che «potremmo ingrandirlo» non è diventato una decisione.

Dite:

> «Il sistema distingue la proposta dal piano adottato e permette di controllare le parole da cui deriva l’interpretazione.»

### 120–130 secondi: chiusura

> «Il risultato è rientrare sapendo cosa vale adesso, perché è cambiato e quale risposta viene chiesta.»

Il fallback deve dichiarare cosa sostituisce:

- replay testuale con modello reale: prova del motore, non del microfono;
- provider deterministico: prova del comportamento applicativo, non della comprensione libera.

Non mettete automaticamente in pausa il mondo quando l’utente apre il recupero.

## M. Red-team dei giudici

| Attacco | Risposta sostenibile | Quanto convince oggi |
|---|---|---|
| **«È solo un riassunto.»** | Dimostrare sostituzione del piano, distinzione proposta/decisione, risoluzione delle pendenze e baseline personale. | Parzialmente: l’interfaccia deve rendere visibili queste differenze. |
| **«Perché non scorrere i sottotitoli?»** | Scorrere restituisce parole; bisogna ancora ricostruire cosa è valido mentre il presente continua. | Plausibile, ma il vantaggio va osservato, non proclamato. |
| **«Perché una persona sorda lo vorrebbe?»** | Il conflitto tra compiti visivi è l’ipotesi progettuale. | Non avete ancora una prova di desiderabilità riportata. |
| **«Perché serve l’AI?»** | Per riconoscere parafrasi, impegni, risoluzioni e motivi espliciti nel linguaggio naturale. | Convincente se la demo non dipende da una grammatica fissa. |
| **«Cosa succede se interpreta male?»** | Fonti verificabili, astensione e indicazione della copertura. | Incompleto: validazione strutturale e verità semantica restano diverse. |
| **«Basta evidenziare i nomi.»** | Un nome non ricostruisce il piano cambiato né distingue sempre menzione e indirizzamento. | Convincente per il recupero; debole se vendete soprattutto l’allerta. |
| **«Perché serve lo stato?»** | Per distinguere ciò che è ancora valido da ciò che è stato risolto o sostituito. | Convincente, se mostrate una correzione concreta. |
| **«È un assistente per riunioni.»** | Il compito specifico è il rientro personale durante la conversazione. | Differenza progettuale credibile, non esclusività commerciale. |
| **«Che cosa avete davvero costruito?»** | Separare live, replay, provider simulato e visione futura. | Convincente con una dimostrazione trasparente. |
| **«Se sta guardando altrove, come vede l’allerta?»** | La carta attuale non risolve pienamente quel caso; il recupero resta su richiesta. | Obiezione valida. La futura vibrazione non la risolve oggi. |
| **«Non state aggiungendo altro testo da sorvegliare?»** | Il recupero deve ridurre gli arretrati e restare su richiesta. | Obiezione forte contro la UI attuale a molte categorie. |

La differenziazione concettuale va formulata senza inventare carenze dei concorrenti:

| Categoria | Confronto da dimostrare |
|---|---|
| Sottotitoli | Accesso alle parole rispetto a ricostruzione della situazione corrente |
| Ricerca nella trascrizione | Cercare qualcosa che si sa nominare rispetto a scoprire un cambiamento sconosciuto |
| Riassunto generico | Resoconto del periodo rispetto a cambiamenti pertinenti dalla baseline personale |
| Assistente per riunioni | Documentazione del lavoro rispetto a rientro durante il suo svolgimento |
| Notifiche | Richiamo dell’attenzione rispetto a recupero del contesto che rende utile il richiamo |

Queste categorie possono incorporare le vostre funzioni. **La vostra proposta non è difendibile perché nessun altro potrebbe copiarla, ma perché organizza l’esperienza attorno a un compito preciso.**

## N. Priorità P0 / P1 / P2 / P3 / CUT

Le stime assumono familiarità con il codice e includono verifiche mirate. Non sono garanzie.

### P0 — Prima della valutazione

| Intervento | Valore | Complessità | Rischio della modifica per la demo | Riuso | Stima |
|---|---|---|---|---|---|
| Separare acquisizione, attenzione e semantica; mantenere recupero utilizzabile; esporre elaborazione/copertura | Molto alto: corregge una contraddizione centrale | Medio-alta | Medio-alto: tocca il flusso live | Coda, store e polling esistenti | 60–120 min |
| Recupero prima → ora con motivo esplicito, fonte e richiesta personale; ridurre duplicazioni | Molto alto: rende evidente il valore della track | Media | Medio: attraversa contratto, provider e UI | Supersessione, evidenze e catch-up | 60–90 min |
| Demo continua con baseline e fallback dichiarati; verifiche sui casi critici | Molto alto: prova il comportamento promesso | Bassa-media | Basso dopo il collaudo | Replay e test esistenti | 25–40 min |

Il totale è circa **2 ore e 25 minuti–4 ore e 10 minuti**. Se restano soltanto due ore, non fingete di poter completare tutto: correggete il blocco più grave, riducete la UI e limitate le promesse. Un motivo mostrato attraverso la fonte esatta è un compromesso più onesto di un campo causale implementato male.

### P1 — Se resta tempo

| Intervento | Valore | Complessità | Rischio demo | Riuso | Stima |
|---|---|---|---|---|---|
| Consentire nuovi richiami dopo riconoscimento, preservando idempotenza degli eventi | Alto per affidabilità | Bassa-media | Basso | Detector e richieste | 20–40 min |
| Separare «ho visto» da «completato» e mantenere gli incarichi consultabili | Alto | Media | Medio | Ciclo di vita esistente | 30–60 min |
| Pannello con presente visibile e segnale discreto di nuovi eventi | Alto | Media | Medio | Snapshot e componenti UI | 30–60 min |
| Breve verifica con persone sorde/ipoacusiche disponibili | Molto alto per correggere le ipotesi | Organizzativa | Dipende dalla disponibilità | Prototipo attuale | 20–40 min per una sessione esplorativa |

### P2 — Solo dopo P0/P1

- Motivi aggiunti dopo la decisione.
- Selezione manuale del punto da cui recuperare.
- Correzione delle interpretazioni da parte dell’utente.
- Personalizzazione di testo e densità.
- Miglioramento della segmentazione audio se le prove mostrano un problema riproducibile.

### P3 — Visione futura

- Aptica reale e preferenze di interruzione.
- Integrazioni con wearable.
- Ricostruzione dei thread.
- Memoria sonora e provenienza spaziale.
- Sessioni e baseline realmente personali per più utenti.

### CUT — Da evitare attivamente

Nuovi provider, rifacimento dello stack, grafo universale del contesto, emozioni inferite, tracciamento dello sguardo e ampliamento della demo a più domini.

## O. Architettura: cosa preservare e cosa cambiare

**Preservare:**

- confine comune degli eventi finalizzati;
- reducer deterministico e transizioni atomiche;
- operazioni ammesse ristrette;
- proprietà applicativa di ID, tempi e lifecycle;
- riferimenti alle fonti originali;
- cronologia delle decisioni sostituite;
- snapshot e watermark;
- astrazione dei provider già esistente.

Non sono tutti elementi di innovazione, ma proteggono comportamenti utili.

**Cambiare:**

1. **Disaccoppiare il completamento HTTP dall’analisi semantica.**
2. **Separare il blocco delle azioni utente dalla ricezione live.**
3. **Esporre avanzamento ed errori dell’analisi senza interrompere le parole.**
4. **Aggiungere il motivo alla decisione e usarlo nella presentazione.**
5. **Correggere i confini tra richiamo, lettura e completamento.**

L’AI aggiunge valore nell’interpretazione linguistica. La logica deterministica deve continuare a governare transizioni, validazione dei riferimenti, deduplicazione degli eventi e conferme.

L’astensione è necessaria nei casi ambigui, ma deve essere raccontata correttamente: una proposta vuota significa «nessun cambiamento estratto», non «nessuna informazione importante pronunciata».

Non aggiungerei un secondo modello che “certifica” il primo: aumenterebbe latenza e complessità senza garantire correttezza.

Il sovrainvestimento oggi sarebbe continuare a estendere l’infrastruttura dei provider. Quello che manca non è un’altra astrazione: è **un percorso end-to-end che conservi il vantaggio temporale del motore**.

Infine, il live assegna un’etichetta neutra al microfono, non identifica affidabilmente chi parla. Una registrazione di replay con nomi non dimostra diarizzazione. Lo stato in memoria e la sessione condivisa sono accettabili per il prototipo locale, ma non dimostrano ancora personalizzazione multiutente.

## P. Pitch / posizionamento consigliato

> **SenseLayer aiuta uno studente sordo o ipoacusico a rientrare in una riunione di progetto mostrando cosa è cambiato, il motivo espresso e quale risposta gli viene chiesta.**

Per il pitch:

> «Emilio sta controllando il codice. Nel frattempo il gruppo cambia il piano della presentazione e gli chiede una verifica. Tornando ai sottotitoli dovrebbe ricostruire quali proposte sono diventate decisioni e quali istruzioni sono ancora valide. SenseLayer gli mostra il cambiamento, il motivo e la richiesta, con accesso alle parole originali.»

La spiegazione tecnica può fermarsi a:

> «Il modello propone cambiamenti; il codice mantiene lo stato della conversazione e le relative fonti.»

“Git diff della conversazione” è una buona metafora per una domanda tecnica. Non deve essere il centro del pitch.

La visione futura, se serve:

> «In seguito potremo portare i richiami anche su canali aptici, rispettando le preferenze dell’utente.»

Nessun elenco di dispositivi e nessuna promessa di percezione universale.

## Q. Verdetto finale

- **Tenere SenseLayer:** sì.
- **Modificarlo:** sì, concentrandolo sul recupero dei cambi di piano.
- **Fare un pivot:** cambiare il fuoco del prodotto; non cambiare dominio né infrastruttura.
- **Nome e descrizione:** SenseLayer — recupero del contesto per rientrare nelle riunioni di progetto.
- **Intuizione più forte:** rientrare significa ricostruire ciò che vale adesso, non rileggere tutto ciò che è stato detto.
- **Debolezza maggiore:** l’integrità del motore è dimostrata meglio del beneficio durante una conversazione che continua.
- **Cambiamento di prodotto più prezioso oggi:** mostrare **prima → ora, motivo esplicito e conseguenza personale** in un solo recupero breve.
- **Blocco tecnico da risolvere prima:** l’attesa della semantica che rallenta trascrizione, attenzione e accesso al recupero.
- **Da non toccare:** reducer, validazione, provenienza, watermark e convergenza live/replay.

**La submission più forte è una persona che torna nel momento giusto, capisce perché il piano è cambiato e riesce a dare la risposta utile. Tutto ciò che non rende questa scena più credibile può aspettare.**