export const dashboardHtml = String.raw`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07111f">
  <title>Oran Eşleştirme Botu</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --panel: rgba(15, 29, 48, .82);
      --panel-2: rgba(19, 38, 62, .72);
      --line: rgba(148, 181, 214, .16);
      --text: #f4f8fc;
      --muted: #92a8bd;
      --cyan: #53d7ff;
      --green: #53e6a5;
      --amber: #ffcf70;
      --red: #ff7b87;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 12% 0%, rgba(42, 137, 198, .2), transparent 32rem),
        radial-gradient(circle at 90% 10%, rgba(48, 212, 160, .11), transparent 28rem),
        var(--bg);
    }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 38px 0 56px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 8px; color: var(--cyan); font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(28px, 5vw, 48px); letter-spacing: -.045em; line-height: 1.02; }
    .intro { max-width: 680px; margin: 13px 0 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
    .live { display: inline-flex; align-items: center; gap: 9px; flex: none; padding: 10px 14px; border: 1px solid var(--line); border-radius: 999px; background: rgba(6, 15, 27, .7); color: var(--muted); font-size: 13px; font-weight: 700; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 5px rgba(255, 207, 112, .09); }
    .live.ok .dot { background: var(--green); box-shadow: 0 0 0 5px rgba(83, 230, 165, .09); }
    .live.bad .dot { background: var(--red); box-shadow: 0 0 0 5px rgba(255, 123, 135, .09); }
    .alerts { display: grid; gap: 10px; margin-bottom: 18px; }
    .notice { display: none; padding: 14px 16px; border: 1px solid rgba(255, 207, 112, .25); border-radius: 14px; background: rgba(255, 207, 112, .08); color: #ffe4a7; font-size: 13px; line-height: 1.55; }
    .notice.show { display: block; }
    .notice.error { border-color: rgba(255, 123, 135, .28); background: rgba(255, 123, 135, .08); color: #ffc1c7; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .card, .section { border: 1px solid var(--line); background: var(--panel); box-shadow: 0 18px 48px rgba(0, 0, 0, .18); backdrop-filter: blur(16px); }
    .card { min-height: 152px; padding: 21px; border-radius: 18px; }
    .label { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: var(--cyan); background: rgba(83, 215, 255, .08); font-size: 14px; }
    .metric { margin-top: 28px; font-size: clamp(25px, 3vw, 35px); font-weight: 800; letter-spacing: -.04em; }
    .sub { margin-top: 5px; color: var(--muted); font-size: 12px; }
    .lower { display: grid; grid-template-columns: 1.35fr .65fr; gap: 14px; margin-top: 14px; }
    .section { border-radius: 18px; overflow: hidden; }
    .section-head { display: flex; justify-content: space-between; gap: 18px; padding: 20px 22px; border-bottom: 1px solid var(--line); }
    .section-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .download { color: var(--cyan); font-size: 12px; font-weight: 750; text-decoration: none; }
    .download:hover { text-decoration: underline; }
    h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .updated { color: var(--muted); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 16px 22px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    td:last-child { text-align: right; font-weight: 720; }
    .state-list { padding: 8px 22px; }
    .state-row { display: flex; justify-content: space-between; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .state-row:last-child { border-bottom: 0; }
    .state-row span:first-child { color: var(--muted); }
    .state-row span:last-child { text-align: right; font-weight: 680; }
    .state-row a { color: var(--cyan); text-decoration: none; }
    .state-row a:hover { text-decoration: underline; }
    footer { display: flex; justify-content: space-between; gap: 18px; margin-top: 18px; color: #71879d; font-size: 11px; }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } .lower { grid-template-columns: 1fr; } }
    @media (max-width: 560px) { .shell { width: min(100% - 22px, 1180px); padding-top: 24px; } header { display: block; } .live { margin-top: 18px; } .grid { grid-template-columns: 1fr; } .card { min-height: 132px; } .metric { margin-top: 20px; } th, td { padding: 14px; } footer { display: block; line-height: 1.8; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <p class="eyebrow">Canlı İzleme Paneli</p>
        <h1>Oran Eşleştirme Botu</h1>
        <p class="intro">Günün maçlarını planlar, maç saatine göre oran geçmişini toplar ve aynı pazardaki oranlar birbirine %2 yaklaştığında Telegram bildirimi gönderir.</p>
      </div>
      <div id="live" class="live"><span class="dot"></span><span id="liveText">Bağlanıyor</span></div>
    </header>

    <div class="alerts">
      <div id="demoNotice" class="notice">Demo veri modu açık. Gerçek oranlar için Render ortamında veri sağlayıcısı ve API anahtarı tanımlanmalı.</div>
      <div id="telegramNotice" class="notice">Telegram şu anda kapalı. Render ortamında yeni bot anahtarı tanımlanıp <b>DRY_RUN=false</b> yapılmalı.</div>
      <div id="errorNotice" class="notice error"></div>
    </div>

    <section class="grid" aria-label="Özet metrikler">
      <article class="card"><div class="label">Veri Kaynağı <span class="icon">◆</span></div><div id="provider" class="metric">—</div><div id="providerSub" class="sub">Yükleniyor</div></article>
      <article class="card"><div class="label">Taranan Oran <span class="icon">↻</span></div><div id="quotes" class="metric">—</div><div class="sub">Son taramadaki güncel oranlar</div></article>
      <article class="card"><div class="label">Yakın Eşleşme <span class="icon">≈</span></div><div id="matches" class="metric">—</div><div class="sub">%2 sınırının içindeki pazarlar</div></article>
      <article class="card"><div class="label">Bildirim <span class="icon">↗</span></div><div id="alertsSent" class="metric">—</div><div id="notifierSub" class="sub">Toplam gönderilen</div></article>
      <article class="card"><div class="label">Günün Maçı <span class="icon">▦</span></div><div id="fixtureCount" class="metric">—</div><div class="sub">Bugünkü planlanan karşılaşmalar</div></article>
      <article class="card"><div class="label">Analiz Sinyali <span class="icon">⌁</span></div><div id="signalCount" class="metric">—</div><div class="sub">Yakın oran ve oran hareketi</div></article>
    </section>
    <section class="section" style="margin-top:14px">
      <div class="section-head">
        <h2>Günün maçları ve kontrol planı</h2>
        <div class="section-actions"><span id="sheetDate" class="updated">—</span><a class="download" href="/daily-matches.csv">Maçları indir</a><a class="download" href="/odds-history.csv">Oran geçmişini indir</a></div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Maç</th><th>Lig</th><th>Başlangıç</th><th>Durum</th><th>Son kontrol</th><th>Sonraki kontrol</th></tr></thead>
          <tbody id="dailyFixtures"><tr><td colspan="6">Günün maç listesi hazırlanıyor.</td></tr></tbody>
        </table>
      </div>
    </section>
    <section class="section" style="margin-top:14px">
      <div class="section-head"><h2>Son analiz sinyalleri</h2><span class="updated">%2 yakın oran ve %8 hareket</span></div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Maç</th><th>Pazar / Seçim</th><th>Sinyal</th><th>Açıklama</th><th>Saat</th></tr></thead>
          <tbody id="recentSignals"><tr><td colspan="5">Henüz analiz sinyali oluşmadı.</td></tr></tbody>
        </table>
      </div>
    </section>
    <section class="section" style="margin-top:14px">
      <div class="section-head"><h2>Son okunan gerçek oranlar</h2><span class="updated">En fazla 40 kayıt</span></div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Maç</th><th>Durum</th><th>Pazar / Seçim</th><th>Bookmaker</th><th>Oran</th></tr></thead>
          <tbody id="recentQuotes"><tr><td colspan="5">İlk gerçek tarama bekleniyor.</td></tr></tbody>
        </table>
      </div>
    </section>
    <section class="section" style="margin-top:14px">
      <div class="section-head"><h2>Son yakın oranlar</h2><span class="updated">En fazla 20 eşleşme</span></div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Maç</th><th>Durum</th><th>Pazar / Seçim</th><th>Kaynaklar</th><th>Fark</th></tr></thead>
          <tbody id="recentMatches"><tr><td colspan="5">İlk gerçek tarama bekleniyor.</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="lower">
      <div class="section">
        <div class="section-head"><h2>Son tarama</h2><span id="updated" class="updated">—</span></div>
        <table>
          <thead><tr><th>Kontrol</th><th>Sonuç</th></tr></thead>
          <tbody>
            <tr><td>Çekilen toplam oran</td><td id="fetched">—</td></tr>
            <tr><td>Güncel kabul edilen oran</td><td id="fresh">—</td></tr>
            <tr><td>Bulunan yakın eşleşme</td><td id="found">—</td></tr>
            <tr><td>Gönderilen oran hareketi bildirimi</td><td id="movementAlerts">—</td></tr>
            <tr><td>Tekrar olduğu için bastırılan</td><td id="suppressed">—</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-head"><h2>Sistem durumu</h2></div>
        <div class="state-list">
          <div class="state-row"><span>Sağlık</span><span id="health">Kontrol ediliyor</span></div>
          <div class="state-row"><span>Bildirim kanalı</span><span id="notifier">—</span></div>
          <div class="state-row"><span>Google Sheets</span><span><a id="googleSheets" rel="noreferrer">—</a></span></div>
          <div class="state-row"><span>Toplam tarama</span><span id="runs">—</span></div>
          <div class="state-row"><span>Son başarı</span><span id="success">—</span></div>
        </div>
      </div>
    </section>
    <footer><span>Oranlar yalnızca aynı maç, pazar, seçim ve çizgide karşılaştırılır.</span><span>Otomatik yenileme: 15 saniye</span></footer>
  </main>
  <script>
    const el = (id) => document.getElementById(id);
    const number = (value) => Number(value || 0).toLocaleString('tr-TR');
    const date = (value) => value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Istanbul' }).format(new Date(value)) : 'Henüz yok';
    function render(data) {
      const run = data.lastRun || {};
      const mock = data.provider === 'mock';
      const scraper = data.provider === 'betexplorer_scraper';
      const telegram = data.notifier === 'telegram';
      const sheet = data.dailySheet || { fixtures: [], oddsSnapshotCount: 0, signalCount: 0, recentSignals: [], googleSheets: { enabled: false } };
      const googleSheets = sheet.googleSheets || { enabled: false, url: null, lastSuccessAt: null, lastError: null };
      el('live').className = 'live ' + (data.lastError ? 'bad' : 'ok');
      el('liveText').textContent = data.lastError ? 'Hata var' : 'Sistem çalışıyor';
      el('provider').textContent = mock ? 'Demo' : (scraper ? 'Web Tarama' : 'Gerçek API');
      el('providerSub').textContent = mock ? 'Mock veriler kullanılıyor' : data.provider;
      el('quotes').textContent = number(run.quotesFresh);
      el('matches').textContent = number(run.matchesFound);
      el('alertsSent').textContent = number(data.totals && data.totals.alertsSent);
      el('fixtureCount').textContent = number(sheet.fixtures && sheet.fixtures.length);
      el('signalCount').textContent = number(sheet.signalCount);
      el('sheetDate').textContent = sheet.date ? 'Türkiye günü: ' + sheet.date : '—';
      el('notifierSub').textContent = telegram ? 'Telegram aktif' : 'Telegram kapalı';
      el('fetched').textContent = number(run.quotesFetched);
      el('fresh').textContent = number(run.quotesFresh);
      el('found').textContent = number(run.matchesFound);
      el('movementAlerts').textContent = number(run.movementAlertsSent);
      el('suppressed').textContent = number(run.alertsSuppressed);
      el('updated').textContent = run.finishedAt ? date(run.finishedAt) : 'İlk tarama bekleniyor';
      el('health').textContent = data.lastError ? 'Hata' : 'Sağlıklı';
      el('notifier').textContent = telegram ? 'Telegram' : 'Terminal / Demo';
      const googleLink = el('googleSheets');
      googleLink.textContent = !googleSheets.enabled ? 'Kapalı' : (googleSheets.lastError ? 'Hata var' : (googleSheets.lastSuccessAt ? 'Senkronize' : 'Bağlantı bekleniyor'));
      if (googleSheets.url) {
        googleLink.href = googleSheets.url;
        googleLink.target = '_blank';
      } else {
        googleLink.removeAttribute('href');
        googleLink.removeAttribute('target');
      }
      googleLink.title = googleSheets.lastError || (googleSheets.lastSuccessAt ? 'Son başarı: ' + date(googleSheets.lastSuccessAt) : '');
      el('runs').textContent = number(data.totals && data.totals.runs);
      el('success').textContent = date(data.lastSuccessAt);
      el('demoNotice').classList.toggle('show', mock);
      el('telegramNotice').classList.toggle('show', !telegram);
      el('errorNotice').classList.toggle('show', Boolean(data.lastError));
      el('errorNotice').textContent = data.lastError ? 'Son hata: ' + data.lastError : '';
      const fixturesBody = el('dailyFixtures');
      fixturesBody.replaceChildren();
      const fixtures = Array.isArray(sheet.fixtures) ? sheet.fixtures : [];
      if (fixtures.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.textContent = 'Bugün için listelenmiş maç bulunmadı veya liste taraması sürüyor.';
        row.appendChild(cell);
        fixturesBody.appendChild(row);
      } else {
        for (const fixture of fixtures.slice(0, 100)) {
          const row = document.createElement('tr');
          const values = [
            fixture.homeTeam + ' - ' + fixture.awayTeam,
            fixture.leagueName,
            date(fixture.commenceTime),
            fixture.phase === 'live' ? 'CANLI / BAŞLADI' : 'MAÇ ÖNÜ',
            date(fixture.lastOddsCheckAt),
            date(fixture.nextOddsCheckAt),
          ];
          for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          fixturesBody.appendChild(row);
        }
      }
      const signalsBody = el('recentSignals');
      signalsBody.replaceChildren();
      const signals = Array.isArray(sheet.recentSignals) ? sheet.recentSignals : [];
      if (signals.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'Henüz yakın oran veya belirgin oran hareketi bulunmadı.';
        row.appendChild(cell);
        signalsBody.appendChild(row);
      } else {
        for (const signal of signals) {
          const row = document.createElement('tr');
          const signalName = signal.type === 'close_odds' ? 'YAKIN ORAN' : (signal.type === 'odds_drop' ? 'ORAN DÜŞTÜ' : 'ORAN YÜKSELDİ');
          const values = [
            signal.event,
            signal.market + ' / ' + signal.selection + (signal.line === null ? '' : ' (' + signal.line + ')'),
            signalName,
            signal.detail,
            date(signal.detectedAt),
          ];
          for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          signalsBody.appendChild(row);
        }
      }
      const quotesBody = el('recentQuotes');
      quotesBody.replaceChildren();
      const recentQuotes = Array.isArray(data.recentQuotes) ? data.recentQuotes : [];
      if (recentQuotes.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'Bu taramada gösterilecek güncel oran bulunmadı.';
        row.appendChild(cell);
        quotesBody.appendChild(row);
      } else {
        for (const quote of recentQuotes) {
          const row = document.createElement('tr');
          const values = [
            quote.event,
            quote.phase === 'live' ? 'CANLI' : 'MAÇ ÖNÜ',
            quote.market + ' / ' + quote.selection + (quote.line === null ? '' : ' (' + quote.line + ')'),
            quote.bookmaker,
            Number(quote.price).toFixed(2),
          ];
          for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          quotesBody.appendChild(row);
        }
      }
      const recentBody = el('recentMatches');
      recentBody.replaceChildren();
      const matches = Array.isArray(data.recentMatches) ? data.recentMatches : [];
      if (matches.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'Bu taramada %2 içinde eşleşme bulunmadı.';
        row.appendChild(cell);
        recentBody.appendChild(row);
      } else {
        for (const match of matches) {
          const row = document.createElement('tr');
          const values = [
            match.event,
            match.phase === 'live' ? 'CANLI' : 'MAÇ ÖNÜ',
            match.market + ' / ' + match.selection + (match.line === null ? '' : ' (' + match.line + ')'),
            match.bookmakerA + ' ' + Number(match.priceA).toFixed(2) + ' ↔ ' + match.bookmakerB + ' ' + Number(match.priceB).toFixed(2),
            '%' + Number(match.differencePercent).toFixed(2),
          ];
          for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          recentBody.appendChild(row);
        }
      }
    }
    async function refresh() {
      try {
        const response = await fetch('/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Durum bilgisi alınamadı');
        render(await response.json());
      } catch (error) {
        el('live').className = 'live bad';
        el('liveText').textContent = 'Bağlantı hatası';
        el('errorNotice').classList.add('show');
        el('errorNotice').textContent = error instanceof Error ? error.message : String(error);
      }
    }
    refresh();
    setInterval(refresh, 15000);
  </script>
</body>
</html>`;
