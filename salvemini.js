const categories = ["Attualità", "Mondo", "Cultura", "Ambiente", "Tecnologia", "Gaming", "Cinema e serie", "Musica", "Sport", "Viaggi", "Cucina", "Video"];
const savedKey = "salvemini-saved";
const viewerKey = "salvemini-viewer-id";
const interestKey = "salvemini-reading-profile";
const storyGrid = document.querySelector("#story-grid");
const trendingGrid = document.querySelector("#trending-grid");
const recommendationsGrid = document.querySelector("#recommendations-grid");
const videoGrid = document.querySelector("#video-grid");
const categoryButtons = [...document.querySelectorAll(".category-button")];
const searchInput = document.querySelector("#site-search");
const articleDialog = document.querySelector(".article-dialog");
const editorDialog = document.querySelector(".editor-dialog");
const authDialog = document.querySelector(".auth-dialog");
const geminiSettingsDialog = document.querySelector(".gemini-settings-dialog");
const editorForm = document.querySelector("#editor-form");
const toast = document.querySelector(".toast");
let stories = [];
let currentUser = null;
let searchTerm = "";
let activeCategory = "Tutte";
let activeView = "home";
let showAllStories = false;
let signupMode = false;
let selectedPdf = null;
let coverData = "";
let toastTimer;
let viewerId = "";

if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const stopWords = new Set(["a", "ad", "al", "alla", "anche", "che", "chi", "ci", "come", "con", "da", "dal", "dalla", "dei", "del", "della", "di", "e", "è", "gli", "i", "il", "in", "la", "le", "lo", "ma", "nel", "nella", "o", "per", "su", "un", "una"]);
const topics = [
  ["scuola", "istruzione", "studenti", "insegnanti", "educazione", "università"],
  ["lavoro", "occupazione", "ufficio", "aziende", "stipendi"],
  ["ambiente", "natura", "clima", "biodiversità", "inquinamento", "ecologia"],
  ["energia", "rinnovabili", "elettricità", "solare", "eolica"],
  ["cinema", "film", "documentario", "spettacolo", "video", "serie", "televisione", "streaming", "attori"],
  ["arte", "cultura", "musei", "mostre", "libri", "lettura"],
  ["tecnologia", "internet", "social", "algoritmi", "digitale", "intelligenza"],
  ["politica", "governo", "europa", "istituzioni", "bruxelles"],
  ["mare", "oceano", "pesca", "mediterraneo", "animali"],
  ["città", "quartiere", "mobilità", "traffico", "trasporti"],
  ["gaming", "videogiochi", "videogioco", "console", "esports", "e-sport", "playstation", "xbox", "nintendo", "twitch", "streamer"],
  ["musica", "canzoni", "concerti", "cantanti", "album", "festival", "musicisti"],
  ["sport", "calcio", "basket", "pallacanestro", "tennis", "atleti", "partita", "campionato"],
  ["viaggi", "viaggio", "turismo", "vacanze", "mete", "itinerari", "destinazioni"],
  ["cucina", "ricette", "cibo", "ristoranti", "chef", "gastronomia", "piatti"],
];

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/[^a-z0-9\s]/g, " ").trim();
}

function text(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function readLocalSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}

function getViewerId() {
  try {
    let id = localStorage.getItem(viewerKey);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(viewerKey, id);
    }
    return id;
  } catch { return crypto.randomUUID(); }
}

function readReadingProfile() {
  try { return JSON.parse(localStorage.getItem(interestKey) || "{\"categories\":{},\"recent\":{}}"); }
  catch { return { categories: {}, recent: {} }; }
}

function recordInterest(story, weight) {
  const profile = readReadingProfile();
  for (const category of Object.keys(profile.categories)) profile.categories[category] *= 0.94;
  profile.categories[story.category] = (profile.categories[story.category] || 0) + weight;
  profile.recent[story.id] = Date.now();
  const recentEntries = Object.entries(profile.recent).sort((first, second) => second[1] - first[1]).slice(0, 60);
  profile.recent = Object.fromEntries(recentEntries);
  try { localStorage.setItem(interestKey, JSON.stringify(profile)); } catch {}
}

function writeLocalSet(key, values) {
  try { localStorage.setItem(key, JSON.stringify([...values])); } catch { showToast("Salvataggio locale non disponibile in questo browser."); }
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.moderation ? `${result.error} ${result.moderation}` : result.error || "Richiesta non riuscita.");
  return result;
}

