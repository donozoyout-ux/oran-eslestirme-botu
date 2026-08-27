# Veri saglayici adaptoru

Her izinli veri kaynagi `OddsProvider` arayuzunu uygular ve ham veriyi `OddsQuote[]` bicimine donusturur. Karsilastirma motoru kaynaga ozel JSON bilmez.

## Zorunlu alanlar

| Alan | Kural |
| --- | --- |
| `bookmakerKey` | Kaynak icinde kararli, benzersiz anahtar |
| `sourceEventId` | Ham kaynaktaki etkinlik kimligi |
| `homeTeam`, `awayTeam` | Resmi takim adlari; takma ad esleme adaptorden once yapilabilir |
| `commenceTime` | UTC ISO 8601 |
| `phase` | `prematch` veya `live` |
| `marketKey` | Kanonik pazar anahtari |
| `period` | `full_time`, `first_half`, `second_half` veya belgeli custom deger |
| `selectionKey` | `home`, `away`, `draw`, `over`, `under`, `yes`, `no` veya kararli custom deger |
| `line` | Handikap/Alt-Ust cizgisi; yoksa `null` |
| `price` | Ondalik oran, 1'den buyuk |
| `updatedAt` | Oranin kaynaktaki son guncellenme zamani |

## Pazar esleme kurallari

Su pazarlar birbirine karistirilmamalidir:

- 90 dakika sonucu ile uzatmalar dahil sonuc
- Avrupa handikapi ile Asya handikapi
- Farkli Alt/Ust cizgileri
- Ilk yari ile mac sonu
- Standart oran ile artirilmis/kisiye ozel oran
- Betfair `back` ile `lay` fiyati
- Ham Betfair fiyati ile komisyon sonrasi efektif fiyat

Yeni bir pazar icin mevcut `MarketKey` yeterli degilse `custom:<saglayici>:<pazar>` kullanin. Iki farkli custom pazar ancak ayni kararli anahtari ve ayni settlement kurallarini kullaniyorsa karsilastirilmalidir.

## Yeni adaptor ekleme

1. `src/providers/` altinda `OddsProvider` uygulayin.
2. Ham cevabi calisma aninda dogrulayin; eksik/bozuk satirlari atlayin.
3. Tum zamanlari UTC ISO 8601'e, oranlari ondalik bicime donusturun.
4. Bookmaker ve pazar kimliklerini kararli tutun.
5. `src/providers/index.ts` icindeki fabrikaya yeni provider adini ekleyin.
6. Fixture tabanli donusum, bayat veri ve pazar cizgisi testleri yazin.
7. Saglayicinin kullanim sartlari, yenileme araligi ve kota limitlerine uyun.

Kullanim izni olmayan bir site icin gizli endpoint kesfi, oturum kopyalama, CAPTCHA atlatma veya tarayici parmak izi gizleme eklenmemelidir.
