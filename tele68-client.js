const WebSocket = require("ws");
const https = require("https");
const crypto = require("crypto");
const { computeSignals, makeDecision } = require("./engine");

const WS_URL = "wss://wtxmd52.tele68.com/txmd5/?EIO=4&transport=websocket";

// Thông tin đăng nhập
const USERNAME = process.env.TELE68_USER || "dinhhaor150";
const PASSWORD = process.env.TELE68_PASS || "dinhvuhao5";

let currentToken = process.env.TELE68_TOKEN || "";
let results = [];
let pendingSession = null;
let currentSessionMd5 = null;
let reconnectAttempts = 0;
let isConnected = false;

// Live tick data — cập nhật realtime từ tick-update
let liveTick = null;
let lastAutoAnalyzedSession = null; // tránh phân tích lại cùng phiên

// Event callback
let _onEvent = null;
function onEvent(cb) { _onEvent = cb; }
function emit(type, data) { if (_onEvent) _onEvent(type, data); }

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "Origin": "https://lc79b.bet",
        "Referer": "https://lc79b.bet/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(d); }
      });
    }).on("error", reject);
  });
}

function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "Origin": "https://lc79b.bet",
        "Referer": "https://lc79b.bet/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(d); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function login() {
  // Bước 1: pre-auth lấy accessToken
  const pwMd5 = md5(PASSWORD);
  console.log(`[AUTH] Bước 1: pre-auth...`);
  const preAuth = await httpGet(
    `https://apifo88daigia.tele68.com/api?c=3&un=${USERNAME}&pw=${pwMd5}&cp=R&cl=R&pf=web&at=`
  );
  console.log("[AUTH] Pre-auth response:", JSON.stringify(preAuth).substring(0, 200));

  const accessToken = preAuth.accessToken || preAuth.data?.accessToken;
  const nickName = preAuth.nickName || preAuth.data?.nickName;

  if (!accessToken) throw new Error("Không lấy được accessToken từ pre-auth: " + JSON.stringify(preAuth));

  // Bước 2: login lấy JWT token
  console.log(`[AUTH] Bước 2: login với accessToken...`);
  const loginResp = await httpPost(
    "https://wlb.tele68.com/v1/lobby/auth/login?cp=R&cl=R&pf=web&at=",
    { nickName: nickName || "vuhao212", accessToken }
  );
  console.log("[AUTH] Login response:", JSON.stringify(loginResp).substring(0, 200));

  const token = loginResp.token || loginResp.data?.token;
  if (!token) throw new Error("Không lấy được JWT token: " + JSON.stringify(loginResp));

  console.log("[AUTH] Lấy token mới thành công!");
  currentToken = token;
  return token;
}

// Kiểm tra token còn hạn không (còn ít hơn 30 phút thì lấy mới)
function isTokenExpiringSoon(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    const now = Math.floor(Date.now() / 1000);
    return payload.exp - now < 1800; // < 30 phút
  } catch {
    return true;
  }
}

