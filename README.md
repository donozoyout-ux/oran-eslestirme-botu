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
- Ucretsiz The Odds API adaptoru (`h2h`, `spreads`, `totals`)
- Tum futbol pazarlari icin genisletilebilir kanonik pazar modeli
- Mock verilerle anahtarsiz calisan demo
- `/health`, `/status` ve korumali `/run-once` uclari
- Ana adreste otomatik yenilenen canli durum paneli
- Docker, Render ve GitHub Actions yapilandirmasi

## Onemli demo siniri

`ODDS_PROVIDER=mock` durumunda Pinnacle, Betfair, bet365, Nesine, Misli ve Bilyoner adlariyla uretilen veriler **tamamen ornektir**. Gercek site verisi degildir.

Ucretsiz The Odds API modu, yalnizca saglayicinin o anda sundugu bookmaker ve pazar verilerini getirir. Nesine, Misli ve Bilyoner icin kamuya acik/izinli bir veri erisimi saglanmadan dogrudan site kazima eklenmemistir. bet365 veya baska bir kaynaga, kullanim sartlarini ihlal eden kaziyici eklemeyin.

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
| `ODDS_PROVIDER` | `mock` | `mock` veya `the_odds_api` |
| `SPORT_KEYS` | iki futbol ligi | Virgul ayrimli lig anahtarlari |
| `BOOKMAKER_KEYS` | secilen kaynaklar | Virgul ayrimli bookmaker anahtarlari |
| `ODDS_TOLERANCE_PERCENT` | `2` | Bildirim icin azami goreli fark |
| `POLL_INTERVAL_SECONDS` | `60` | Tarama araligi; en az 10 saniye |
| `MAX_QUOTE_AGE_SECONDS` | `300` | Bayat veri esigi |
| `MAX_LIVE_EVENT_AGE_MINUTES` | `180` | Baslangictan sonra canli sayilacak azami sure |
| `ALERT_COOLDOWN_SECONDS` | `600` | Ayni eslesme icin tekrar bekleme suresi |
| `DRY_RUN` | `true` | Telegram yerine terminale yazar |
| `ADMIN_TOKEN` | bos | `/run-once` ucunu acar ve korur |
| `STATE_FILE` | `./data/alert-state.json` | Bildirim tekillestirme durumu |

## Render'a dagitim

Depoda `render.yaml` ve `Dockerfile` hazirdir.

1. Projeyi yeni, ozel bir GitHub reposuna gonderin.
2. Render'da **New > Blueprint** ile repoyu secin.
3. Ilk dagitimda `ODDS_PROVIDER=mock` ve `DRY_RUN=true` ile saglik kontrolu yapin.
4. Ardindan `ODDS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` degerlerini Render Environment bolumune ekleyin.
5. `ODDS_PROVIDER=the_odds_api` ve `DRY_RUN=false` yapin.

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

Testler; `%2` hesabi, bayat veri, farkli cizgi, canli/mac onu ayrimi, ayni bookmaker'i dislama, API donusumu ve bildirim cooldown davranisini kapsar.

## Sonraki surum

- Lisansli veri saglayicida alt kaynaktan gelen tum futbol pazarlarini acma
- Betfair Exchange komisyonunu efektif orana donusturme
- PostgreSQL tabanli kalici bildirim durumu
- Kaynak/pazar bazli Telegram filtreleri
- Basit yonetim paneli ve veri kaynagi saglik ekranlari

Kanikonik pazar sozlesmesi ve yeni kaynak ekleme kurallari [docs/provider-adapters.md](docs/provider-adapters.md) dosyasindadir.
