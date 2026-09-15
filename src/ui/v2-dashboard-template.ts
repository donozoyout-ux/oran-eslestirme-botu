import { v2DashboardClient } from "./v2-dashboard-client.js";
import { v2DashboardStyles } from "./v2-dashboard-styles.js";

export const v2DashboardHtml = String.raw`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#07100d">
  <title>Oran Analiz V2</title>
  <style>${v2DashboardStyles}</style>
</head>
<body>
<div class="v2-app">
  <header class="v2-top">
    <div class="brand"><span class="brand-mark">OA</span><div><strong>Oran Analiz</strong><small>V2 · sade maç merkezi</small></div></div>
    <nav class="tabs" aria-label="Ana bölümler">
      <button class="active" data-view="matches">Bugünün Maçları</button>
      <button data-view="candidates">Güçlü Adaylar</button>
      <button data-view="iddaa">İddaa Oranları</button>
      <button data-view="system">Sistem</button>
    </nav>
    <div class="top-actions"><span class="status"><span class="dot" id="statusDot"></span><span id="statusText">Bağlanıyor</span></span><button class="button" id="refreshButton">Yenile</button></div>
  </header>

  <main>
    <div class="notice" id="notice" hidden></div>

    <section class="view active" data-page="matches">
      <div class="hero"><div><p class="eyebrow">Bugünün futbol programı</p><h1>Maçlar ve analizler</h1><p>Oranları karşılaştır, favoriyi gör, maça basıp form ve öneri detayını aç.</p></div><small id="updatedAt">Veri bekleniyor</small></div>
      <div class="summary" id="summary"></div>
      <div class="toolbar">
        <div class="segmented" id="matchFilters">
          <button class="active" data-filter="all">Tümü</button>
          <button data-filter="strong_candidate">Güçlü</button>
          <button data-filter="candidate">Aday</button>
          <button data-filter="watch">İzle</button>
          <button data-filter="value">Value</button>
        </div>
        <select class="select" id="leagueFilter"><option value="all">Tüm ligler</option></select>
        <input class="search" id="search" type="search" placeholder="Takım veya lig ara">
      </div>
      <div class="match-list" id="matchList"></div>
    </section>

    <section class="view" data-page="candidates">
      <div class="hero"><div><p class="eyebrow">Filtrelenmiş sinyaller</p><h2>Güçlü Adaylar</h2><p>Yalnız yeterli kaynak, veri güveni ve bağımsız form desteği olan maçlar.</p></div></div>
      <div class="candidate-grid" id="candidateGrid"></div>
    </section>

    <section class="view" data-page="iddaa">
      <div class="hero"><div><p class="eyebrow">Türkiye oran akışı</p><h2>İddaa Oranları</h2><p>Mackolik / İddaa akışındaki maçları sade kartlarla gösterir.</p></div></div>
      <div class="match-list" id="iddaaList"></div>
    </section>

    <section class="view" data-page="system">
      <div class="hero"><div><p class="eyebrow">Operasyon durumu</p><h2>Sistem</h2><p>Odds kaynakları ve istatistik servislerinin sağlık durumu.</p></div><a class="button" href="/legacy">Eski panel</a></div>
      <div class="system-grid" id="systemGrid"></div>
    </section>
  </main>
</div>

<aside class="drawer" id="drawer" role="dialog" aria-modal="true" hidden>
  <header class="drawer-head"><div><p class="eyebrow" id="drawerLeague">Maç detayı</p><h2 id="drawerTitle">Karşılaşma</h2><p id="drawerMeta"></p></div><button class="button" id="drawerClose">Kapat</button></header>
  <nav class="drawer-tabs">
    <button class="active" data-detail="summary">Özet</button>
    <button data-detail="odds">Oranlar</button>
    <button data-detail="form">Form</button>
    <button data-detail="stats">İstatistik</button>
    <button data-detail="movement">Oran Hareketi</button>
    <button data-detail="analysis">Analiz</button>
    <button data-detail="recommendation">Öneri</button>
  </nav>
  <div class="drawer-body" id="drawerBody"></div>
</aside>
<script>${v2DashboardClient}</script>
</body>
</html>`;