function imageFor(story) {
  return story.cover || "";
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, previous + Number(left[leftIndex - 1] !== right[rightIndex - 1]));
      previous = saved;
    }
  }
  return row[right.length];
}

function termsFor(term) {
  const normalized = normalize(term);
  if (normalized === "svago" || normalized === "tempo libero") return ["gaming", "videogiochi", "cinema", "film", "serie", "musica", "concerti", "sport", "viaggi", "cucina"];
  const topic = topics.find((group) => group.some((item) => normalize(item) === normalized));
  return topic ? topic.map(normalize) : [normalized];
}

function tokenScore(token, fieldTokens) {
  const alternatives = termsFor(token);
  let bestMatch = 0;
  for (const candidate of fieldTokens) {
    for (const term of alternatives) {
      if (candidate === term || (term.length > 3 && candidate.includes(term))) bestMatch = Math.max(bestMatch, 1);
      else bestMatch = Math.max(bestMatch, 1 - editDistance(term, candidate) / Math.max(term.length, candidate.length));
    }
  }
  return bestMatch >= 0.72 ? bestMatch : 0;
}

function relevance(story, query) {
  const queryTokens = normalize(query).split(/\s+/).filter((token) => token && !stopWords.has(token));
  const title = normalize(story.title).split(/\s+/);
  const tags = normalize((story.tags || []).join(" ")).split(/\s+/);
  const section = normalize(story.category).split(/\s+/);
  const summary = normalize(`${story.summary} ${story.body}`).split(/\s+/);
  const scores = queryTokens.map((token) => Math.max(tokenScore(token, title) * 8, tokenScore(token, tags) * 6, tokenScore(token, section) * 5, tokenScore(token, summary) * 3));
  const matches = scores.filter(Boolean).length;
  if (!matches) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / Math.max(1, queryTokens.length) + (matches === queryTokens.length ? 3 : 0);
}

function formatDate(value) {
  if (!value) return "OGGI";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "OGGI" : new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(date).toUpperCase();
}

