# Oran Eslestirme Botu

Futbol oranlarini ortak bir modele donusturen, ayni macin ayni pazar/secim/cizgisindeki iki oran arasindaki goreli fark `%2` veya daha dusuk oldugunda Telegram bildirimi gonderen demo servisidir.

> Bu proje bahis oynatmaz ve otomatik kupon yapmaz. Yalnizca izinli veri kaynaklarindan oran okuyup bildirim uretir.

## Hazir olan ozellikler

- Mac onu ve canli karsilasma ayrimi
- `%2` goreli fark kurali
- Ayni mac, pazar, periyot, secim ve handikap/Alt-Ust cizgisi kontrolu
- Bayat oranlari dislama
- Ayni bildirimi belirli sure tekrar gondermeme
- Uc veya daha fazla kaynak uyustugunda yalnizca en yakin cifti bildirme
- Telegram bildirimi veya guvenli `DRY_RUN` modu
- Telegram mesajinda pazar, periyot, cizgi, secim ve bahsin acik Turkce anlami
- Ortalama oran `2.50` ve uzerindeyse ayarlanabilir `SURPRIZ ADAYI` etiketi
- Gun basinda fiksturu ayiran ve panelde `Gunun Maclari` tablosuna kaydeden planlayici
- Maca 6 saatten fazla varken bekleyen; 6 saat, 1 saat, son 15 dakika ve canli icin farkli tarama araliklari
- Acilis oranina gore varsayilan `%8` dusus/yukselis sinyali ve gunluk oran gecmisi
- `%8` esigi ilk kez gecildiginde acilis/guncel oran aciklamali Telegram hareket bildirimi
- Gunluk mac listesini ve oran gecmisini Google Sheets/Excel uyumlu CSV olarak indirme
- Opsiyonel Google Sheets canli aynasi: `Maclar`, `Oran_Gecmisi`, `Sinyaller`
- Sportmonks API 3.0 ile fikstur, mac durumu, canli skor ve paket destekliyorsa mac onu/canli oranlar
- Ucretsiz The Odds API adaptoru (`h2h`, `spreads`, `totals`)
- Mackolik'in herkese acik İddaa bulteninden 1X2, Cifte Sans ve 2.5 Alt/Ust oranlarini dogrudan toplama
- Mackolik / İddaa oranlarini ilk goruldugunde ve anlamli degisimde Telegram'a snapshot olarak gonderme
- Herkese acik BetExplorer sayfalarindan dusuk frekansli web scraping
- Canli maclarda `1X2`, `Alt/Ust`, Asya handikap, Cifte Sans, KG Var/Yok ve Beraberlikte Iade
- Mac onunde `1X2` bookmaker karsilastirmasi
- Tum futbol pazarlari icin genisletilebilir kanonik pazar modeli
- Mock verilerle anahtarsiz calisan demo
- `/health`, `/status` ve korumali `/run-once` uclari
- Ana adreste otomatik yenilenen canli durum paneli
- Docker, Render ve GitHub Actions yapilandirmasi

## Turkiye İddaa oran akisi

Production modunda servis Mackolik'in giris gerektirmeyen İddaa bultenini ek oran kaynagi olarak okur. Bu kaynakta gorunen sabit İddaa oranlari ortak modele donusturulur:

- Mac Sonucu: 1 / X / 2
- Cifte Sans: 1-X / 1-2 / X-2
- Toplam Gol 2.5: Alt / Ust

`TURKISH_ODDS_TELEGRAM_ENABLED=true` iken ilk gorulen oran seti ve sonradan en az yaklasik %1 fiyat degisimi Telegram'a gonderilir. Ayni mac icin cooldown/dedup mekanizmasi korunur. `TURKISH_ODDS_MAX_MATCHES` bir turda Telegram ve panel icin izlenecek en yakin mac sayisini sinirlar.

