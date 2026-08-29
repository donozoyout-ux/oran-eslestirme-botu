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
- Ucretsiz The Odds API adaptoru (`h2h`, `spreads`, `totals`)
- Herkese acik BetExplorer sayfalarindan dusuk frekansli web scraping
- Canli maclarda `1X2`, `Alt/Ust`, Asya handikap, Cifte Sans, KG Var/Yok ve Beraberlikte Iade
- Mac onunde `1X2` bookmaker karsilastirmasi
- Tum futbol pazarlari icin genisletilebilir kanonik pazar modeli
- Mock verilerle anahtarsiz calisan demo
- `/health`, `/status` ve korumali `/run-once` uclari
- Ana adreste otomatik yenilenen canli durum paneli
- Docker, Render ve GitHub Actions yapilandirmasi

## Veri kaynagi sinirlari

`ODDS_PROVIDER=mock` durumunda uretilen veriler **tamamen ornektir**. Gercek site verisi degildir.

`ODDS_PROVIDER=betexplorer_scraper`, BetExplorer'in giris gerektirmeyen oran karsilastirma sayfalarinda gorunen bookmaker satirlarini okur. Bet365, Betfair ve Betfair Exchange dahil, sayfanin o anda gosterdigi ve `BOOKMAKER_KEYS` ile izin verilen kaynaklar kullanilir. Site yapisi degisirse kaynak hata verebilir; sistem CAPTCHA, oturum, bolge engeli veya bot korumasi asmaz.

Eski Render servislerinde kalmis `ODDS_PROVIDER=mock` degeri, `NODE_ENV=production` ortaminda otomatik olarak scraper'a yukseltirilir. Uretimde ozellikle demo istenirse `ALLOW_MOCK_IN_PRODUCTION=true` ayarlanabilir.

Nesine, Misli ve Bilyoner bu sunucudan acilan herkese acik sayfada kullanilabilir oran tablosu dondurmedigi icin gercek kaynak olarak etiketlenmez. Onlar icin resmi/lisansli veri erisimi gerekir.

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
| `ODDS_TOLERANCE_PERCENT` | `2` | Bildirim icin azami goreli fark |
| `POLL_INTERVAL_SECONDS` | `60` | Tarama araligi; en az 10 saniye |
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
| `SURPRISE_ODDS_THRESHOLD` | `2.5` | Iki yakin oranin ortalamasi bu degere ulasirsa surpriz adayi etiketi |
| `ODDS_MOVEMENT_THRESHOLD_PERCENT` | `8` | Acilis oranina gore analiz sinyali uretecek degisim |
| `DRY_RUN` | `true` | Telegram yerine terminale yazar |
| `ADMIN_TOKEN` | bos | `/run-once` ucunu acar ve korur |
| `STATE_FILE` | `./data/alert-state.json` | Bildirim tekillestirme durumu |
| `DAILY_SHEET_FILE` | `./data/daily-match-sheet.json` | Gunluk fikstur, oran gecmisi ve sinyal tablosu |
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