function formatCount(value) {
  return new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function viewLabel(value, uppercase = false) {
  const count = Number(value) || 0;
  const label = `${formatCount(count)} ${count === 1 ? "visualizzazione" : "visualizzazioni"}`;
  return uppercase ? label.toLocaleUpperCase("it") : label;
}

function popularityScore(story) {
  const ageHours = Math.max(0, (Date.now() - new Date(story.time).getTime()) / 3600000 || 0);
  const engagement = Math.log1p(Number(story.views) || 0) * 2 + Math.log1p(Number(story.likes) || 0) * 5;
  return (engagement + 0.2) / Math.pow(1 + ageHours / 36, 0.45);
}

function recommendationScore(story, profile) {
  const affinity = (profile.categories[story.category] || 0) * 3;
  const lastViewed = profile.recent[story.id] || 0;
  const recentlySeenPenalty = Date.now() - lastViewed < 60 * 60 * 1000 ? 1.5 : 0;
  return popularityScore(story) + affinity - recentlySeenPenalty;
}

function visibleStories() {
  let result = [...stories];
  if (activeView === "saved") {
    const saved = readLocalSet(savedKey);
    result = result.filter((story) => saved.has(story.id));
  }
  if (activeView === "video" || activeCategory === "Video") result = result.filter((story) => story.kind === "video");
  else if (activeCategory !== "Tutte") result = result.filter((story) => story.category === activeCategory);
  if (searchTerm) result = result.map((story) => ({ story, score: relevance(story, searchTerm) })).filter((entry) => entry.score > 0).sort((first, second) => second.score - first.score || popularityScore(second.story) - popularityScore(first.story)).map((entry) => entry.story);
  else if (document.querySelector("#sort-order").value === "recent") result.sort((first, second) => new Date(second.time).getTime() - new Date(first.time).getTime());
  else result.sort((first, second) => popularityScore(second) - popularityScore(first));
  return result;
}

function coverCard(story, index, compact = false) {
  const saved = readLocalSet(savedKey).has(story.id);
  const liked = Boolean(story.liked);
  const meta = `${text(story.category).toUpperCase()} <i></i> ${formatDate(story.time)}`;
  return `<article class="${compact ? "video-card" : "story-card"}" style="animation-delay:${Math.min(index, 8) * 35}ms">
    <button class="${compact ? "video-card-cover" : "story-image"}" type="button" data-article="${text(story.id)}" aria-label="Apri ${text(story.title)}">
      <img src="${text(imageFor(story))}" alt="Copertina: ${text(story.title)}" loading="lazy">
      <span class="cover-section">${text(story.category.toUpperCase())}</span>
      <span class="cover-play" aria-hidden="true">${story.kind === "video" ? "▶" : "↗"}</span>
      ${story.kind === "video" ? `<span class="video-duration">VIDEO</span>` : ""}
    </button>
    <div class="story-card-info"><span class="story-avatar" aria-hidden="true">${text(story.author?.charAt(0) || "S")}</span><div class="story-details">
      <button class="story-title" type="button" data-article="${text(story.id)}">${text(story.title)}</button>
      <span class="story-author">${text(story.author || "Salvemini Times")}</span><span class="story-stats">${meta}<i></i>${viewLabel(story.views)} · ${formatCount(story.likes)} mi piace</span>
    </div><div class="story-social">
      <button class="social-button ${liked ? "active" : ""}" type="button" data-action="like" data-id="${text(story.id)}" aria-label="${liked ? "Rimuovi mi piace" : "Mi piace"} · ${formatCount(story.likes)}" aria-pressed="${liked}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11a4.8 4.8 0 0 1 8.8-2.6 4.8 4.8 0 0 1 8.8 2.6Z"></path></svg><span>${formatCount(story.likes)}</span></button>
      <button class="social-button ${saved ? "active" : ""}" type="button" data-action="save" data-id="${text(story.id)}" aria-label="${saved ? "Rimuovi dai salvati" : "Salva articolo"}" aria-pressed="${saved}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.8c0-.4.3-.8.8-.8h10.4c.4 0 .8.4.8.8V21l-6.8-4-6.8 4z"></path></svg></button>
    </div></div></article>`;
}

function sortedByInterest() {
  return [...stories].sort((first, second) => popularityScore(second) - popularityScore(first));
}

function renderTrending() {
  const trending = sortedByInterest().slice(0, 4);
  trendingGrid.innerHTML = trending.map((story, index) => `<button class="trending-card" type="button" data-article="${text(story.id)}">
    <span class="trending-image"><img src="${text(imageFor(story))}" alt="" loading="lazy"><span class="trending-position">${String(index + 1).padStart(2, "0")}</span><span class="trending-play">↗</span></span>
    <span class="trending-card-category">${text(story.category.toUpperCase())} <i></i> ${viewLabel(story.views, true)} · ${formatCount(story.likes)} LIKE</span>
    <strong>${text(story.title)}</strong><span class="trending-card-author">${text(story.author || "Redazione")}</span></button>`).join("");
  document.querySelector("#trending-empty").hidden = trending.length > 0;
}

function renderRecommendations() {
  const section = document.querySelector("#recommendations-section");
  const canRecommend = stories.length > 0 && activeCategory === "Tutte" && !searchTerm && activeView === "home";
  section.hidden = !canRecommend;
  if (!canRecommend) return;
  const profile = readReadingProfile();
  const recommendations = [...stories].sort((first, second) => recommendationScore(second, profile) - recommendationScore(first, profile)).slice(0, 3);
  recommendationsGrid.innerHTML = recommendations.map((story, index) => coverCard(story, index)).join("");
  section.hidden = recommendations.length === 0;
}

function renderVideoShelf() {
  const videos = stories.filter((story) => story.kind === "video").sort((first, second) => popularityScore(second) - popularityScore(first)).slice(0, 3);
  videoGrid.innerHTML = videos.map((story, index) => coverCard(story, index, true)).join("");
  document.querySelector("#video-empty").hidden = videos.length > 0;
}

function renderStories() {
  const results = visibleStories();
  const shown = showAllStories ? results : results.slice(0, 9);
  storyGrid.innerHTML = shown.map((story, index) => coverCard(story, index)).join("");
  document.querySelector(".empty-state").hidden = shown.length > 0;
  document.querySelector("#load-more").hidden = shown.length === 0 || shown.length >= results.length;
  document.querySelector("#feed-title").textContent = activeView === "saved" ? "Articoli salvati" : activeView === "video" || activeCategory === "Video" ? "Tutti i video" : searchTerm ? "Corrispondenze più vicine" : activeCategory === "Tutte" ? "Ultime notizie" : activeCategory;
  document.querySelector("#feed-kicker").textContent = searchTerm ? `RISULTATI AFFINI A “${text(searchTerm.toLocaleUpperCase("it"))}”` : activeView === "saved" ? "LA TUA RACCOLTA" : activeView === "video" ? "SALVEMINI IN VIDEO" : "DALLA REDAZIONE";
  document.querySelector("#search-status").textContent = searchTerm ? `${results.length} ${results.length === 1 ? "risultato" : "risultati"} ordinati per pertinenza.` : "";
}

function replaceStory(updated) {
  stories = stories.map((story) => story.id === updated.id ? { ...story, ...updated } : story);
  return stories.find((story) => story.id === updated.id);
}

function updateDialogEngagement(story) {
  document.querySelector("#dialog-views").textContent = viewLabel(story.views);
  const button = document.querySelector("[data-action='like-current']");
  button.setAttribute("aria-pressed", String(Boolean(story.liked)));
  button.setAttribute("aria-label", `${story.liked ? "Rimuovi mi piace" : "Mi piace"} · ${formatCount(story.likes)}`);
  button.querySelector("span").textContent = formatCount(story.likes);
}

function renderFeeds() {
  renderTrending();
  renderRecommendations();
  renderVideoShelf();
  renderStories();
}

async function toggleLike(storyId) {
  try {
    const result = await request(`/api/articles/${encodeURIComponent(storyId)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId }),
    });
    const story = replaceStory(result.article);
    if (story.liked) recordInterest(story, 3);
    renderFeeds();
    if (articleDialog.open && articleDialog.dataset.articleId === story.id) updateDialogEngagement(story);
  } catch (error) { showToast(error.message); }
}

function registerView(story) {
  recordInterest(story, 1);
  story.views = (Number(story.views) || 0) + 1;
  renderFeeds();
  updateDialogEngagement(story);
  request(`/api/articles/${encodeURIComponent(story.id)}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewerId }),
  }).then(({ article }) => {
    const updated = replaceStory(article);
    renderFeeds();
    if (articleDialog.open && articleDialog.dataset.articleId === updated.id) updateDialogEngagement(updated);
  }).catch(() => {
    const current = replaceStory({ ...story, views: Math.max(0, story.views - 1) });
    renderFeeds();
    if (articleDialog.open && articleDialog.dataset.articleId === current.id) updateDialogEngagement(current);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function videoEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.hostname.includes("youtu.be") ? parsed.pathname.slice(1) : parsed.searchParams.get("v");
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : "";
  } catch { return ""; }
}