Mackolik kaynagi HTTP ile okunamazsa mevcut Chromium kurulumu ile tarayici fallback'i dener. Site CAPTCHA, oturum veya bolge engeli isterse sistem bunu asmaya calismaz; diger kaynaklar calismaya devam eder.

## Veri kaynagi sinirlari

`ODDS_PROVIDER=mock` durumunda uretilen veriler **tamamen ornektir**. Gercek site verisi degildir.

`ODDS_PROVIDER=betexplorer_scraper`, BetExplorer'in giris gerektirmeyen oran karsilastirma sayfalarinda gorunen bookmaker satirlarini okur. Bet365, Betfair ve Betfair Exchange dahil, sayfanin o anda gosterdigi ve `BOOKMAKER_KEYS` ile izin verilen kaynaklar kullanilir. Site yapisi degisirse kaynak hata verebilir; sistem CAPTCHA, oturum, bolge engeli veya bot korumasi asmaz.

Eski Render servislerinde kalmis `ODDS_PROVIDER=mock` degeri, `NODE_ENV=production` ortaminda otomatik olarak scraper'a yukseltirilir. Uretimde ozellikle demo istenirse `ALLOW_MOCK_IN_PRODUCTION=true` ayarlanabilir.

Nesine, Misli ve Bilyoner bu sunucudan acilan herkese acik sayfada kullanilabilir oran tablosu dondurmedigi icin gercek kaynak olarak etiketlenmez. Onlar icin resmi/lisansli veri erisimi gerekir.

Sportmonks baglantisi resmi API uzerinden calisir. Temel futbol paketi fikstur ve skor saglar; oranlar Sportmonks hesabinda ayrica Odds add-on erisimi gerektirir. Add-on yoksa servis otomatik olarak `fixtures_only` moduna gecer ve diger oran kaynaklariyla calismayi surdurur. Kaynagin modu, kota kalani, fikstur ve oran sayisi `/status` cevabindaki `providerDiagnostics.sportmonks` alaninda gorulur.

Gol toplaminda `1.5`, `2.5`, `3.5`, `4.5` ve `5.5`; kart toplaminda `1.5`-`5.5`; korner toplaminda `6.5`-`11.5` gibi cizgiler kanonik modelde ve Telegram aciklamasinda desteklenir. Mevcut BetExplorer sayfasi gol Alt/Ust pazarini dondurur; kart ve korner satirlari gorunmedigi icin bu iki pazar ancak bunlari saglayan resmi/lisansli bir veri adaptoru baglandiginda gercek bildirim uretir.

## Karsilastirma kurali

```text
goreli fark = |oran A - oran B| / ((oran A + oran B) / 2) * 100
```

- `2.10` ve `2.14` -> `%1.89`: bildirim
- `1.90` ve `1.95` -> `%2.60`: bildirim yok

Oranlar ancak su alanlar ayniysa karsilastirilir:

1. Ev sahibi ve deplasman takimi
2. Baslama zamani (5 dakikalik tolerans kovasi)
3. Mac onu veya canli durumu
4. Pazar ve periyot
5. Secim
6. Handikap ya da Alt/Ust cizgisi

## Hizli baslangic

Gereksinim: Node.js 20 veya daha yeni bir surum.

```bash
npm install
cp .env.example .env
npm run dev
```

Varsayilan ayarlar mock veri ve `DRY_RUN=true` kullanir. Ilk taramada terminalde uc ornek bildirim gorursunuz. Ayni bildirimler varsayilan olarak 10 dakika tekrar gonderilmez.

