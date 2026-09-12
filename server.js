const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

// โหลด .env ในโฟลเดอร์โปรเจกต์ (ไม่ทับค่าที่มีอยู่แล้ว เช่นบน Render)
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
} catch (_) {
  /* ignore */
}

const PORT = Number(process.env.PORT) || 3000;
const DIGIT_COUNT = 4;
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 30;
const SECONDS_PER_LINE = 120;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ALLOW_DEMO_AUTH = process.env.ALLOW_DEMO_AUTH !== "0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

const rooms = new Map();
const lobbyWatchers = new Set();
const memoryStats = new Map();

let admin = null;
let db = null;

function initFirebaseAdmin() {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      console.log("Firebase Admin: ยังไม่มี FIREBASE_SERVICE_ACCOUNT · ใช้สถิติในหน่วยความจำ");
      return;
    }
    const serviceAccount = JSON.parse(raw);
    admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
    console.log("Firebase Admin พร้อมแล้ว");
  } catch (error) {
    console.error("Firebase Admin init failed:", error.message);
    admin = null;
    db = null;
  }
}

initFirebaseAdmin();

function getFirebaseWebConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(room, type, payload = {}, exceptId = null) {
  for (const player of room.players.values()) {
    if (exceptId && player.id === exceptId) continue;
    send(player.ws, type, payload);
  }
}

function publicPlayers(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    uid: player.uid || null,
    isHost: player.id === room.hostId,
    submitted: Boolean(player.pending),
  }));
}

function lobbyPayload(room) {
  return {
    code: room.code,
    roomName: room.roomName,
    hasPassword: Boolean(room.passwordHash),
    allowRepeat: room.allowRepeat,
    roundLimit: room.roundLimit,
    status: room.status,
    players: publicPlayers(room),
    hostId: room.hostId,
    playerCount: room.players.size,
  };
}

function publicRoomList() {
  return [...rooms.values()]
    .filter((room) => room.status === "lobby")
    .map((room) => ({
      code: room.code,
      roomName: room.roomName,
      hasPassword: Boolean(room.passwordHash),
      playerCount: room.players.size,
      maxPlayers: MAX_PLAYERS,
      allowRepeat: room.allowRepeat,
      roundLimit: room.roundLimit,
      hostName: room.players.get(room.hostId)?.name || "",
    }));
}

function broadcastRoomList() {
  const list = publicRoomList();
  for (const ws of lobbyWatchers) {
    send(ws, "roomList", { rooms: list });
  }
}

function generateCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("ไม่สามารถสร้างรหัสห้องได้");
}

function generateSecret(allowRepeat) {
  if (allowRepeat) {
    return Array.from({ length: DIGIT_COUNT }, () => Math.floor(Math.random() * 10));
  }
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DIGIT_COUNT);
}

