const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const { connect, getResults, getNextSession, getLiveTick, onEvent, updateToken, getToken } = require("./tele68-client");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── WebSocket server cho browser ──
const wss = new WebSocket.Server({ server, path: "/ws" });

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

wss.on("connection", (ws) => {
  console.log("[WS] Browser kết nối");
  // Gửi ngay tick hiện tại nếu có
  const tick = getLiveTick();
  if (tick) ws.send(JSON.stringify({ type: "tick", data: tick }));
  const results = getResults();
  if (results.length) ws.send(JSON.stringify({ type: "result", data: results[0] }));
  ws.on("close", () => console.log("[WS] Browser ngắt kết nối"));
});

// Forward events từ tele68 → tất cả browser clients
onEvent((type, data) => broadcast(type, data));

// ── CORS ──
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "nha_cai_v3.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "nha_cai_v3.html")));

app.get("/result", (req, res) => {
  const results = getResults();
  const next = getNextSession();
  res.json({ status: "ok", next: next ? { sessionId: next.id, md5: next.md5 } : null, latest: results.length ? results[0] : null });
});

app.get("/live", (req, res) => {
  const tick = getLiveTick();
  const results = getResults();
  res.json({ status: "ok", tick, latestResult: results.length ? results[0] : null });
});

app.get("/history", (req, res) => {
  const results = getResults();
  const next = getNextSession();
  res.json({ status: "ok", next: next ? { sessionId: next.id, md5: next.md5 } : null, count: results.length, data: results });
});

app.get("/dulieumd5", (req, res) => {
  const results = getResults();
  res.json({ status: "ok", count: results.length, data: results.map(r => ({ phien: r.sessionId, md5: r.md5, md5Raw: r.md5Raw, ketqua: r.result })) });
});

app.post("/update-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ status: "error", message: "Thiếu token" });
  updateToken(token);
  res.json({ status: "ok", message: "Token đã được cập nhật, đang reconnect..." });
});

app.get("/token-status", (req, res) => {
  const token = getToken();
  if (!token) return res.json({ status: "no_token" });
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    const now = Math.floor(Date.now() / 1000);
    const remaining = payload.exp - now;
    res.json({ status: remaining > 0 ? "ok" : "expired", expiresIn: remaining > 0 ? `${Math.floor(remaining / 60)} phút` : "Đã hết hạn", username: payload.username || payload.nickName });
  } catch { res.json({ status: "invalid_token" }); }
});

server.listen(PORT, () => {
  console.log(`[API] Port ${PORT} | WS: ws://localhost:${PORT}/ws`);
  connect();
});
