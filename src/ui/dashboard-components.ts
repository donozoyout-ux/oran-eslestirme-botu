export const dashboardShell = String.raw`
<a class="skip-link" href="#main-content">İçeriğe geç</a>
<div class="app-shell">
  <aside class="sidebar" id="sidebar" aria-label="Ana navigasyon">
    <div class="brand"><span class="brand-mark" aria-hidden="true">OE</span><div><strong>Oran Eşleştirme</strong><small>Market Intelligence</small></div></div>
    <nav class="nav-list">
      <button class="nav-item active" data-view="overview" aria-controls="page-overview"><span>⌁</span>Genel Bakış</button>
      <button class="nav-item" data-view="matches" aria-controls="page-matches"><span>▦</span>Bugünün Maçları</button>
      <button class="nav-item" data-view="analysis" aria-controls="page-analysis"><span>◫</span>Maç Analizi</button>
      <button class="nav-item" data-view="historical" aria-controls="page-historical"><span>↺</span>Historical</button>
      <button class="nav-item" data-view="market" aria-controls="page-market"><span>≋</span>Market</button>
      <button class="nav-item" data-view="system" aria-controls="page-system"><span>◇</span>Sistem</button>
      <button class="nav-item" data-view="settings" aria-controls="page-settings"><span>⚙</span>Ayarlar</button>
    </nav>
    <div class="sidebar-foot"><span class="pulse" id="sidebarPulse"></span><div><strong id="sidebarStatus">Bağlanıyor</strong><small id="sidebarUpdated">İlk veri bekleniyor</small></div></div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <button class="icon-button menu-button" id="menuButton" aria-label="Menüyü aç" aria-expanded="false" aria-controls="sidebar">☰</button>
      <div><p class="eyebrow">Production dashboard</p><h1 id="pageTitle">Genel Bakış</h1></div>
      <div class="top-actions"><span class="stale-badge" id="staleBadge" hidden>Veri güncel değil</span><span class="status-pill"><span class="pulse"></span><span id="connectionText">Bağlanıyor</span></span><button class="button" id="refreshButton"><span id="refreshText">Yenile</span></button></div>
    </header>
    <div class="notice error" id="networkNotice" role="status" hidden></div>
    <main id="main-content" tabindex="-1">
      <section class="page active" id="page-overview" data-page="overview" aria-labelledby="overview-title">
        <div class="page-heading"><div><p class="eyebrow">Operasyon merkezi</p><h2 id="overview-title">Genel Bakış</h2><p>Canlı veri akışı, arşiv kapsamı ve servis sağlığının tek görünümü.</p></div><div class="as-of">Son tarama <strong id="lastScan">Veri mevcut değil</strong></div></div>
        <div class="metric-grid" id="overviewMetrics"><div class="metric-card skeleton"></div><div class="metric-card skeleton"></div><div class="metric-card skeleton"></div><div class="metric-card skeleton"></div></div>
        <div class="two-column">
          <article class="panel"><div class="panel-head"><div><p class="eyebrow">Kaynaklar</p><h3>Provider sağlığı</h3></div><button class="text-button" data-go="system">Tümünü gör</button></div><div class="provider-grid" id="overviewProviders"></div></article>
          <article class="panel"><div class="panel-head"><div><p class="eyebrow">Son sinyaller</p><h3>Market hareketleri</h3></div><button class="text-button" data-go="market">Market'e git</button></div><div class="signal-list" id="overviewSignals"></div></article>
        </div>
      </section>

      <section class="page" id="page-matches" data-page="matches" aria-labelledby="matches-title">
        <div class="page-heading"><div><p class="eyebrow">Günlük fixture akışı</p><h2 id="matches-title">Bugünün Maçları</h2><p id="matchesDate">Türkiye günü</p></div><a class="button secondary" href="/daily-matches.csv">CSV indir</a></div>
        <div class="toolbar"><div class="segmented" aria-label="Maç durumu filtresi"><button class="filter active" data-filter="all">Tümü <span id="allCount">0</span></button><button class="filter" data-filter="prematch">Prematch <span id="prematchCount">0</span></button><button class="filter" data-filter="live">Live <span id="liveCount">0</span></button></div><label class="field"><span class="sr-only">Lig filtresi</span><select id="leagueFilter"><option value="all">Tüm ligler</option></select></label><label class="search"><span aria-hidden="true">⌕</span><input id="matchSearch" type="search" placeholder="Takım veya lig ara" autocomplete="off"></label></div>
        <div class="match-list" id="matchList"></div>
      </section>

      <section class="page" id="page-analysis" data-page="analysis" aria-labelledby="analysis-title">
        <div class="page-heading"><div><p class="eyebrow">Read-only intelligence</p><h2 id="analysis-title">Maç Analizi</h2><p>Takım formu ve Data Confidence görünümü; sonuç olasılığı veya bahis tavsiyesi değildir.</p></div></div>
        <div class="analysis-list" id="analysisList"></div>
      </section>

      <section class="page" id="page-historical" data-page="historical" aria-labelledby="historical-title">
        <div class="page-heading"><div><p class="eyebrow">Odds archive research</p><h2 id="historical-title">Historical</h2><p>Kapanış çizgileri ve tamamlanmış maçlar üzerinden tarihsel örnek görünümü.</p></div></div>
        <div class="metric-grid compact" id="historicalMetrics"></div>
        <div class="two-column"><article class="panel"><div class="panel-head"><h3>Pattern analizi</h3><span class="quality-badge" id="historicalQuality">Bekleniyor</span></div><div id="historicalAnalysis"></div></article><article class="panel"><div class="panel-head"><h3>Arşiv bütünlüğü</h3></div><div class="diagnostic-list" id="historicalCompleteness"></div></article></div>
      </section>

      <section class="page" id="page-market" data-page="market" aria-labelledby="market-title">
        <div class="page-heading"><div><p class="eyebrow">Fiyat gözlemi</p><h2 id="market-title">Market</h2><p>Kaynaklar arası güncel fiyat, konsensüs ve arbitraj tespiti.</p></div><a class="button secondary" href="/odds-history.csv">Odds CSV</a></div>
        <article class="panel table-panel"><div class="panel-head"><h3>Güncel oranlar</h3><span id="quoteUpdated">Veri mevcut değil</span></div><div class="table-scroll"><table><thead><tr><th>Maç</th><th>Faz</th><th>Pazar / Seçim / Line</th><th>Bookmaker</th><th>Provider</th><th>Oran</th><th>Güncelleme</th></tr></thead><tbody id="quotesTable"></tbody></table></div></article>
        <div class="two-column"><article class="panel"><div class="panel-head"><h3>Konsensüs</h3></div><div class="diagnostic-list" id="consensusList"></div></article><article class="panel"><div class="panel-head"><h3>Arbitraj</h3></div><div class="diagnostic-list" id="arbitrageList"></div></article></div>
      </section>

      <section class="page" id="page-system" data-page="system" aria-labelledby="system-title">
        <div class="page-heading"><div><p class="eyebrow">Runtime diagnostics</p><h2 id="system-title">Sistem</h2><p>Provider, arşiv ve intelligence servislerinin operasyon durumu.</p></div></div>
        <div class="system-grid" id="systemDiagnostics"></div>
      </section>

      <section class="page" id="page-settings" data-page="settings" aria-labelledby="settings-title">
        <div class="page-heading"><div><p class="eyebrow">Güvenli görünüm</p><h2 id="settings-title">Ayarlar</h2><p>Yalnız çalışma durumundan türetilen hassas olmayan, salt okunur değerler.</p></div></div>
        <article class="panel"><div class="settings-grid" id="safeSettings"></div><p class="security-note">API anahtarları, tokenlar, bağlantı dizeleri ve diğer secret alanları bu panelde hiçbir zaman gösterilmez.</p></article>
      </section>
    </main>
  </div>
</div>
<div class="sidebar-scrim" id="sidebarScrim" hidden></div>
<aside class="drawer" id="matchDrawer" aria-labelledby="drawerTitle" aria-modal="true" role="dialog" hidden>
  <header class="drawer-head"><div><p class="eyebrow" id="drawerLeague">Maç detayı</p><h2 id="drawerTitle">Karşılaşma</h2><p id="drawerMeta"></p></div><button class="icon-button" id="drawerClose" aria-label="Maç detayını kapat">×</button></header>
  <nav class="drawer-tabs" aria-label="Maç detay sekmeleri"><button class="active" data-detail="summary">Özet</button><button data-detail="form">Form</button><button data-detail="venue">Venue</button><button data-detail="timing">Timing</button><button data-detail="stats">Stats</button><button data-detail="intelligence">Intelligence</button></nav>
  <div class="drawer-body" id="drawerBody"></div>
</aside>`;