function evaluateGuess(guess, secret) {
  const exact = Array(DIGIT_COUNT).fill(false);
  const secretUsed = Array(DIGIT_COUNT).fill(false);
  let blacks = 0;
  let whites = 0;

  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    if (guess[i] === secret[i]) {
      exact[i] = true;
      secretUsed[i] = true;
      blacks += 1;
    }
  }

  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    if (exact[i]) continue;
    for (let j = 0; j < DIGIT_COUNT; j += 1) {
      if (!secretUsed[j] && guess[i] === secret[j]) {
        secretUsed[j] = true;
        whites += 1;
        break;
      }
    }
  }

  return {
    blacks,
    whites,
    win: blacks === DIGIT_COUNT,
    none: blacks === 0 && whites === 0,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return true;
  try {
    const [salt, hash] = String(stored).split(":");
    if (!salt || !hash) return false;
    const next = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(next, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function deleteRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.players.size === 0) {
    clearRoomTimer(room);
    rooms.delete(code);
    broadcastRoomList();
  }
}

function modeWinField(mode) {
  if (mode === "multi") return "multiWins";
  if (mode === "online") return "onlineWins";
  return "soloWins";
}

function bumpMemoryStats(uid, displayName, photoURL, mode) {
  const field = modeWinField(mode);
  const current = memoryStats.get(uid) || {
    uid,
    displayName: displayName || "ผู้เล่น",
    photoURL: photoURL || "",
    soloWins: 0,
    multiWins: 0,
    onlineWins: 0,
  };
  current.displayName = displayName || current.displayName;
  current.photoURL = photoURL || current.photoURL;
  current[field] = Number(current[field] || 0) + 1;
  memoryStats.set(uid, current);
  return current;
}

async function recordWin({ uid, displayName, photoURL, mode }) {
  if (!uid) return;
  bumpMemoryStats(uid, displayName, photoURL, mode);
  if (!db) return;
  const field = modeWinField(mode);
  const ref = db.collection("stats").doc(uid);
  await ref.set(
    {
      displayName: displayName || "ผู้เล่น",
      photoURL: photoURL || "",
      [field]: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function getLeaderboard(mode) {
  const field = modeWinField(mode);
  if (db) {
    try {
      const snap = await db.collection("stats").orderBy(field, "desc").limit(20).get();
      return snap.docs.map((doc, index) => {
        const data = doc.data() || {};
        return {
          uid: doc.id,
          rank: index + 1,
          name: data.displayName || "ผู้เล่น",
          photoURL: data.photoURL || "",
          wins: Number(data[field] || 0),
        };
      });
    } catch (error) {
      console.error("leaderboard firestore error:", error.message);
    }
  }
  return [...memoryStats.values()]
    .map((row) => ({
      uid: row.uid,
      name: row.displayName,
      photoURL: row.photoURL,
      wins: Number(row[field] || 0),
    }))
    .filter((row) => row.wins > 0)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 20)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function verifyAuthToken(idToken) {
  if (!idToken) return null;
  if (String(idToken).startsWith("demo:")) {
    // โหมดแขก: อนุญาตถ้าเปิด demo หรือยังไม่มี Firebase Admin
    if (!ALLOW_DEMO_AUTH && admin) return null;
    const parts = String(idToken).split(":");
    return {
      uid: parts[2] || `demo_${Date.now()}`,
      name: parts[1] || "ผู้เล่นทดลอง",
      picture: "",
      demo: true,
    };
  }
  if (!admin) return null;
  const decoded = await admin.auth().verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    name: decoded.name || decoded.email || "ผู้เล่น",
    picture: decoded.picture || "",
    demo: false,
  };
}

async function endGame(room, reason, winners = []) {
  if (room.status === "ended") return;
  room.status = "ended";
  clearRoomTimer(room);

  if (reason === "win" && winners.length) {
    for (const winner of winners) {
      const player = [...room.players.values()].find((item) => item.id === winner.id);
      if (!player?.uid) continue;
      try {
        await recordWin({
          uid: player.uid,
          displayName: player.name,
          photoURL: player.photoURL || "",
          mode: "online",
        });
      } catch (error) {
        console.error("record online win failed:", error.message);
      }
    }
  }

  const papers = [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    rows: player.rows,
  }));

  broadcast(room, "ended", {
    reason,
    secret: room.secret,
    winners,
    papers,
    allowRepeat: room.allowRepeat,
    roundLimit: room.roundLimit,
  });
  broadcastRoomList();
}

function maybeTimeout(room) {
  if (room.status !== "playing" || !room.endsAt) return;
  if (Date.now() < room.endsAt) return;
  endGame(room, "timeout", []);
}

function finishRound(room) {
  const results = [];
  const winners = [];

  for (const player of room.players.values()) {
    const pending = player.pending;
    if (!pending) continue;
    const result = evaluateGuess(pending.guess, room.secret);
    const row = { guess: pending.guess, ...result };
    player.rows.push(row);
    player.pending = null;
    results.push({
      id: player.id,
      name: player.name,
      row,
    });
    if (result.win) winners.push({ id: player.id, name: player.name, uid: player.uid || null });
  }

  room.currentRound += 1;

  for (const player of room.players.values()) {
    send(player.ws, "roundResult", {
      round: room.currentRound,
      yourRow: results.find((item) => item.id === player.id)?.row || null,
      submitted: publicPlayers(room),
      winners,
      nextRound: room.currentRound < room.roundLimit ? room.currentRound + 1 : null,
    });
  }

  if (winners.length) {
    endGame(room, "win", winners);
    return;
  }

  if (room.currentRound >= room.roundLimit) {
    endGame(room, "rounds", []);
    return;
  }

  broadcast(room, "waiting", {
    round: room.currentRound + 1,
    players: publicPlayers(room),
    endsAt: room.endsAt,
  });
}

async function createRoom(ws, msg) {
  const auth = await verifyAuthToken(msg.idToken);
  if (!auth) {
    send(ws, "error", { message: "ต้องล็อกอินก่อนสร้างห้อง" });
    return;
  }

  const name = String(msg.name || auth.name || "").trim().slice(0, 20);
  const roomName = String(msg.roomName || `${name} ห้อง`).trim().slice(0, 24) || "ห้องใหม่";
  const password = String(msg.password || "");
  const allowRepeat = Boolean(msg.allowRepeat);
  const roundLimit = Number(msg.roundLimit);

  if (!name) {
    send(ws, "error", { message: "กรุณาใส่ชื่อ" });
    return;
  }
  if (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > MAX_ROUNDS) {
    send(ws, "error", { message: `จำนวนบรรทัดต้องเป็นเลข 1–${MAX_ROUNDS}` });
    return;
  }

  leaveCurrent(ws);

  const code = generateCode();
  const player = {
    id: cryptoRandomId(),
    uid: auth.uid,
    name,
    photoURL: auth.picture || "",
    ws,
    rows: [],
    pending: null,
  };

  const room = {
    code,
    roomName,
    passwordHash: password ? hashPassword(password) : null,
    hostId: player.id,
    allowRepeat,
    roundLimit,
    status: "lobby",
    secret: null,
    currentRound: 0,
    endsAt: null,
    timer: null,
    players: new Map([[player.id, player]]),
  };

  ws.roomCode = code;
  ws.playerId = player.id;
  rooms.set(code, room);
  lobbyWatchers.delete(ws);

  send(ws, "joined", {
    you: { id: player.id, name: player.name, isHost: true, uid: player.uid },
    ...lobbyPayload(room),
    secondsPerLine: SECONDS_PER_LINE,
  });
  broadcast(room, "lobby", lobbyPayload(room));
  broadcastRoomList();
}

async function joinRoom(ws, msg) {
  const auth = await verifyAuthToken(msg.idToken);
  if (!auth) {
    send(ws, "error", { message: "ต้องล็อกอินก่อนเข้าห้อง" });
    return;
  }

  const name = String(msg.name || auth.name || "").trim().slice(0, 20);
  const code = String(msg.code || "")
    .trim()
    .toUpperCase();
  const password = String(msg.password || "");

  if (!name) {
    send(ws, "error", { message: "กรุณาใส่ชื่อ" });
    return;
  }
  if (!code) {
    send(ws, "error", { message: "กรุณาใส่รหัสห้อง" });
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    send(ws, "error", { message: "ไม่พบห้องนี้" });
    return;
  }
  if (room.status !== "lobby") {
    send(ws, "error", { message: "เกมเริ่มไปแล้ว เข้าไม่ได้" });
    return;
  }
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, "error", { message: `ห้องเต็มแล้ว (สูงสุด ${MAX_PLAYERS} คน)` });
    return;
  }
  if (room.passwordHash && !verifyPassword(password, room.passwordHash)) {
    send(ws, "error", { message: "รหัสผ่านห้องไม่ถูกต้อง" });
    return;
  }
  if ([...room.players.values()].some((player) => player.name === name)) {
    send(ws, "error", { message: "ชื่อนี้มีในห้องแล้ว ลองเปลี่ยนชื่อของคุณ" });
    return;
  }

  leaveCurrent(ws);

  const player = {
    id: cryptoRandomId(),
    uid: auth.uid,
    name,
    photoURL: auth.picture || "",
    ws,
    rows: [],
    pending: null,
  };
  room.players.set(player.id, player);
  ws.roomCode = code;
  ws.playerId = player.id;
  lobbyWatchers.delete(ws);

  send(ws, "joined", {
    you: { id: player.id, name: player.name, isHost: false, uid: player.uid },
    ...lobbyPayload(room),
    secondsPerLine: SECONDS_PER_LINE,
  });
  broadcast(room, "lobby", lobbyPayload(room));
  broadcastRoomList();
}