function openArticle(story) {
  if (!story) return;
  articleDialog.dataset.articleId = story.id;
  articleDialog.querySelector("#dialog-title").textContent = story.title;
  articleDialog.querySelector(".dialog-category").textContent = `${story.category} · ${story.read || "ARTICOLO"}`;
  articleDialog.querySelector(".dialog-summary").textContent = story.summary || "";
  articleDialog.querySelector(".dialog-byline").textContent = `${story.author || "Redazione"} · ${formatDate(story.time)}`;
  const media = articleDialog.querySelector(".dialog-media");
  const videoFrame = articleDialog.querySelector("#dialog-video");
  const pdfFrame = articleDialog.querySelector("#dialog-pdf-wrap");
  const embed = story.kind === "video" ? videoEmbedUrl(story.videoUrl) : "";
  media.hidden = Boolean(embed);
  videoFrame.hidden = !embed;
  videoFrame.replaceChildren();
  if (embed) {
    const iframe = document.createElement("iframe");
    iframe.src = embed;
    iframe.title = story.title;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    videoFrame.append(iframe);
  } else {
    media.querySelector("img").src = imageFor(story);
    media.querySelector("img").alt = `Copertina: ${story.title}`;
    media.querySelector(".dialog-media-label").textContent = story.category.toLocaleUpperCase("it");
  }
  pdfFrame.hidden = !story.pdfUrl;
  if (story.pdfUrl) articleDialog.querySelector("#dialog-pdf").src = story.pdfUrl;
  else articleDialog.querySelector("#dialog-pdf").removeAttribute("src");
  const body = articleDialog.querySelector(".dialog-body");
  body.dataset.presentation = story.presentation || "article";
  body.replaceChildren(...String(story.body || "").split(/\n\n+/).filter(Boolean).map((paragraph) => {
    const element = document.createElement("p");
    element.textContent = paragraph;
    return element;
  }));
  const saved = readLocalSet(savedKey).has(story.id);
  const saveButton = articleDialog.querySelector("[data-action='save-current']");
  saveButton.setAttribute("aria-pressed", String(saved));
  saveButton.querySelector("span").textContent = saved ? "Rimuovi dai salvati" : "Salva articolo";
  articleDialog.showModal();
  registerView(story);
}