Servis acildiktan sonra:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/status
```

## Web scraping modu

Docker veya sistemde kurulu Chromium gerektirir. Render yapilandirmasi Chromium'u otomatik kurar.

```dotenv
ODDS_PROVIDER=betexplorer_scraper
BOOKMAKER_KEYS=bet365,betfair,betfair_ex_eu,pinnacle
SCRAPER_MAX_MATCHES=2
SCRAPER_PAGE_TIMEOUT_MS=60000
SCRAPER_WAIT_MS=2500
SCRAPER_ALLOW_VISIBLE_BOOKMAKER_FALLBACK=true
POLL_INTERVAL_SECONDS=180
DRY_RUN=true
```

Her taramada canli maclara oncelik verilir ve en fazla `SCRAPER_MAX_MATCHES` sayfa okunur. Dusuk frekans varsayilani hedef siteyi gereksiz yukten korur. Canli sayfada standart pazarlar, mac onunde ilk surumde `1X2` taranir. BetExplorer bookmaker listesini sunucu bolgesine gore degistirebilir. Secilen kaynaklar gorunmezse `SCRAPER_ALLOW_VISIBLE_BOOKMAKER_FALLBACK=true` ile sayfada adi acikca gorunen bookmaker'lar kullanilir; panel gercek kaynak adlarini gosterir.

`ODDS_PROVIDER=betexplorer_scraper` iken `ODDS_API_KEY` de eklenirse servis iki kaynagi birlikte kullanir: BetExplorer taramasi devam eder, The Odds API ise ikinci kaynak olur. Kaynaklardan biri gecici hata verirse digeri taramayi surdurur. API anahtarini yalnizca Render'in gizli ortam degiskenine koyun; GitHub'a veya mesajlasma ekranina koymayin.

Liste sayfasi her dongude hafif olarak okunur ve o gunun maclari saklanir. Oran detay sayfalari ise yalnizca zamanlama kurali geldiginde acilir: varsayilan olarak maca 6 saatten fazla varsa beklenir, 6-1 saat arasi saatte bir, 60-15 dakika arasi 15 dakikada bir, son 15 dakikada 5 dakikada bir ve canlida 3 dakikada bir kontrol edilir. Bir turdaki sayfa siniri dolarsa zamani gelen diger maclar sonraki dongulerde sirayla taranir.

Paneldeki `Maclari indir` ve `Oran gecmisini indir` baglantilari CSV uretir. Bu dosyalar dogrudan Google Sheets veya Excel'e aktarilabilir. Google Sheets'e API ile otomatik yazma icin ayrica bir Google servis hesabi ve hedef Sheet kimligi gerekir; ana tarama bu baglanti olmadan da calisir.

## Google Sheets otomatik senkronizasyon

1. Google Cloud projesinde **Google Sheets API** hizmetini acin.
2. Bir servis hesabi olusturup JSON anahtarini indirin.
3. Bos bir Google Sheet olusturun ve servis hesabinin e-posta adresine **Duzenleyici** yetkisi verin.
4. Render Environment bolumune su gizli degerleri ekleyin:

```dotenv
GOOGLE_SHEETS_SPREADSHEET_ID=sheet_linkindeki_d_ile_edit_arasindaki_kimlik
GOOGLE_SERVICE_ACCOUNT_EMAIL=servis-hesabi@proje.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SYNC_MINUTES=15
```

Uygulama `Maclar`, `Oran_Gecmisi` ve `Sinyaller` sekmelerini otomatik acar; baslik satirlarini sabitler, filtreleri ve okunabilir sutun genisliklerini uygular. Servis hesabi ozel anahtarini GitHub'a veya mesajlasma ekranina koymayin; yalnizca Render gizli ortam degiskeninde saklayin.

## Ucretsiz API demosu

1. [The Odds API](https://the-odds-api.com/) uzerinden bir API anahtari alin.
2. `.env` dosyasini guncelleyin:

```dotenv
ODDS_PROVIDER=the_odds_api
ODDS_API_KEY=buraya_api_anahtari
SPORT_KEYS=soccer_epl,soccer_uefa_champs_league
BOOKMAKER_KEYS=pinnacle,betfair_ex_eu,betfair,bet365
REGIONS=eu,uk
DRY_RUN=true
```

Ucretsiz kotayi tuketmemek icin once iki lig, uc temel pazar ve 60 saniyelik tarama araligiyla baslayin. Saglayici listede bulunmayan bir bookmaker icin veri dondurmez; bu normaldir.

## Sportmonks kurulumu

1. Sportmonks hesabinda bir API token olusturun.
2. Railway backend servisinin `Variables` bolumune tokeni ekleyin; GitHub'a yazmayin:

```dotenv
SPORTMONKS_API_TOKEN=hesaptaki_gizli_token
SPORTMONKS_REFRESH_MINUTES=3
SPORTMONKS_MAX_PAGES=4
SPORTMONKS_INCLUDE_ODDS=true
```

Servis gunun maclarini Istanbul saat diliminde, sayfa basina 50 kayitla alir. `SPORTMONKS_MAX_PAGES=4` bir turda en fazla 200 mac demektir. Mevcut lig kapsam filtresi Sportmonks verisine de uygulanir. Odds add-on etkinse bookmaker, pazar ve secimler ortak modele donusturulerek BetExplorer, API-Football ve The Odds API verileriyle ayni motorda karsilastirilir.

## Telegram kurulumu

1. Telegram'da `@BotFather` ile `/newbot` komutunu kullanin.
2. Olusan bota `/start` mesaji gonderin.
3. Bot tokenini yalnizca yerel `.env` veya Render gizli degiskenine ekleyin:

```dotenv
TELEGRAM_BOT_TOKEN=botfather_tokeni
```

4. Sohbet kimligini bulun:

```bash
npm run telegram:chat-id
```

5. Bulunan kimligi ekleyip gercek bildirimi acin:

```dotenv
TELEGRAM_CHAT_ID=123456789
DRY_RUN=false
```

Tokeni GitHub'a veya mesajlasma ekranina acik olarak koymayin. Yanlislikla paylasilirsa BotFather uzerinden yenileyin.

## Ayarlar

| Degisken | Varsayilan | Aciklama |
| --- | ---: | --- |
| `ODDS_PROVIDER` | `mock` | `mock`, `the_odds_api` veya `betexplorer_scraper` |
| `ALLOW_MOCK_IN_PRODUCTION` | `false` | Eski Render ayarinda gercek taramaya otomatik gecisi kapatir |
| `SPORT_KEYS` | iki futbol ligi | Virgul ayrimli lig anahtarlari |
| `BOOKMAKER_KEYS` | secilen kaynaklar | Virgul ayrimli bookmaker anahtarlari |
| `SPORTMONKS_API_TOKEN` | bos | Sportmonks gizli API tokeni; ayarlanirsa resmi kaynak etkinlesir |
| `SPORTMONKS_REFRESH_MINUTES` | `3` | Sportmonks fikstur/skor/oran yenileme araligi |
| `SPORTMONKS_MAX_PAGES` | `4` | Bir turda okunacak azami 50 kayitlik sayfa sayisi |
| `SPORTMONKS_INCLUDE_ODDS` | `true` | Paket izin veriyorsa prematch ve canli oranlari da ister |
| `ODDS_TOLERANCE_PERCENT` | `2` | Bildirim icin azami goreli fark |
| `POLL_INTERVAL_SECONDS` | `60` | Tarama araligi; en az 10 saniye |
| `TURKISH_ODDS_MAX_MATCHES` | `12` | Mackolik/İddaa akiminda bir turda izlenecek en yakin mac sayisi |
| `TURKISH_ODDS_TELEGRAM_ENABLED` | `true` | Mackolik/İddaa oran snapshotlarini Telegram'a yollar |
| `SCRAPER_MAX_MATCHES` | `2` | Bir turda acilacak azami mac sayfasi |
| `SCRAPER_PAGE_TIMEOUT_MS` | `60000` | Bir scraper sayfasi icin zaman asimi |
| `SCRAPER_WAIT_MS` | `2500` | Dinamik oran tablosunu bekleme suresi |
| `SCRAPER_ALLOW_VISIBLE_BOOKMAKER_FALLBACK` | `true` | Secilenler bolgesel olarak yoksa gorunen kaynaklari kullanir |
| `SCRAPER_LEAGUE_SCOPE` | `turkey_europe_top10_big5_tier3` | Turkiye, Avrupa'nin 10 oncelikli ust ligi ve Ingiltere/Ispanya/Italya/Almanya/Fransa'nin 2. ile 3. ligleri; `all` yazilirsa filtre kapanir |
| `CHROMIUM_EXECUTABLE_PATH` | bos | Chromium calistirilabilir dosya yolu |
| `PREMATCH_TRACK_HOURS` | `6` | Mac oncesi detayli oran takibinin baslayacagi saat |
| `PREMATCH_FAR_POLL_MINUTES` | `60` | 6-1 saat arasi kontrol araligi |
| `PREMATCH_NEAR_POLL_MINUTES` | `15` | 60-15 dakika arasi kontrol araligi |
| `PREMATCH_FINAL_POLL_MINUTES` | `5` | Son 15 dakika kontrol araligi |
| `LIVE_POLL_MINUTES` | `3` | Canli mac kontrol araligi |
| `MAX_QUOTE_AGE_SECONDS` | `300` | Bayat veri esigi |
| `MAX_LIVE_EVENT_AGE_MINUTES` | `180` | Baslangictan sonra canli sayilacak azami sure |
| `ALERT_COOLDOWN_SECONDS` | `600` | Ayni eslesme icin tekrar bekleme suresi |
| `EVENT_KICKOFF_TOLERANCE_MINUTES` | `10` | Providerlar arasi mac baslangic saati toleransi |
| `SURPRISE_ODDS_THRESHOLD` | `2.5` | Iki yakin oranin ortalamasi bu degere ulasirsa surpriz adayi etiketi |
| `ODDS_MOVEMENT_THRESHOLD_PERCENT` | `8` | Acilis oranina gore analiz sinyali uretecek degisim |
| `DRY_RUN` | `true` | Telegram yerine terminale yazar |
| `ADMIN_TOKEN` | bos | `/run-once` ucunu acar ve korur |
| `STATE_FILE` | `./data/alert-state.json` | Bildirim tekillestirme durumu |
| `DAILY_SHEET_FILE` | `./data/daily-match-sheet.json` | Gunluk fikstur, oran gecmisi ve sinyal tablosu |
| `HISTORICAL_ODDS_FILE` | `./data/historical-odds.json` | Tamamlanmis maclar ve historical odds snapshot arsivi |
| `DATABASE_URL` | bos | Varsa historical arsiv icin tercih edilen PostgreSQL baglantisi (status'ta gosterilmez) |
| `HISTORICAL_STORAGE` | `auto` | `auto` DATABASE_URL varsa postgres, yoksa JSON; `postgres`/`json` ile zorlanabilir |
| `HISTORICAL_LEAGUE_SCOPE` | `all` | Yalnizca historical backfill/archive research kapsami; `all` veya mevcut varsayilan lig kapsami |
| `HISTORICAL_ARCHIVE_ENABLED` | `true` | Her basarili taramada gercek odds degisimlerini arsivler |
| `HISTORICAL_BACKFILL_ENABLED` | `false` | Backfill icin operasyonel bayrak; backfill CLI ile kontrollu calistirilir |
| `HISTORICAL_BACKFILL_DAYS` | `7` | SportMonks recent fixture/result backfill penceresi (maksimum 30) |
| `HISTORICAL_MIN_SAMPLE_SIZE` | `10` | Pattern sonucunun yeterli sayilacagi minimum mac sayisi |
| `HISTORICAL_PRICE_TOLERANCE_PERCENT` | `10` | Closing fiyat benzerligi icin yuzde bandi |
| `HISTORICAL_LINE_TOLERANCE` | `0.5` | Asian Handicap ve Total Goals line toleransi |
| `HISTORICAL_RECENCY_HALF_LIFE_DAYS` | `730` | Recency agirliginin yariya indigi gun sayisi |
| `MATCH_INTELLIGENCE_ENABLED` | `true` | SportMonks read-only Match Intelligence alt sistemini acar |
| `MATCH_INTELLIGENCE_RECENT_MATCHES` | `10` | Takim basina alinacak son mac ust siniri |
| `MATCH_INTELLIGENCE_CACHE_MINUTES` | `45` | Ayni canonical mac icin prematch intelligence cache suresi |
| `MATCH_INTELLIGENCE_MIN_SAMPLE` | `5` | Tam data availability ve league baseline icin minimum orneklem |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | bos | Otomatik yazilacak Google Sheet kimligi veya tam baglantisi |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | bos | Sheet'e Duzenleyici verilen servis hesabi e-postasi |
| `GOOGLE_PRIVATE_KEY` | bos | Servis hesabi RSA ozel anahtari; yalnizca gizli ortam degiskeni |
| `GOOGLE_SHEETS_SYNC_MINUTES` | `15` | Uc sekmenin Google Sheets'e yenilenme araligi |

## Render'a dagitim

Depoda `render.yaml` ve `Dockerfile` hazirdir.

1. Projeyi yeni, ozel bir GitHub reposuna gonderin.
2. Render'da **New > Blueprint** ile repoyu secin.
3. Blueprint varsayilan olarak `ODDS_PROVIDER=betexplorer_scraper` ve `DRY_RUN=true` ile gercek oranlari panelde test eder.
4. Yeni `TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID` degerlerini Render Environment bolumune ekleyin.
5. Bildirim testi tamamlaninca `DRY_RUN=false` yapin.

Render ucretsiz web servisleri uykuya alinabilir. Kesintisiz, dakikalik tarama icin uyumayan bir servis plani veya surekli calisan baska bir sunucu gerekir. Yerel JSON durum dosyasi yeniden dagitimda kaybolabilir; uretim asamasinda PostgreSQL/Redis tabanli durum deposuna gecilmelidir.

## Historical odds arsivi

V1-C historical altyapisi tamamlanmis mac kaydini ve oran snapshot'larini ayri
veri setlerinde tutar. Her gercek mac `canonicalEventId` ile tekillestirilir;
SportMonks, API-Football, BetExplorer ve diger kaynak ID'leri ayni mac kaydinda
saklanir. Asian Handicap ve Total Goals `line` degerleri snapshot seviyesinde
korunur. Kickoff'tan once alinmis son taze provider fiyati, bookmaker ve
market/secim/line bazinda deterministik `closing` snapshot'i olur. Kickoff
sonrasi veya stale veri closing hesabina girmez.

`/historical-pattern` endpoint'i ve dashboard alani yalnizca read-only
istatistik verir. Raw yuzdeler ile recency-weighted yuzdeler API cevabinda ayri
alanlardir; sistem PLAY/WATCH/PASS veya bahis onerisi uretmez. Minimum sample
altinda sonuc `insufficient_data` ve panelde `Yetersiz tarihsel veri` olarak
gosterilir.

`HISTORICAL_STORAGE=auto` ile `DATABASE_URL` varsa idempotent migration calisir ve
PostgreSQL secilir; baglanti yoksa mevcut JSON fallback davranisi devam eder.
Railway production'da sessiz JSON fallback'i engellemek icin asagidaki explicit
ayarlar onerilir. `HISTORICAL_STORAGE=postgres` seciliyken `DATABASE_URL` yoksa
startup ve backfill acik hata ile durur; connection string loglanmaz.

```env
HISTORICAL_STORAGE=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
HISTORICAL_LEAGUE_SCOPE=all
```

Bu, birden fazla worker'a dayanikli yoldur. JSON'u production'da
kullanmak icin Railway Volume'u `/data` altina mount edip
`HISTORICAL_ODDS_FILE=/data/historical-odds.json` ayarlayin; volume olmadan restart
ve redeploy history'yi kaybedebilir. Google Sheets mevcut gorunum/arsiv akisini
korur; pattern engine dogrudan Sheets'e veya filesystem'e bagli degildir.

`HISTORICAL_LEAGUE_SCOPE` yalnizca historical backfill/archive research veri setini
etkiler. `SCRAPER_LEAGUE_SCOPE` ve normal live SportMonks provider mevcut live lig
kapsamini kullanmaya devam eder; bu ayar Telegram/live alarm kapsamlarini genisletmez.

Mevcut gunluk JSON verisini once yazmadan incelemek icin
`npm run historical:import-existing -- --dry-run`, uygulamak icin `--apply`
kullanin. SportMonks son yedi gun fixture/result backfill'i
`npm run historical:backfill -- --days=7` ile calisir. Bu production komutlari
`npm run build` ile uretilmis `dist/scripts` ciktilarini Node.js ile calistirir;
kaynak TypeScript'i dogrudan calistirmak icin ayni komutlarin `:dev` son ekli
surumleri kullanilabilir. Islenmis gunleri yeniden sorgulamak icin
`npm run historical:backfill -- --days=7 --recheck` kullanin. Backfill raporu ham
fikstur, league scope reddi, kabul/final sonuc ve gercekten eklenen snapshot
sayilarini ayri verir. Abonelikte dogrulanmis bir
odds-history endpoint'i yoksa sonuc acikca `odds_history_unavailable` olur ve
closing odds uydurulmaz. Migration elle `npm run db:migrate` ile de tekrar guvenle
calistirilabilir.

## Match Intelligence

V1-D Match Intelligence, prematch maclar icin SportMonks takim ve mac verilerinden
read-only bir veri ozeti uretir. Son 5/10 form, home/away split, gercek gol event
dakikalarindan timing, erisilebilen fixture statistics ve ayni lig/season verisinden
strength normalization hesaplanir. xG, lineup, injury veya statistics endpoint'i
pakette yoksa ilgili capability `unavailable` olur; gol sayisindan sahte xG ya da
eksik feature icin sifir uretilmez.

Her snapshot target kickoff'u kesin cutoff kabul eder; target mac, kickoff sonrasi
fikstur ve gelecekte gozlenmis event/stat verisi girdiye alinmaz. Sonuc canonical
event bazinda 45 dakika cache'lenir. PostgreSQL kullaniliyorsa idempotent
`match_intelligence_snapshots` tablosuna kaydedilir ve historical odds tablolarina
karistirilmaz. `/match-intelligence` ve `/status` read-only sonucu/capability/rate
limit diagnostigini sunar. Data confidence yalniz veri kalitesi ve kapsamini ifade
eder; outcome probability, PLAY/WATCH/PASS veya bahis tavsiyesi degildir. Alt sistem
hata verirse odds monitor, Telegram ve historical archive calismaya devam eder.

## Yeni GitHub reposu

Bos repoyu olusturduktan sonra proje klasorunde:

```bash
git init
git add .
git commit -m "feat: add odds matching Telegram demo"
git branch -M main
git remote add origin GITHUB_REPO_URL
git push -u origin main
```

## Test ve dogrulama

```bash
npm run check
docker build -t oran-eslestirme-botu .
docker run --rm -p 3000:3000 --env-file .env oran-eslestirme-botu
```

Testler; `%2` hesabi, bayat veri, farkli cizgi, canli/mac onu ayrimi, ayni bookmaker'i dislama, API donusumu, scraper HTML donusumu ve bildirim cooldown davranisini kapsar.

## Sonraki surum

- Lisansli veri saglayicida alt kaynaktan gelen tum futbol pazarlarini acma
- Betfair Exchange komisyonunu efektif orana donusturme
- PostgreSQL tabanli kalici bildirim durumu
- Kaynak/pazar bazli Telegram filtreleri
- Basit yonetim paneli ve veri kaynagi saglik ekranlari

Kanikonik pazar sozlesmesi ve yeni kaynak ekleme kurallari [docs/provider-adapters.md](docs/provider-adapters.md) dosyasindadir.