function startGame(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) {
    send(ws, "error", { message: "ไม่ได้อยู่ในห้อง" });
    return;
  }
  if (ws.playerId !== room.hostId) {
    send(ws, "error", { message: "เฉพาะเจ้าของห้องเริ่มเกมได้" });
    return;
  }
  if (room.status !== "lobby") {
    send(ws, "error", { message: "เริ่มเกมไปแล้ว" });
    return;
  }
  if (room.players.size < 2) {
    send(ws, "error", { message: "ต้องมีอย่างน้อย 2 คน" });
    return;
  }

  room.status = "playing";
  room.secret = generateSecret(room.allowRepeat);
  room.currentRound = 0;
  room.endsAt = Date.now() + room.roundLimit * SECONDS_PER_LINE * 1000;

  for (const player of room.players.values()) {
    player.rows = [];
    player.pending = null;
  }

  clearRoomTimer(room);
  room.timer = setInterval(() => maybeTimeout(room), 500);

  broadcast(room, "started", {
    round: 1,
    roundLimit: room.roundLimit,
    allowRepeat: room.allowRepeat,
    endsAt: room.endsAt,
    secondsPerLine: SECONDS_PER_LINE,
    players: publicPlayers(room),
  });
  broadcastRoomList();
}

function submitGuess(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.status !== "playing") {
    send(ws, "error", { message: "ยังไม่ได้อยู่ในเกม" });
    return;
  }

  maybeTimeout(room);
  if (room.status !== "playing") return;

  const player = room.players.get(ws.playerId);
  if (!player) return;

  const expectedRound = room.currentRound + 1;
  const round = Number(msg.round);
  if (round !== expectedRound) {
    send(ws, "error", { message: "รอบไม่ตรงกับเซิร์ฟเวอร์" });
    return;
  }
  if (player.pending) {
    send(ws, "error", { message: "ส่งคำตอบรอบนี้แล้ว รอเพื่อน" });
    return;
  }

  const digits = Array.isArray(msg.digits) ? msg.digits.map(Number) : [];
  if (digits.length !== DIGIT_COUNT || digits.some((d) => !Number.isInteger(d) || d < 0 || d > 9)) {
    send(ws, "error", { message: "ต้องกรอกตัวเลข 4 หลัก" });
    return;
  }
  if (!room.allowRepeat && new Set(digits).size !== DIGIT_COUNT) {
    send(ws, "error", { message: "โหมดนี้ห้ามใช้เลขซ้ำ" });
    return;
  }

  player.pending = { guess: digits };
  broadcast(room, "waiting", {
    round: expectedRound,
    players: publicPlayers(room),
    endsAt: room.endsAt,
  });

  const allIn = [...room.players.values()].every((item) => item.pending);
  if (allIn) finishRound(room);
}

