export const v2DashboardClient = String.raw`
(() => {
  "use strict";
  const state = { matches: [], summary: {}, recommendations: null, status: null, filter: "all", league: "all", search: "", selected: null, detail: "summary" };
  const byId = (id) => document.getElementById(id);
  const create = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = String(value); return node; };
  const empty = (message) => create("div", "empty", message);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—";
  const price = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
  const pct = (value) => Number.isFinite(Number(value)) ? "%" + Number(value).toFixed(1) : "—";
  const time = (value) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(value)) : "—";
  const date = (value) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value)) : "—";
  const norm = (value) => String(value || "").toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/g, " ").trim();
  const badge = (text, tone) => create("span", "badge " + (tone || ""), text);
  const decisionLabel = (value) => value === "strong_candidate" ? "GÜÇLÜ ADAY" : value === "candidate" ? "ADAY" : value === "watch" ? "İZLE" : value === "pass" ? "PAS" : "VERİ YETERSİZ";
  const decisionTone = (value) => value === "strong_candidate" ? "green" : value === "candidate" ? "blue" : value === "watch" ? "amber" : value === "pass" ? "red" : "";
  const kv = (label, value) => { const row = create("div", "kv"); row.append(create("span", "", label), create("strong", "", value)); return row; };
  const metric = (label, value, meta) => { const card = create("article", "metric"); card.append(create("span", "", label), create("strong", "", value), create("small", "", meta)); return card; };
  const featureValue = (feature, formatter) => {
    if (!feature || feature.availability === "unavailable" || feature.value === null || feature.value === undefined) return "Veri yok";
    return (formatter || number)(feature.value);
  };
  const sourceTone = (source) => source.includes("İddaa") ? "green" : source.includes("BetExplorer") ? "blue" : source.includes("Odds API") ? "amber" : "";

  function setView(view) {
    document.querySelectorAll("[data-page]").forEach((node) => node.classList.toggle("active", node.dataset.page === view));
    document.querySelectorAll("[data-view]").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  }

  function renderSummary() {
    const root = byId("summary"); root.replaceChildren();
    root.append(
      metric("Bugünün maçları", number(state.summary.matches || 0), "Güncel oranı bulunan"),
      metric("Güçlü aday", number(state.summary.strongCandidates || 0), "80+ skor ve veri desteği"),
      metric("Çoklu kaynak", number(state.summary.withMultipleSources || 0), "En az 2 bookmaker"),
      metric("İddaa maçları", number(state.summary.iddaaMatches || 0), "Mackolik / İddaa akışı")
    );
  }

  function populateLeagues() {
    const select = byId("leagueFilter");
    const current = state.league;
    select.replaceChildren();
    const all = create("option", "", "Tüm ligler"); all.value = "all"; select.append(all);
    [...new Set(state.matches.map((match) => match.leagueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")).forEach((league) => {
      const option = create("option", "", league); option.value = league; select.append(option);
    });
    select.value = [...select.options].some((option) => option.value === current) ? current : "all";
    state.league = select.value;
  }

  function isValue(match) {
    return Number(match.recommendation && match.recommendation.priceAdvantagePercent) >= 2;
  }

  function visibleMatches() {
    return state.matches.filter((match) => {
      if (state.filter !== "all" && state.filter !== "value" && match.recommendation.decision !== state.filter) return false;
      if (state.filter === "value" && !isValue(match)) return false;
      if (state.league !== "all" && match.leagueName !== state.league) return false;
      if (state.search && !norm(match.event + " " + match.leagueName).includes(norm(state.search))) return false;
      return true;
    });
  }

  function oddsMini(match) {
    const root = create("div", "odds-mini");
    ["1", "X", "2"].forEach((label) => {
      const cell = create("div", "odd"); const row = match.bestOdds && match.bestOdds[label];
      cell.append(create("span", "", label), create("strong", "", row ? price(row.price) : "—")); root.append(cell);
    });
    return root;
  }

  function matchCard(match) {
    const button = create("button", "match-card"); button.type = "button";
    const kick = create("div", "kick"); kick.append(create("strong", "", time(match.commenceTime)), create("span", "", match.phase === "live" ? "CANLI" : date(match.commenceTime)));
    const teams = create("div", "teams"); teams.append(create("strong", "", match.event), create("span", "", match.leagueName));
    const favorite = create("div", "cell"); favorite.append(create("strong", "", match.favorite.team || "Belirsiz"), create("span", "", match.favorite.marketProbability === null ? "Piyasa olasılığı yok" : "Piyasa " + pct(match.favorite.marketProbability)));
    const sources = create("div", "cell sources-cell"); const row = create("div", "source-row");
    (match.sources || []).slice(0, 4).forEach((source) => row.append(badge(source, sourceTone(source)))); sources.append(row);
    const recommendation = create("div", "cell"); recommendation.append(badge(decisionLabel(match.recommendation.decision), decisionTone(match.recommendation.decision)), create("strong", "score", number(match.recommendation.score) + "/100"), create("span", "", match.recommendation.selection || "Öneri yok"));
    button.append(kick, teams, favorite, oddsMini(match), sources, recommendation, create("span", "arrow", "›"));
    button.addEventListener("click", () => openDrawer(match));
    return button;
  }

  function renderMatches() {
    populateLeagues();
    const root = byId("matchList"); root.replaceChildren();
    const matches = visibleMatches();
    if (!matches.length) { root.append(empty("Bu filtrede gösterilecek maç yok. Kaynaklar veri topladıkça kartlar burada oluşur.")); return; }
    matches.forEach((match) => root.append(matchCard(match)));
  }

  function renderCandidates() {
    const root = byId("candidateGrid"); root.replaceChildren();
    const matches = state.matches.filter((match) => match.recommendation.decision === "strong_candidate" || match.recommendation.decision === "candidate");
    if (!matches.length) { root.append(empty("Şu an güçlü aday yok. Sistem eksik veriyle aday uydurmuyor.")); return; }
    matches.forEach((match) => {
      const card = create("article", "candidate-card");
      card.append(create("p", "eyebrow", match.leagueName), create("h3", "", match.event));
      const meta = create("div", "candidate-meta");
      meta.append(badge(decisionLabel(match.recommendation.decision), decisionTone(match.recommendation.decision)), badge("Güven " + number(match.recommendation.confidence), "blue"), badge(match.recommendation.sourceCount + " kaynak", ""));
      const main = create("div", "candidate-main");
      const left = create("div"); left.append(create("span", "", "Öneri"), create("strong", "", match.recommendation.selection || "—"));
      const right = create("div"); right.append(create("span", "", "En iyi oran"), create("strong", "good", price(match.recommendation.bestPrice)));
      main.append(left, right);
      const reasons = create("ul", "reason-list"); (match.recommendation.reasons || []).slice(0, 4).forEach((reason) => reasons.append(create("li", "", "• " + reason)));
      card.append(meta, main, reasons); card.addEventListener("click", () => openDrawer(match)); root.append(card);
    });
  }

  function renderIddaa() {
    const root = byId("iddaaList"); root.replaceChildren();
    const matches = state.matches.filter((match) => (match.oddsTable || []).some((row) => row.provider === "mackolik_iddaa"));
    if (!matches.length) { root.append(empty("Mackolik / İddaa oranı henüz gelmedi. Provider çalışınca burada görünecek.")); return; }
    matches.forEach((match) => root.append(matchCard(match)));
  }

  function renderSystem() {
    const root = byId("systemGrid"); root.replaceChildren();
    const diagnostics = state.status && state.status.providerDiagnostics || {};
    const groups = [
      { title: "Odds Sources", keys: ["mackolik_iddaa", "betexplorer_scraper", "the_odds_api"] },
      { title: "Stats / Fixture", keys: ["sportmonks", "football_data", "api_football", "match_intelligence"] },
      { title: "Runtime", keys: ["historical_archive"] },
    ];
    groups.forEach((group) => {
      const card = create("article", "system-card"); card.append(create("h3", "", group.title));
      group.keys.forEach((key) => {
        const info = diagnostics[key] || {};
        const status = info.status || (info.lastError ? "error" : info.lastSuccessAt ? "ok" : "waiting");
        const row = create("div", "system-row");
        const label = key === "mackolik_iddaa" ? "Mackolik / İddaa" : key === "betexplorer_scraper" ? "BetExplorer" : key === "the_odds_api" ? "The Odds API" : key.replaceAll("_", " ");
        row.append(create("span", "", label), badge(String(status), status === "ok" ? "green" : status === "error" ? "red" : "amber")); card.append(row);
      });
      root.append(card);
    });
  }

  function detailCard(title, rows, full) {
    const card = create("article", "detail-card" + (full ? " full" : "")); card.append(create("h3", "", title));
    rows.forEach((row) => card.append(kv(row[0], row[1]))); return card;
  }

  function oddsTable(match) {
    const wrap = create("div", "table-wrap"); const table = document.createElement("table");
    const head = document.createElement("thead"), hr = document.createElement("tr");
    ["Kaynak", "1", "X", "2", "1X", "X2", "O2.5", "U2.5"].forEach((label) => hr.append(create("th", "", label))); head.append(hr);
    const body = document.createElement("tbody");
    (match.oddsTable || []).forEach((source) => {
      const tr = document.createElement("tr"); tr.append(create("td", "", source.source));
      ["1", "X", "2", "1X", "X2", "O2.5", "U2.5"].forEach((label) => {
        const td = create("td", source.prices && source.prices[label] ? "price" : "", source.prices && source.prices[label] ? price(source.prices[label]) : "—"); tr.append(td);
      });
      body.append(tr);
    });
    table.append(head, body); wrap.append(table); return wrap;
  }

  function renderDrawer() {
    const match = state.selected; if (!match) return;
    byId("drawerLeague").textContent = match.leagueName; byId("drawerTitle").textContent = match.event;
    byId("drawerMeta").textContent = date(match.commenceTime) + " · " + match.sources.join(" · ");
    document.querySelectorAll("[data-detail]").forEach((button) => button.classList.toggle("active", button.dataset.detail === state.detail));
    const root = byId("drawerBody"); root.replaceChildren();

    if (state.detail === "summary") {
      const grid = create("div", "detail-grid");
      grid.append(
        detailCard("Favori", [["Taraf", match.favorite.team || "Belirsiz"], ["Piyasa olasılığı", match.favorite.marketProbability === null ? "Veri yok" : pct(match.favorite.marketProbability)], ["Favori skoru", number(match.favorite.score) + "/100"], ["Veri güveni", number(match.dataConfidence) + "/100"]]),
        detailCard("Öneri durumu", [["Karar", decisionLabel(match.recommendation.decision)], ["Öneri", match.recommendation.selection || "Yok"], ["En iyi oran", price(match.recommendation.bestPrice)], ["Kaynak sayısı", number(match.recommendation.sourceCount)]])
      ); root.append(grid); return;
    }
    if (state.detail === "odds") { root.append(oddsTable(match)); return; }
    if (state.detail === "form") {
      if (!match.form || !match.form.available) { root.append(empty("Bu maç için form verisi mevcut değil.")); return; }
      const grid = create("div", "detail-grid");
      [match.form.home, match.form.away].forEach((team) => {
        if (!team) return;
        grid.append(detailCard(team.team + " · Son 5", [["W-D-L", number(team.last5.wins) + "-" + number(team.last5.draws) + "-" + number(team.last5.losses)], ["PPG", number(team.last5.ppg)], ["Gol / maç", number(team.last5.gf)], ["Yenen gol / maç", number(team.last5.ga)], ["BTTS", pct(team.last5.btts)], ["Over 2.5", pct(team.last5.over25)]]));
        grid.append(detailCard(team.team + " · Saha", [["PPG", number(team.venue.ppg)], ["Gol / maç", number(team.venue.gf)], ["Yenen gol / maç", number(team.venue.ga)], ["BTTS", pct(team.venue.btts)], ["Over 2.5", pct(team.venue.over25)]]));
      });
      root.append(grid); return;
    }
    if (state.detail === "stats") {
      const intel = match.intelligence;
      if (!intel) { root.append(empty("İstatistik verisi mevcut değil.")); return; }
      const grid = create("div", "detail-grid");
      [intel.home, intel.away].forEach((team) => {
        const stats = team.stats && team.stats.last5;
        grid.append(detailCard(team.team + " · Son 5", [["xG", featureValue(stats && stats.xg)], ["xGA", featureValue(stats && stats.xga)], ["Şut", featureValue(stats && stats.shots)], ["İsabetli şut", featureValue(stats && stats.shotsOnTarget)], ["Korner", featureValue(stats && stats.corners)], ["Topa sahip olma", featureValue(stats && stats.possession, pct)]]));
      });
      root.append(grid); return;
    }
    if (state.detail === "movement") {
      if (!match.movements || !match.movements.length) { root.append(empty("Bu maç için anlamlı oran hareketi kaydı yok.")); return; }
      match.movements.forEach((movement) => root.append(detailCard(movement.market + " · " + movement.selection, [["Hareket", movement.type], ["Detay", movement.detail], ["Zaman", date(movement.detectedAt)]], true))); return;
    }
    if (state.detail === "analysis") {
      const grid = create("div", "detail-grid");
      grid.append(detailCard("Nedenler", (match.recommendation.reasons || []).map((item, index) => [String(index + 1), item]), true), detailCard("Riskler", (match.recommendation.risks || []).map((item, index) => [String(index + 1), item]), true));
      root.append(grid); return;
    }
    if (state.detail === "recommendation") {
      const callout = create("div", "callout");
      callout.append(create("p", "eyebrow", decisionLabel(match.recommendation.decision)), create("h3", "", match.recommendation.selection || "Öneri üretilemedi"), create("div", "big", match.recommendation.bestPrice ? price(match.recommendation.bestPrice) : "—"));
      callout.append(kv("Skor", number(match.recommendation.score) + "/100"), kv("Güven", number(match.recommendation.confidence) + "/100"), kv("Bookmaker", match.recommendation.bookmaker || "Veri yok"), kv("Fiyat avantajı", match.recommendation.priceAdvantagePercent === null ? "Veri yok" : pct(match.recommendation.priceAdvantagePercent)));
      const risks = create("ul", "reason-list"); (match.recommendation.risks || []).forEach((item) => risks.append(create("li", "risk", "• " + item))); callout.append(risks); root.append(callout);
    }
  }

  function openDrawer(match) { state.selected = match; state.detail = "summary"; byId("drawer").hidden = false; document.body.style.overflow = "hidden"; renderDrawer(); }
  function closeDrawer() { byId("drawer").hidden = true; document.body.style.overflow = ""; state.selected = null; }

  function renderAll() { renderSummary(); renderMatches(); renderCandidates(); renderIddaa(); renderSystem(); if (state.selected) renderDrawer(); }

  async function json(response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }
  async function refresh() {
    byId("refreshButton").disabled = true;
    try {
      const results = await Promise.all([
        fetch("/v2/matches", { cache: "no-store" }).then(json),
        fetch("/v2/recommendations", { cache: "no-store" }).then(json),
        fetch("/status", { cache: "no-store" }).then(json),
      ]);
      state.matches = Array.isArray(results[0].matches) ? results[0].matches : [];
      state.summary = results[0].summary || {};
      state.recommendations = results[1];
      state.status = results[2];
      byId("updatedAt").textContent = "Son güncelleme " + date(results[0].generatedAt);
      byId("statusDot").className = "dot ok"; byId("statusText").textContent = "Railway bağlı";
      byId("notice").hidden = true; renderAll();
    } catch (error) {
      byId("statusDot").className = "dot"; byId("statusText").textContent = "Veri alınamadı";
      byId("notice").textContent = "Yeni veri alınamadı. Son görünüm korunuyor: " + (error instanceof Error ? error.message : String(error));
      byId("notice").hidden = false;
    } finally { byId("refreshButton").disabled = false; }
  }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter || "all"; document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button)); renderMatches();
  }));
  document.querySelectorAll("[data-detail]").forEach((button) => button.addEventListener("click", () => { state.detail = button.dataset.detail || "summary"; renderDrawer(); }));
  byId("leagueFilter").addEventListener("change", (event) => { state.league = event.target.value; renderMatches(); });
  byId("search").addEventListener("input", (event) => { state.search = event.target.value; renderMatches(); });
  byId("drawerClose").addEventListener("click", closeDrawer);
  byId("refreshButton").addEventListener("click", refresh);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !byId("drawer").hidden) closeDrawer(); });
  refresh(); setInterval(refresh, 20000);
})();
`;