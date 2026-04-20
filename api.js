const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const { connect, getResults, getNextSession, getLiveTick, onEvent, updateToken, getToken } = require("./tele68-client");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── Persistent storage — lưu predictions vào file ──
const DATA_FILE = path.join(__dirname, "predictions.json");
let predictionLog = [];

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      predictionLog = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      console.log(`[DATA] Loaded ${predictionLog.length} predictions from file`);
    }
  } catch(e) { console.error("[DATA] Load error:", e.message); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(predictionLog, null, 2));
  } catch(e) { console.error("[DATA] Save error:", e.message); }
}

loadData();

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

// ── Prediction logging — lưu dự đoán + kết quả để nâng cấp thuật toán ──
app.post("/log-prediction", (req, res) => {
  const { sessionId, prediction, conf, level, amtTai, amtXiu, userTai, userXiu, imbal, dominant } = req.body;
  if (!sessionId || !prediction) return res.status(400).json({ status: "error", message: "Thiếu dữ liệu" });
  // Upsert — nếu đã có sessionId thì update, chưa có thì thêm mới
  const idx = predictionLog.findIndex(p => p.sessionId == sessionId);
  const entry = { sessionId, prediction, conf, level, amtTai, amtXiu, userTai, userXiu, imbal, dominant, ts: Date.now(), result: null, correct: null };
  if (idx >= 0) { predictionLog[idx] = { ...predictionLog[idx], ...entry }; }
  else { predictionLog.unshift(entry); if (predictionLog.length > 10000) predictionLog.pop(); }
  saveData();
  res.json({ status: "ok" });
});

app.post("/log-result", (req, res) => {
  const { sessionId, result } = req.body;
  if (!sessionId || !result) return res.status(400).json({ status: "error", message: "Thiếu dữ liệu" });
  const idx = predictionLog.findIndex(p => p.sessionId == sessionId);
  if (idx >= 0) {
    predictionLog[idx].result  = result;
    predictionLog[idx].correct = predictionLog[idx].prediction === result;
    saveData();
    const icon = predictionLog[idx].correct ? "✅" : "❌";
    console.log(`[RESULT] #${sessionId} → ${result} | Dự đoán: ${predictionLog[idx].prediction} ${icon}`);
  }
  res.json({ status: "ok" });
});

// ── Stats endpoint — xem đúng/sai nhanh ──
app.get("/stats", (req, res) => {
  const withResult = predictionLog.filter(p => p.result !== null);
  const correct    = withResult.filter(p => p.correct === true);
  const wrong      = withResult.filter(p => p.correct === false);

  // Win rate theo level
  const byLevel = {};
  withResult.forEach(p => {
    if (!p.level) return;
    if (!byLevel[p.level]) byLevel[p.level] = { win: 0, total: 0 };
    byLevel[p.level].total++;
    if (p.correct) byLevel[p.level].win++;
  });

  // 10 phiên gần nhất với icon
  const recent = predictionLog.slice(0, 10).map(p => ({
    sessionId: p.sessionId,
    prediction: p.prediction,
    result: p.result,
    correct: p.correct,
    icon: p.correct === true ? "✅" : p.correct === false ? "❌" : "⏳",
    conf: p.conf,
    level: p.level,
    imbal: p.imbal
  }));

  res.json({
    status: "ok",
    summary: {
      total: predictionLog.length,
      withResult: withResult.length,
      correct: correct.length,
      wrong: wrong.length,
      accuracy: withResult.length ? (correct.length / withResult.length * 100).toFixed(1) + "%" : "—",
      streak: (() => {
        let s = 0;
        for (const p of withResult) { if (p.correct === withResult[0]?.correct) s++; else break; }
        return (withResult[0]?.correct ? "✅ " : "❌ ") + s + " liên tiếp";
      })()
    },
    byLevel: Object.fromEntries(Object.entries(byLevel).map(([lv, v]) => [lv, {
      winRate: (v.win / v.total * 100).toFixed(1) + "%",
      total: v.total
    }])),
    recent
  });
});

// ── Export full data cho AI ──
app.get("/export", (req, res) => {
  const withResult = predictionLog.filter(p => p.result !== null);
  const correct = withResult.filter(p => p.correct).length;
  res.json({
    status: "ok",
    exportedAt: new Date().toISOString(),
    summary: {
      total: predictionLog.length,
      accuracy: withResult.length ? (correct / withResult.length * 100).toFixed(1) + "%" : "—"
    },
    data: predictionLog
  });
});

server.listen(PORT, () => {
  console.log(`[API] Port ${PORT} | WS: ws://localhost:${PORT}/ws`);
  connect();
});