function leaveCurrent(ws) {
  lobbyWatchers.delete(ws);
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) {
    ws.roomCode = null;
    ws.playerId = null;
    return;
  }

  const playerId = ws.playerId;
  room.players.delete(playerId);
  ws.roomCode = null;
  ws.playerId = null;

  if (room.players.size === 0) {
    deleteRoomIfEmpty(code);
    return;
  }

  if (room.hostId === playerId) {
    room.hostId = room.players.keys().next().value;
  }

  if (room.status === "playing") {
    const remaining = [...room.players.values()];
    if (remaining.length < 2) {
      endGame(room, "abandoned", []);
      return;
    }
    broadcast(room, "waiting", {
      round: room.currentRound + 1,
      players: publicPlayers(room),
      endsAt: room.endsAt,
    });
    if (remaining.every((item) => item.pending)) {
      finishRound(room);
    }
  } else if (room.status === "lobby") {
    broadcast(room, "lobby", lobbyPayload(room));
    broadcastRoomList();
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (urlPath === "/health") {
    sendJson(res, 200, { ok: true, rooms: rooms.size, firebaseAdmin: Boolean(db) });
    return;
  }

  if (urlPath === "/api/firebase-config") {
    sendJson(res, 200, getFirebaseWebConfig());
    return;
  }

  if (urlPath === "/api/leaderboard" && method === "GET") {
    const mode = new URL(req.url, "http://localhost").searchParams.get("mode") || "solo";
    const rows = await getLeaderboard(mode);
    sendJson(res, 200, { mode, rows });
    return;
  }

  if (urlPath === "/api/record-win" && method === "POST") {
    try {
      const body = await readBody(req);
      const auth = await verifyAuthToken(body.idToken);
      if (!auth) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const mode = body.mode === "multi" || body.mode === "online" ? body.mode : "solo";
      await recordWin({
        uid: auth.uid,
        displayName: body.displayName || auth.name,
        photoURL: body.photoURL || auth.picture || "",
        mode,
      });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "failed" });
    }
    return;
  }

  let filePath = path.join(__dirname, urlPath === "/" ? "index.html" : urlPath);

  if (!filePath.startsWith(__dirname) || filePath.includes("node_modules")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  send(ws, "hello", {
    lanAddresses: getLanAddresses(),
    port: PORT,
    secondsPerLine: SECONDS_PER_LINE,
    rooms: publicRoomList(),
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, "error", { message: "ข้อความไม่ถูกต้อง" });
      return;
    }

    try {
      switch (msg.type) {
        case "watchRooms":
          lobbyWatchers.add(ws);
          send(ws, "roomList", { rooms: publicRoomList() });
          break;
        case "create":
          await createRoom(ws, msg);
          break;
        case "join":
          await joinRoom(ws, msg);
          break;
        case "start":
          startGame(ws);
          break;
        case "submit":
          submitGuess(ws, msg);
          break;
        case "leave":
          leaveCurrent(ws);
          send(ws, "left", {});
          broadcastRoomList();
          break;
        default:
          send(ws, "error", { message: "คำสั่งไม่รู้จัก" });
      }
    } catch (error) {
      console.error(error);
      send(ws, "error", { message: "เซิร์ฟเวอร์ผิดพลาด" });
    }
  });

  ws.on("close", () => {
    leaveCurrent(ws);
    broadcastRoomList();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const lans = getLanAddresses();
  console.log(`เกมท้ายตัวเลขพร้อมที่ http://localhost:${PORT}`);
  for (const ip of lans) {
    console.log(`  LAN: http://${ip}:${PORT}`);
  }
});