async function connect() {
  reconnectAttempts++;
  console.log(`[TELE68] Đang kết nối... (lần ${reconnectAttempts})`);

  // Tự lấy token mới nếu chưa có hoặc sắp hết hạn
  if (!currentToken || isTokenExpiringSoon(currentToken)) {
    console.log("[AUTH] Token hết hạn hoặc chưa có, đang đăng nhập...");
    try {
      await login();
    } catch (e) {
      console.error("[AUTH] Đăng nhập thất bại:", e.message, "| Thử lại sau 10s...");
      setTimeout(connect, 10000);
      return;
    }
  }

  const ws = new WebSocket(WS_URL, {
    headers: {
      "Origin": "https://lc79b.bet",
      "Referer": "https://lc79b.bet/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Cookie": "_fbp=fb.1.1773713719502.38681724729533993; _ga=GA1.1.291704866.1773713720"
    }
  });

  ws.on("open", () => {
    console.log("[TELE68] Đã kết nối!");
    isConnected = true;
    reconnectAttempts = 0;
  });

  ws.on("message", async (data) => {
    const txt = data.toString();
    if (txt.startsWith('0{')) {
      ws.send(`40/txmd5,{"token":"${currentToken}"}`);
      return;
    }
    if (txt === '2') { ws.send('3'); return; }

    // Phát hiện lỗi xác thực token
    if (txt.includes('"unauthorized"') || txt.includes('"token"') && txt.includes('"error"')) {
      console.log("[AUTH] Token bị từ chối, đang lấy token mới...");
      try {
        await login();
        ws.close(); // reconnect với token mới
      } catch (e) {
        console.error("[AUTH] Lấy token mới thất bại:", e.message);
      }
      return;
    }

    const m = txt.match(/^42\/txmd5,(\[.+\])$/s);
    if (!m) return;
    try {
      const [event, payload] = JSON.parse(m[1]);
      if (event === "tick-update") {
        const d = payload.data || {};
        liveTick = {
          sessionId: payload.id,
          tick: payload.tick,
          subTick: payload.subTick,
          state: payload.state,
          amtTai:  (d.totalAmountPerType && d.totalAmountPerType.TAI)  || 0,
          amtXiu:  (d.totalAmountPerType && d.totalAmountPerType.XIU)  || 0,
          userTai: (d.totalUsersPerType  && d.totalUsersPerType.TAI)   || 0,
          userXiu: (d.totalUsersPerType  && d.totalUsersPerType.XIU)   || 0,
          totalAmount: d.totalAmount || 0,
          totalUsers:  d.totalUniqueUsers || 0,
          timestamp: payload.timestamp || Date.now()
        };

        // ── Auto-analyze: server tự phân tích khi còn 5 giây (subTick = 5) ──
        const phaseSec = liveTick.subTick != null ? liveTick.subTick : liveTick.tick;
        if (
          liveTick.state === 'BETTING' &&
          phaseSec === 5 &&
          liveTick.sessionId !== lastAutoAnalyzedSession &&
          liveTick.amtTai > 0 && liveTick.amtXiu > 0
        ) {
          lastAutoAnalyzedSession = liveTick.sessionId;
          try {
            const s = computeSignals(liveTick.amtTai, liveTick.amtXiu, liveTick.userTai, liveTick.userXiu, results);
            const d2 = makeDecision(s, results);
            emit('auto-prediction', {
              sessionId: liveTick.sessionId,
              prediction: d2.prediction,
              conf: parseFloat(d2.conf.toFixed(1)),
              level: d2.level,
              amtTai: liveTick.amtTai,
              amtXiu: liveTick.amtXiu,
              userTai: liveTick.userTai,
              userXiu: liveTick.userXiu,
              imbal: parseFloat((s.imbal * 100).toFixed(2)),
              dominant: liveTick.amtTai > liveTick.amtXiu ? 'TAI' : 'XIU',
              ts: Date.now()
            });
            console.log(`[AUTO] Phiên #${liveTick.sessionId} → ${d2.prediction} (${d2.conf.toFixed(0)}% ${d2.level})`);
          } catch(e) { console.error('[AUTO] Analyze error:', e.message); }
        }

        emit("tick", liveTick);
        return;
      } else if (event === "session-info") {
        currentSessionMd5 = payload.md5;
        console.log(`[INFO] Phiên #${payload.id} | MD5: ${payload.md5}`);
      } else if (event === "session-result") {
        const entry = {
          time: new Date().toISOString(),
          sessionId: payload.md5Raw.split(':')[0],
          dice: payload.dices,
          sum: payload.dices.reduce((a, b) => a + b, 0),
          result: payload.resultTruyenThong,
          md5Raw: payload.md5Raw,
          md5: currentSessionMd5,
        };
        results.unshift(entry);
        if (results.length > 50000) results.pop();
        console.log(`[KẾT QUẢ] #${entry.sessionId} | ${entry.dice.join('-')} | ${entry.result}`);
        emit("result", entry);
      } else if (event === "new-session") {
        pendingSession = { id: payload.id, md5: payload.md5 };
        currentSessionMd5 = payload.md5;
        console.log(`[PHIÊN MỚI] #${payload.id} | MD5: ${payload.md5}`);
        emit("new-session", pendingSession);
      }
    } catch (e) {
      console.log(`[TELE68] Parse error: ${e.message}`);
    }
  });

  ws.on("error", (err) => {
    console.error("[TELE68 ERROR]", err.message);
    isConnected = false;
  });

  ws.on("close", (code, reason) => {
    console.log(`[TELE68] Mất kết nối (code: ${code}) | Reconnect sau 5s...`);
    isConnected = false;
    setTimeout(connect, 5000);
  });
}

function getResults() { return results; }
function getNextSession() { return pendingSession; }
function getLiveTick() { return liveTick; }
function updateToken(newToken) {
  currentToken = newToken;
  console.log("[AUTH] Token đã được cập nhật thủ công!");
}
function getToken() { return currentToken; }
module.exports = { connect, getResults, getNextSession, getLiveTick, onEvent, updateToken, getToken };
