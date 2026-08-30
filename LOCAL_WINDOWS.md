# Windows'ta kendi bilgisayarinda calistirma

Bu mod Render'a ihtiyaç duymaz. Bot, oran toplama, Telegram bildirimi ve Google Sheets senkronizasyonunu doğrudan kendi bilgisayarından yapar.

## Gereksinimler

- Windows 10/11
- Node.js 20+ (öneri: Node.js 22 LTS)
- Google Chrome veya Microsoft Edge
- Repo bilgisayarda indirilmiş olmalı

## 1. `.env` dosyasını hazırla

Repo kökünde `.env.example` dosyasını `.env` olarak kopyala.

Render'da kullandığın değerleri kendi bilgisayarındaki `.env` dosyasına gir. Özellikle mevcut kurulumuna göre şu alanlar gerekebilir:

```dotenv
ODDS_PROVIDER=betexplorer_scraper
API_FOOTBALL_KEY=
FOOTBALL_DATA_TOKEN=
ODDS_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DRY_RUN=false
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

`.env` Git tarafından ignore edilir. Secret değerlerini GitHub'a commit etme ve mesajlarda paylaşma.

## 2. Botu başlat

Repo kökündeki:

```text
run-local.cmd
```

dosyasına çift tıkla.

Runner şunları otomatik yapar:

- Chrome veya Edge yolunu bulur.
- `node_modules` yoksa `npm ci` çalıştırır.
- TypeScript build alır.
- Botu başlatır.
- Bot hata nedeniyle kapanırsa 5 saniye sonra yeniden başlatır.

Yerel panel:

```text
http://127.0.0.1:3000
```

Durum:

```text
http://127.0.0.1:3000/status
```

Durdurmak için açık terminal penceresinde `Ctrl+C` kullan.

## 3. Windows açıldığında otomatik başlat

`.env` hazırlandıktan ve `run-local.cmd` en az bir kez başarıyla çalıştırıldıktan sonra PowerShell'de repo klasöründe şunu çalıştır:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-autostart.ps1
```

Bu işlem kullanıcının Startup klasörüne `Oran Eslestirme Botu` kısayolu ekler. Yönetici yetkisi gerektirmez.

Windows oturumu açıldığında bot otomatik başlar. Runner açık kaldığı sürece bot çökerse yeniden kaldırılır.

## 4. Bilgisayarın uykuya geçmesini kapat

7/24 takip için Windows güç ayarlarında cihazın uykuya geçmesini kapat. Bilgisayar kapanırsa veya internet kesilirse veri toplanamaz. İnternet geri geldiğinde provider döngüsü sonraki taramalarda tekrar çalışmaya devam eder.

## Güvenlik

Server `0.0.0.0` üzerinde dinler; bu nedenle aynı yerel ağdaki cihazlar Windows Firewall izin verirse panele erişebilir. Modemden port yönlendirme yapıp paneli doğrudan internete açma. Dışarıdan erişim gerekirse VPN/Tailscale benzeri özel ağ veya kimlik doğrulamalı reverse proxy kullan.

## Render

Yerel worker doğrulandıktan sonra Render servisi kapalı/suspended kalabilir. Aynı botu hem Render'da hem bilgisayarda eşzamanlı çalıştırmak Telegram bildirimlerinin ve API tüketiminin iki kez oluşmasına neden olabilir; tek aktif worker kullan.