function updateAccount(user) {
  currentUser = user;
  const signedIn = Boolean(user);
  document.querySelectorAll(".requires-writer").forEach((element) => { element.hidden = !signedIn; });
  document.querySelector("#account-open").hidden = signedIn;
  document.querySelector("#register-open").hidden = signedIn;
  document.querySelector("#profile-button").hidden = !signedIn;
  document.querySelector("#profile-name").textContent = user?.name.split(" ")[0] || "";
  document.querySelector("#profile-mark").textContent = user?.name.charAt(0).toLocaleUpperCase("it") || "S";
}

function setAuthMode(register) {
  signupMode = register;
  document.querySelector("#auth-title").textContent = register ? "Entra in redazione." : "Bentornato.";
  document.querySelector("#auth-intro").textContent = register ? "Crea un account: ogni nuovo account accede agli strumenti redazionali." : "Accedi al tuo account Salvemini Times.";
  document.querySelector("#auth-name").hidden = !register;
  document.querySelector("#auth-name").required = register;
  document.querySelector("#auth-name-label").hidden = !register;
  document.querySelector("#auth-password").autocomplete = register ? "new-password" : "current-password";
  document.querySelector("#auth-submit").innerHTML = register ? "Crea account <span aria-hidden=\"true\">↗</span>" : "Accedi <span aria-hidden=\"true\">↗</span>";
  document.querySelector("#auth-toggle-copy").textContent = register ? "Hai già un account?" : "Non hai un account?";
  document.querySelector("#auth-mode-toggle").textContent = register ? "Accedi" : "Diventa redattore";
  document.querySelector("#auth-error").textContent = "";
}

async function loadApplication() {
  try {
    viewerId = getViewerId();
    const [articleResult, userResult, statusResult] = await Promise.all([request(`/api/articles?viewerId=${encodeURIComponent(viewerId)}`), request("/api/me"), request("/api/status")]);
    stories = articleResult.articles;
    updateAccount(userResult.user);
    const aiStatus = document.querySelector("#ai-status");
    aiStatus.classList.toggle("ready", statusResult.aiAvailable);
    aiStatus.title = statusResult.aiAvailable ? `Revisione attiva · ${statusResult.aiModel}` : "Revisione richiesta ma non configurata: pubblicazione sospesa";
    aiStatus.querySelector("span").textContent = statusResult.aiAvailable ? "Gemini editoriale attivo" : "Gemini non configurato";
    document.querySelector(".editor-dialog .publish-button").disabled = !statusResult.aiAvailable;
    if (!statusResult.aiAvailable) document.querySelector("#editor-status").textContent = "Per pubblicare collega Gemini dal menu profilo. Nessun articolo verrà accettato senza revisione.";
  } catch (error) {
    showToast("Server non raggiungibile. Avvia Salvemini Times dal terminale.");
  }
  renderFeeds();
}

function setCategory(category) {
  activeCategory = category;
  activeView = category === "Video" ? "video" : "home";
  categoryButtons.forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".sidebar-link[data-category]").forEach((button) => button.classList.toggle("active", button.dataset.category === category));
  document.querySelectorAll(".sidebar-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === "home" && category === "Tutte"));
  renderRecommendations();
  renderStories();
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("L’allegato non è leggibile.")));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Immagine non leggibile."));
      image.src = objectUrl;
    });
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.84);
  } finally { URL.revokeObjectURL(objectUrl); }
}

