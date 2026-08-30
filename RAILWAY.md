# Railway kurulumu

Bu proje Railway'de root `Dockerfile` ile calisir. Railway build logunda `Using detected Dockerfile!` mesaji gorunmelidir.

## 1. Servis ayarlari

- Source: bu GitHub reposu, `main` branch
- Healthcheck Path: `/health`
- Serverless: **kapali** (7/24 worker icin)
- Public Networking: `Generate Domain`
- Start Command: bos birak; Dockerfile `npm start` calistirir
- `PORT` degiskenini elle eklemeyin; Railway otomatik verir
- `CHROMIUM_EXECUTABLE_PATH` degiskenini bos eklemeyin. Docker imaji `/usr/bin/chromium-browser` kullanir ve uygulama Linux'ta bu yola otomatik fallback yapar.

## 2. Gerekli Variables

Gercek Telegram bildirimi icin:

```text
ODDS_PROVIDER=betexplorer_scraper
DRY_RUN=false
TELEGRAM_BOT_TOKEN=<secret>
TELEGRAM_CHAT_ID=<secret>
```

API-Football ek kaynak olarak kullanilacaksa:

```text
API_FOOTBALL_KEY=<secret>
```

football-data fikstur/durum dogrulamasi icin:

```text
FOOTBALL_DATA_TOKEN=<secret>
```

Google Sheets kullaniliyorsa ucu birlikte girilmelidir:

```text
GOOGLE_SHEETS_SPREADSHEET_ID=<id>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_PRIVATE_KEY=<private-key>
```

Bu uclunun biri eksikse uygulama guvenli sekilde startup'i reddeder; Railway logunda eksik Google Sheets ayari gorulur.

## 3. Kontrol

Deploy `Active` olduktan sonra Railway domaininde:

```text
/health
/status
```

`/health` HTTP 200 ve `{"ok":true,...}` dondurmelidir.

`/status` icinde:

- `provider`: etkin kaynak zinciri
- `lastSuccessAt`: son basarili tarama
- `lastError`: son hata
- `lastRun.quotesFetched`: cekilen oran sayisi
- `recentQuotes`: son oranlar

## 4. Railway'de 7/24 icin kritik not

Serverless aciksa servis hareketsiz kabul edildiginde uyuyabilir. Bu bot arka planda surekli tarama yaptigi icin Serverless kullanmayin. Tek replica yeterlidir; birden fazla replica ayni API kotasini ve Telegram alarmlarini iki kez tuketebilir.

## 5. Siklik / maliyet

Varsayilan worker dongusu 60 saniyedir ancak BetExplorer detay sayfalari zamanlama kurallarina gore daha seyrek acilir. Canli mac detay kontrolu varsayilan 3 dakikadir. API-Football kendi gunluk butcesini ve cache'ini uygular.
