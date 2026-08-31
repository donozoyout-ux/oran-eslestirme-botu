# Vercel -> Railway backend

Vercel dashboard yalnizca proxy katmanidir. `BACKEND_URL` Railway public domainini gostermelidir.

Kabul edilen ornekler:

- `https://oran-botu.up.railway.app`
- `oran-botu.up.railway.app` (proxy otomatik `https://` ekler)

`*.railway.internal` adresleri Vercel tarafindan kullanilamaz ve proxy bunlari reddeder.