async function extractPdf(file) {
  if (!window.pdfjsLib) throw new Error("Lettore PDF non caricato. Verifica la connessione e riprova.");
  if (file.size > 14 * 1024 * 1024) throw new Error("Il PDF supera il limite di 14 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  if (pdf.numPages > 60) throw new Error("Il PDF supera il limite di 60 pagine.");
  const pageTexts = [];
  let firstPageCover = "";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).filter(Boolean).join(" "));
    if (pageNumber === 1) {
      const viewport = page.getViewport({ scale: Math.min(1.6, 1200 / page.getViewport({ scale: 1 }).width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      firstPageCover = canvas.toDataURL("image/webp", 0.84);
    }
  }
  const extractedText = pageTexts.join("\n\n").trim();
  if (extractedText.length < 80) throw new Error("Questo PDF sembra una scansione senza testo selezionabile. Incolla una trascrizione OCR per la revisione AI.");
  if (extractedText.length > 36000) throw new Error("Il testo estratto supera 36.000 caratteri: allega un estratto più breve.");
  return { text: extractedText, cover: firstPageCover, pdfBase64: await dataUrlFromFile(file) };
}

function updateEditorPreview() {
  const title = document.querySelector("#article-title").value.trim();
  const summary = document.querySelector("#article-summary").value.trim();
  const category = document.querySelector("#article-category").value;
  const body = document.querySelector("#article-body").value;
  document.querySelector("#preview-title").textContent = title || "Titolo dell’articolo";
  document.querySelector("#preview-summary").textContent = summary || "Il sommario accompagna titolo e copertina.";
  document.querySelector("#preview-category").textContent = category.toLocaleUpperCase("it");
  document.querySelector("#preview-body").textContent = body || "Qui apparirà il testo, senza alterazioni.";
  document.querySelector("#integrity-check").textContent = body ? "Il testo mostrato coincide con il testo inserito." : "Il testo originale non verrà riscritto.";
  const preview = document.querySelector("#cover-preview");
  const placeholder = document.querySelector("#cover-placeholder");
  const source = coverData || document.querySelector("#article-cover").value.trim();
  preview.hidden = !source;
  placeholder.hidden = Boolean(source);
  if (source) preview.src = source;
  document.querySelector("#video-url-field").hidden = document.querySelector("#article-kind").value !== "video";
}

async function submitArticle(event) {
  event.preventDefault();
  if (!editorForm.reportValidity()) return;
  const body = document.querySelector("#article-body").value;
  if (body.trim().length < 80) {
    document.querySelector("#editor-status").textContent = "Per il controllo editoriale servono almeno 80 caratteri di testo.";
    return;
  }
  const cover = coverData || document.querySelector("#article-cover").value.trim();
  if (!cover) {
    document.querySelector("#editor-status").textContent = "Aggiungi una copertina o carica un PDF da cui generarla.";
    document.querySelector("#article-cover").focus();
    return;
  }
  const publishButton = document.querySelector(".publish-button");
  publishButton.disabled = true;
  publishButton.textContent = "Revisione Gemini in corso…";
  document.querySelector("#editor-status").textContent = "Il testo viene verificato da Gemini. Non verrà pubblicato finché la revisione non è conclusa.";
  try {
    const result = await request("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.querySelector("#article-title").value,
        category: document.querySelector("#article-category").value,
        summary: document.querySelector("#article-summary").value,
        body,
        cover,
        pdfBase64: selectedPdf?.pdfBase64 || "",
        kind: document.querySelector("#article-kind").value,
        videoUrl: document.querySelector("#article-video-url").value,
      }),
    });
    stories.unshift(result.article);
    showAllStories = true;
    activeView = "home";
    activeCategory = "Tutte";
    document.querySelector("#sort-order").value = "recent";
    renderFeeds();
    editorDialog.close();
    editorForm.reset();
    selectedPdf = null;
    coverData = "";
    document.querySelector("#pdf-status").textContent = "Il documento originale verrà conservato nell’articolo.";
    updateEditorPreview();
    showToast("Articolo pubblicato dopo la revisione editoriale.");
  } catch (error) {
    document.querySelector("#editor-status").textContent = error.message;
  } finally {
    publishButton.disabled = false;
    publishButton.innerHTML = "Pubblica articolo <span>↗</span>";
  }
}

function setSearch(value) {
  searchTerm = value.trim();
  activeView = "home";
  renderRecommendations();
  renderStories();
}

