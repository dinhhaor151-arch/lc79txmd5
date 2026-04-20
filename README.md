# House Edge Intelligence v3

Tài xỉu analysis tool với realtime WebSocket data từ tele68.

## Deploy lên Railway

1. Push code lên GitHub
2. Vào [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Chọn repo này
4. Vào **Variables** tab, thêm:
   ```
   TELE68_USER=dinhhaor150
   TELE68_PASS=dinhvuhao5
   PORT=3000
   ```
5. Railway tự build và deploy. Lấy domain từ **Settings → Domains**
6. Mở domain đó trên browser là xong

## Chạy local

```bash
npm install
node api.js
```

Mở `http://localhost:3000`

## Files quan trọng

- `api.js` — Express server + WebSocket server
- `tele68-client.js` — Kết nối WebSocket tele68, parse dữ liệu
- `nha_cai_v3.html` — Frontend UI
