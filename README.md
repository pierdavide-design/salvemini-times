# Salvemini Times

Quotidiano web editoriale con area redazione, account, ricerca per argomento, video e revisione obbligatoria tramite Gemini API.

## Avvio locale

Richiede Node.js 20 o successivo. In PowerShell, dalla cartella del progetto:

```powershell
node server.mjs
```

Apri `http://127.0.0.1:4173`, accedi con un account redattore, apri il menu del profilo e scegli **Configura Gemini**. La chiave si inserisce nel pannello web e viene inviata solo al server locale; non serve inserirla nel terminale o nel README. Senza una chiave valida il giornale resta consultabile, ma gli articoli non vengono pubblicati.

## Pubblicazione online

Il server è predisposto per un hosting Node.js: in produzione ascolta su `0.0.0.0`, usa la porta `PORT` del provider e imposta il cookie di sessione `Secure`. Configura `NODE_ENV=production` e pubblica dietro HTTPS. La chiave Gemini si può inserire dal pannello redattore oppure nel secret manager dell’hosting con `GEMINI_API_KEY`; non inserirla nel frontend o in un file versionato.

Collega un disco persistente a `DATA_DIR` (per esempio `/var/data`), altrimenti account, articoli, copertine e PDF salvati nel filesystem locale possono andare persi a ogni redeploy. L’archivio JSON e le sessioni in memoria sono adatti a una singola istanza di prototipo, non a più repliche o a un quotidiano con traffico elevato. Prima di aprire il servizio al pubblico, limita la registrazione di nuovi redattori con un invito o un processo di approvazione.

## Come ottenere la chiave Gemini

1. Apri [Google AI Studio](https://aistudio.google.com/app/apikey) e accedi con il tuo account Google.
2. Crea una API key e copiala.
3. Nel sito apri il menu profilo, scegli **Configura Gemini**, incolla la chiave e premi **Verifica e salva**.

Il modello predefinito è `gemini-2.5-flash`. Il piano gratuito ha quote e limiti che possono variare; controlla utilizzo e condizioni aggiornate in Google AI Studio. I manoscritti inviati vengono elaborati da Google: non inviare materiali riservati senza averne l’autorizzazione.

## Redazione

Registrandosi si crea un account redattore; le password sono conservate come hash PBKDF2. La sessione usa un cookie `HttpOnly`, `SameSite=Lax`. Gli articoli sono salvati in `data/articles.json`, gli account in `data/users.json` e i PDF/copertine caricati in `data/media/`. Questa è un'archiviazione locale per prototipo, non un servizio multi-server o un database di produzione.

Ogni articolo passa dal controllo Gemini prima di essere archiviato o mostrato. Se il modello rifiuta il pezzo, non viene pubblicato. Gemini restituisce solo decisione, motivazione, sezione e formato: non riceve mai il compito di riscrivere il corpo. L'estrazione PDF usa PDF.js e funziona con PDF che contengono testo selezionabile; non è incluso OCR per documenti scansionati. Il PDF originale rimane incorporato nella pagina dell'articolo. La sezione video accetta link YouTube.

Gli account e gli articoli di esempio non sono inclusi. Un nuovo spazio dati parte vuoto.