document.addEventListener("click", (event) => {
  const articleTrigger = event.target.closest("[data-article]");
  if (articleTrigger) {
    openArticle(stories.find((story) => story.id === articleTrigger.dataset.article));
    return;
  }
  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    setCategory(categoryButton.dataset.category);
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    activeView = viewButton.dataset.view;
    activeCategory = "Tutte";
    searchTerm = "";
    searchInput.value = "";
    document.querySelectorAll(".sidebar-link").forEach((button) => button.classList.toggle("active", button === viewButton));
    categoryButtons.forEach((button) => { const selected = button.dataset.category === "Tutte"; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
    renderRecommendations();
    renderStories();
    if (activeView === "video") document.querySelector("#video-section").scrollIntoView({ behavior: "smooth" });
    else if (activeView === "trending") document.querySelector("#trending").scrollIntoView({ behavior: "smooth" });
    else document.querySelector("#inizio").scrollIntoView({ behavior: "smooth" });
    document.querySelector(".sidebar").classList.remove("open");
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "like-current") {
    void toggleLike(articleDialog.dataset.articleId);
    return;
  }
  if (action?.dataset.action === "save-current") {
    const saved = readLocalSet(savedKey);
    const id = articleDialog.dataset.articleId;
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    writeLocalSet(savedKey, saved);
    if (saved.has(id)) {
      const story = stories.find((entry) => entry.id === id);
      if (story) recordInterest(story, 2);
    }
    action.setAttribute("aria-pressed", String(saved.has(id)));
    action.querySelector("span").textContent = saved.has(id) ? "Rimuovi dai salvati" : "Salva articolo";
    renderFeeds();
    showToast(saved.has(id) ? "Articolo salvato" : "Articolo rimosso dai salvati");
    return;
  }
  if (action?.dataset.action === "like") {
    void toggleLike(action.dataset.id);
    return;
  }
  if (action?.dataset.action === "save") {
    const key = savedKey;
    const values = readLocalSet(key);
    if (values.has(action.dataset.id)) values.delete(action.dataset.id); else values.add(action.dataset.id);
    writeLocalSet(key, values);
    if (values.has(action.dataset.id)) {
      const story = stories.find((entry) => entry.id === action.dataset.id);
      if (story) recordInterest(story, 2);
    }
    renderFeeds();
  }
});

searchInput.addEventListener("input", () => setSearch(searchInput.value));
document.querySelector("#search-form").addEventListener("submit", (event) => { event.preventDefault(); setSearch(searchInput.value); document.querySelector("#storie").scrollIntoView({ behavior: "smooth" }); });
categoryButtons.forEach((button) => button.addEventListener("click", () => setCategory(button.dataset.category)));
document.querySelector("#sort-order").addEventListener("change", renderStories);
document.querySelector("#load-more").addEventListener("click", () => { showAllStories = true; renderStories(); });
document.querySelector(".menu-toggle").addEventListener("click", (event) => {
  const sidebar = document.querySelector(".sidebar");
  const opening = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", opening);
  event.currentTarget.setAttribute("aria-expanded", String(opening));
});

function openAuth(register = false) {
  setAuthMode(register);
  authDialog.showModal();
}

async function openGeminiSettings() {
  if (!currentUser) {
    openAuth(true);
    return;
  }
  document.querySelector("#profile-menu").hidden = true;
  const status = document.querySelector("#gemini-settings-status");
  status.textContent = "";
  document.querySelector("#gemini-api-key").value = "";
  try {
    const settings = await request("/api/settings/gemini");
    document.querySelector("#gemini-model").value = settings.model || "gemini-2.5-flash";
    status.textContent = settings.configured ? `Gemini è configurato (${settings.model}). Inserisci una nuova chiave solo per sostituirla.` : "Nessuna chiave configurata. La pubblicazione resta sospesa fino alla verifica.";
    geminiSettingsDialog.showModal();
  } catch (error) { showToast(error.message); }
}

document.querySelector("#account-open").addEventListener("click", () => openAuth(false));
document.querySelector("#register-open").addEventListener("click", () => openAuth(true));
document.querySelector("#auth-mode-toggle").addEventListener("click", () => setAuthMode(!signupMode));
document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  document.querySelector("#auth-error").textContent = "";
  try {
    const payload = { email: document.querySelector("#auth-email").value, password: document.querySelector("#auth-password").value };
    if (signupMode) payload.name = document.querySelector("#auth-name").value;
    const result = await request(signupMode ? "/api/register" : "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    updateAccount(result.user);
    authDialog.close();
    document.querySelector("#auth-form").reset();
    showToast(signupMode ? "Account redattore creato." : `Bentornato, ${result.user.name}.`);
  } catch (error) { document.querySelector("#auth-error").textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelector("#profile-button").addEventListener("click", () => {
  const menu = document.querySelector("#profile-menu");
  menu.hidden = !menu.hidden;
});
document.querySelector("#gemini-settings-open").addEventListener("click", openGeminiSettings);
document.querySelector("#signout-button").addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" }).catch(() => {});
  updateAccount(null);
  document.querySelector("#profile-menu").hidden = true;
  showToast("Hai chiuso la sessione.");
});

document.querySelector("#editor-open").addEventListener("click", () => currentUser ? editorDialog.showModal() : openAuth(true));
document.querySelector("#editor-sidebar").addEventListener("click", () => currentUser ? editorDialog.showModal() : openAuth(true));
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
articleDialog.addEventListener("click", (event) => { if (event.target === articleDialog) articleDialog.close(); });
editorDialog.addEventListener("click", (event) => { if (event.target === editorDialog) editorDialog.close(); });
authDialog.addEventListener("click", (event) => { if (event.target === authDialog) authDialog.close(); });
geminiSettingsDialog.addEventListener("click", (event) => { if (event.target === geminiSettingsDialog) geminiSettingsDialog.close(); });
geminiSettingsDialog.addEventListener("close", () => { document.querySelector("#gemini-api-key").value = ""; });

document.querySelector("#gemini-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#gemini-save-button");
  const status = document.querySelector("#gemini-settings-status");
  const apiKey = document.querySelector("#gemini-api-key").value;
  button.disabled = true;
  status.textContent = "Verifico la chiave con Google AI Studio…";
  try {
    const settings = await request("/api/settings/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, model: document.querySelector("#gemini-model").value }),
    });
    document.querySelector("#gemini-api-key").value = "";
    const aiStatus = document.querySelector("#ai-status");
    aiStatus.classList.add("ready");
    aiStatus.title = `Gemini verificato · ${settings.model}`;
    aiStatus.querySelector("span").textContent = "Gemini editoriale attivo";
    document.querySelector(".editor-dialog .publish-button").disabled = false;
    status.textContent = "Chiave verificata e salvata sul server locale. Il browser non la conserva.";
    showToast("Gemini è collegato. La revisione editoriale è attiva.");
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

editorForm.addEventListener("input", updateEditorPreview);
editorForm.addEventListener("change", updateEditorPreview);
document.querySelector("#article-kind").addEventListener("change", (event) => {
  const isVideo = event.target.value === "video";
  document.querySelector("#article-category").value = isVideo ? "Video" : "Attualità";
  document.querySelector("#article-video-url").required = isVideo;
  document.querySelector("#video-url-field").hidden = !isVideo;
  updateEditorPreview();
});
document.querySelector("#article-category").addEventListener("change", (event) => {
  if (event.target.value === "Video") document.querySelector("#article-kind").value = "video";
  updateEditorPreview();
});
document.querySelector("#prepare-article").addEventListener("click", () => {
  const body = document.querySelector("#article-body").value;
  updateEditorPreview();
  document.querySelector("#editor-status").textContent = body ? "Anteprima pronta. Le parole restano identiche al testo originale." : "Scrivi il pezzo o seleziona un PDF leggibile per iniziare.";
});
editorForm.addEventListener("submit", submitArticle);
document.querySelector("#empty-register").addEventListener("click", () => openAuth(true));

document.querySelector("#cover-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    coverData = await compressImage(file);
    document.querySelector("#article-cover").value = "";
    updateEditorPreview();
    showToast("Copertina pronta.");
  } catch (error) { showToast(error.message); }
});

document.querySelector("#pdf-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.querySelector("#pdf-status");
  status.textContent = "Lettura del PDF e preparazione dell’anteprima…";
  document.querySelector("#editor-status").textContent = "";
  try {
    selectedPdf = await extractPdf(file);
    document.querySelector("#article-body").value = selectedPdf.text;
    document.querySelector("#body-origin").textContent = "estratto dal PDF, ancora modificabile";
    coverData = selectedPdf.cover;
    document.querySelector("#article-cover").value = "";
    const data = await dataUrlFromFile(file);
    selectedPdf.pdfBase64 = data;
    status.textContent = `PDF letto: ${file.name} · ${selectedPdf.text.length.toLocaleString("it-IT")} caratteri estratti. Il documento originale resta inalterato.`;
    updateEditorPreview();
  } catch (error) {
    selectedPdf = null;
    status.textContent = error.message;
    document.querySelector("#editor-status").textContent = "Il PDF non è stato caricato. Puoi continuare incollando il testo.";
  }
});

document.querySelector("#cover-preview").addEventListener("error", () => {
  document.querySelector("#cover-preview").hidden = true;
  document.querySelector("#cover-placeholder").hidden = false;
  document.querySelector("#cover-placeholder").textContent = "Immagine non disponibile";
});

renderFeeds();
loadApplication();
