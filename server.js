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
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 30;
const DEFAULT_SECONDS_PER_LINE = 120;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ALLOW_DEMO_AUTH = process.env.ALLOW_DEMO_AUTH !== "0";

const DIFFICULTY = {
  easy: { id: "easy", digitCount: 4, secondsPerLine: 120, columnFeedback: true, timeoutEnds: false },
  normal: { id: "normal", digitCount: 4, secondsPerLine: 120, columnFeedback: false, timeoutEnds: false },
  hard: { id: "hard", digitCount: 5, secondsPerLine: 120, columnFeedback: false, timeoutEnds: false },
  extreme: { id: "extreme", digitCount: 5, secondsPerLine: 30, columnFeedback: false, timeoutEnds: false },
};

function difficultyConfig(id) {
  return DIFFICULTY[id] || DIFFICULTY.normal;
}

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
const presenceClients = new Set();
const memoryStats = new Map();

let admin = null;
let db = null;

function broadcastPresence() {
  for (const client of [...presenceClients]) {
    if (!client || client.readyState !== 1) {
      presenceClients.delete(client);
    }
  }
  const onlineCount = presenceClients.size;
  for (const client of presenceClients) {
    send(client, "presence", { onlineCount });
  }
}

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
  if (ws && ws.readyState === 1) {
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
    isBot: Boolean(player.isBot),
    submitted: Boolean(player.pending),
    connected: Boolean(player.isBot || (player.ws && player.ws.readyState === 1)),
    ready: Boolean(player.ready || player.isBot),
  }));
}

function lobbyPayload(room) {
  return {
    code: room.code,
    roomName: room.roomName,
    hasPassword: Boolean(room.passwordHash),
    allowRepeat: room.allowRepeat,
    roundLimit: room.roundLimit,
    difficulty: room.difficulty,
    digitCount: room.digitCount,
    secondsPerLine: room.secondsPerLine,
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
      difficulty: room.difficulty,
      digitCount: room.digitCount,
      secondsPerLine: room.secondsPerLine,
      hostName: room.players.get(room.hostId)?.name || "",
    }));
}

function pickNextHostId(room) {
  for (const player of room.players.values()) {
    if (!player.isBot) return player.id;
  }
  return null;
}

function transferHost(room) {
  const nextId = pickNextHostId(room);
  if (!nextId) {
    room.hostId = null;
    return;
  }
  room.hostId = nextId;
  const host = room.players.get(nextId);
  if (host) host.ready = true;
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

function generateSecret(allowRepeat, digitCount) {
  if (allowRepeat) {
    return Array.from({ length: digitCount }, () => Math.floor(Math.random() * 10));
  }
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, digitCount);
}

function evaluateGuess(guess, secret) {
  const digitCount = secret.length;
  const exact = Array(digitCount).fill(false);
  const secretUsed = Array(digitCount).fill(false);
  const marks = Array(digitCount).fill("none");
  let blacks = 0;
  let whites = 0;

  for (let i = 0; i < digitCount; i += 1) {
    if (guess[i] === secret[i]) {
      exact[i] = true;
      secretUsed[i] = true;
      marks[i] = "black";
      blacks += 1;
    }
  }

  for (let i = 0; i < digitCount; i += 1) {
    if (exact[i]) continue;
    for (let j = 0; j < digitCount; j += 1) {
      if (!secretUsed[j] && guess[i] === secret[j]) {
        secretUsed[j] = true;
        marks[i] = "white";
        whites += 1;
        break;
      }
    }
  }

  const win = blacks === digitCount;
  if (win) {
    for (let i = 0; i < digitCount; i += 1) marks[i] = "star";
  }

  return {
    blacks,
    whites,
    win,
    none: blacks === 0 && whites === 0,
    marks,
  };
}

function enumerateCodes(allowRepeat, digitCount) {
  const codes = [];
  const walk = (prefix) => {
    if (prefix.length === digitCount) {
      codes.push([...prefix]);
      return;
    }
    for (let digit = 0; digit <= 9; digit += 1) {
      if (!allowRepeat && prefix.includes(digit)) continue;
      prefix.push(digit);
      walk(prefix);
      prefix.pop();
    }
  };
  walk([]);
  return codes;
}

function chooseBotGuess(history, allowRepeat, digitCount) {
  let candidates = enumerateCodes(allowRepeat, digitCount);
  for (const row of history) {
    candidates = candidates.filter((candidate) => {
      const result = evaluateGuess(row.guess, candidate);
      return result.blacks === row.blacks && result.whites === row.whites;
    });
  }
  if (!candidates.length) return generateSecret(allowRepeat, digitCount);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function assignBotGuess(player, room) {
  player.pending = {
    guess: chooseBotGuess(player.rows, room.allowRepeat, room.digitCount),
    fromBot: true,
  };
}

function makeSkippedRow(digitCount) {
  return {
    guess: Array(digitCount).fill(null),
    blacks: 0,
    whites: 0,
    win: false,
    none: true,
    skipped: true,
  };
}

function beginRoundClock(room) {
  room.roundEndsAt = Date.now() + room.secondsPerLine * 1000;
  for (const player of room.players.values()) {
    player.pending = null;
    if (player.isBot) assignBotGuess(player, room);
  }
}

function broadcastRoundState(room, type = "waiting") {
  broadcast(room, type, {
    round: room.currentRound + 1,
    players: publicPlayers(room),
    roundEndsAt: room.roundEndsAt,
    endsAt: room.roundEndsAt,
    secondsPerLine: room.secondsPerLine,
    difficulty: room.difficulty,
    digitCount: room.digitCount,
  });
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
      if (!player?.uid || player.isBot) continue;
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

  for (const player of room.players.values()) {
    send(player.ws, "ended", {
      reason,
      secret: room.secret,
      winners,
      papers: papers.filter((paper) => paper.id === player.id),
      allowRepeat: room.allowRepeat,
      roundLimit: room.roundLimit,
      difficulty: room.difficulty,
      digitCount: room.digitCount,
    });
  }
  broadcastRoomList();
}

function maybeTimeout(room) {
  if (room.status !== "playing" || !room.roundEndsAt) return;
  if (Date.now() < room.roundEndsAt) return;
  room.roundEndsAt = null;
  finishRound(room);
}

function finishRound(room) {
  if (room.status !== "playing") return;
  room.roundEndsAt = null;

  const results = [];
  const winners = [];

  for (const player of room.players.values()) {
    const pending = player.pending;
    if (!pending) {
      const skipped = makeSkippedRow(room.digitCount);
      player.rows.push(skipped);
      player.pending = null;
      results.push({ id: player.id, name: player.name, row: skipped });
      continue;
    }
    const result = evaluateGuess(pending.guess, room.secret);
    const row = {
      guess: pending.guess,
      ...result,
      fromBot: Boolean(pending.fromBot || player.isBot),
      skipped: false,
    };
    player.rows.push(row);
    player.pending = null;
    results.push({
      id: player.id,
      name: player.name,
      row,
    });
    if (result.win) {
      winners.push({
        id: player.id,
        name: player.name,
        uid: player.isBot ? null : player.uid || null,
        isBot: Boolean(player.isBot),
      });
    }
  }

  room.currentRound += 1;

  for (const player of room.players.values()) {
    if (player.isBot) continue;
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

  beginRoundClock(room);
  broadcastRoundState(room, "waiting");
  if ([...room.players.values()].every((item) => item.pending)) {
    finishRound(room);
  }
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
  const cfg = difficultyConfig(msg.difficulty);

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
    isBot: false,
    ready: true,
  };

  const room = {
    code,
    roomName,
    passwordHash: password ? hashPassword(password) : null,
    hostId: player.id,
    allowRepeat,
    roundLimit,
    difficulty: cfg.id,
    digitCount: cfg.digitCount,
    secondsPerLine: cfg.secondsPerLine,
    columnFeedback: cfg.columnFeedback,
    timeoutEnds: cfg.timeoutEnds,
    status: "lobby",
    secret: null,
    currentRound: 0,
    endsAt: null,
    roundEndsAt: null,
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
    secondsPerLine: room.secondsPerLine,
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
    isBot: false,
    ready: false,
  };
  room.players.set(player.id, player);
  ws.roomCode = code;
  ws.playerId = player.id;
  lobbyWatchers.delete(ws);

  send(ws, "joined", {
    you: { id: player.id, name: player.name, isHost: false, uid: player.uid },
    ...lobbyPayload(room),
    secondsPerLine: room.secondsPerLine,
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
  const notReady = [...room.players.values()].filter(
    (player) => !player.isBot && !player.ready && player.id !== room.hostId
  );
  if (notReady.length) {
    send(ws, "error", {
      message: `รอเพื่อนกดพร้อมก่อน: ${notReady.map((player) => player.name).join(", ")}`,
    });
    return;
  }

  room.status = "playing";
  room.secret = generateSecret(room.allowRepeat, room.digitCount);
  room.currentRound = 0;
  room.endsAt = null;

  for (const player of room.players.values()) {
    player.rows = [];
    player.pending = null;
  }

  beginRoundClock(room);
  clearRoomTimer(room);
  room.timer = setInterval(() => maybeTimeout(room), 250);

  broadcast(room, "started", {
    round: 1,
    roundLimit: room.roundLimit,
    allowRepeat: room.allowRepeat,
    difficulty: room.difficulty,
    digitCount: room.digitCount,
    roundEndsAt: room.roundEndsAt,
    endsAt: room.roundEndsAt,
    secondsPerLine: room.secondsPerLine,
    players: publicPlayers(room),
  });
  broadcastRoomList();

  if ([...room.players.values()].every((item) => item.pending)) {
    finishRound(room);
  }
}

function setPlayerReady(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.status !== "lobby") {
    send(ws, "error", { message: "พร้อมได้เฉพาะตอนรอในห้อง" });
    return;
  }
  const player = room.players.get(ws.playerId);
  if (!player) return;
  player.ready = msg.ready !== false;
  broadcast(room, "lobby", lobbyPayload(room));
}

function kickPlayer(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.status !== "lobby") {
    send(ws, "error", { message: "เตะได้เฉพาะตอนรอในห้อง" });
    return;
  }
  if (ws.playerId !== room.hostId) {
    send(ws, "error", { message: "เฉพาะเจ้าของห้องเตะได้" });
    return;
  }
  const targetId = String(msg.playerId || "");
  const target = room.players.get(targetId);
  if (!target) {
    send(ws, "error", { message: "ไม่พบผู้เล่นนี้" });
    return;
  }
  if (target.id === room.hostId) {
    send(ws, "error", { message: "เตะเจ้าของห้องไม่ได้" });
    return;
  }
  if (!target.isBot && target.ready) {
    send(ws, "error", { message: "เตะได้เฉพาะคนที่ยังไม่กดพร้อม หรือบอท" });
    return;
  }
  if (!target.isBot) {
    send(target.ws, "error", { message: "ถูกเตะออกจากห้องเพราะยังไม่กดพร้อม" });
    send(target.ws, "left", { reason: "kicked" });
    if (target.ws) {
      target.ws.roomCode = null;
      target.ws.playerId = null;
    }
  }
  removePlayerFromRoom(room, targetId);
  broadcastRoomList();
}

function addLobbyBot(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.status !== "lobby") {
    send(ws, "error", { message: "เพิ่มบอทได้เฉพาะตอนรอในห้อง" });
    return;
  }
  if (ws.playerId !== room.hostId) {
    send(ws, "error", { message: "เฉพาะเจ้าของห้องเพิ่มบอทได้" });
    return;
  }
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, "error", { message: `ห้องเต็มแล้ว (สูงสุด ${MAX_PLAYERS} ที่)` });
    return;
  }
  const botCount = [...room.players.values()].filter((player) => player.isBot).length;
  const bot = {
    id: cryptoRandomId(),
    uid: null,
    name: `บอท ${botCount + 1}`,
    photoURL: "",
    ws: null,
    rows: [],
    pending: null,
    isBot: true,
    ready: true,
  };
  room.players.set(bot.id, bot);
  broadcast(room, "lobby", lobbyPayload(room));
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
  if (!player || player.isBot) return;

  const expectedRound = room.currentRound + 1;
  const round = Number(msg.round);
  if (round !== expectedRound) {
    send(ws, "error", { message: "รอบไม่ตรงกับเซิร์ฟเวอร์" });
    return;
  }
  if (player.pending) {
    send(ws, "error", { message: "ส่งคำตอบรอบนี้แล้ว" });
    return;
  }

  const digits = Array.isArray(msg.digits) ? msg.digits.map(Number) : [];
  if (digits.length !== room.digitCount || digits.some((d) => !Number.isInteger(d) || d < 0 || d > 9)) {
    send(ws, "error", { message: `ต้องกรอกตัวเลข ${room.digitCount} หลัก` });
    return;
  }
  if (!room.allowRepeat && new Set(digits).size !== room.digitCount) {
    send(ws, "error", { message: "โหมดนี้ห้ามใช้เลขซ้ำ" });
    return;
  }

  player.pending = { guess: digits, fromBot: false };
  broadcastRoundState(room, "waiting");

  const instantWin = evaluateGuess(digits, room.secret).win;
  const allIn = [...room.players.values()].every((item) => item.pending);
  if (instantWin || allIn) finishRound(room);
}

function leaveCurrent(ws, { intentional = true } = {}) {
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
  const player = room.players.get(playerId);

  if (!intentional && player) {
    if (player.ws && player.ws !== ws) {
      ws.roomCode = null;
      ws.playerId = null;
      return;
    }

    // หลุดชั่วคราว (รีเฟรช/เน็ตสะดุด) · เก็บที่นั่งไว้ให้กลับเข้า
    player.ws = null;
    player.connected = false;
    player.disconnectAt = Date.now();
    const staleId = playerId;
    const staleCode = code;
    const graceMs = room.status === "lobby" ? 45_000 : 90_000;
    setTimeout(() => {
      const current = rooms.get(staleCode);
      if (!current) return;
      const stale = current.players.get(staleId);
      if (!stale || stale.ws || stale.isBot) return;
      removePlayerFromRoom(current, staleId);
    }, graceMs);
    ws.roomCode = null;
    ws.playerId = null;

    if (room.status === "lobby") {
      broadcast(room, "lobby", lobbyPayload(room));
      broadcastRoomList();
    } else if (room.status === "playing") {
      broadcastRoundState(room, "waiting");
      if ([...room.players.values()].every((item) => item.pending)) {
        finishRound(room);
      }
    }
    return;
  }

  removePlayerFromRoom(room, playerId);
  ws.roomCode = null;
  ws.playerId = null;
}

function removePlayerFromRoom(room, playerId) {
  if (!room.players.has(playerId)) return;
  room.players.delete(playerId);

  if (room.players.size === 0) {
    deleteRoomIfEmpty(room.code);
    return;
  }

  if (room.hostId === playerId) {
    transferHost(room);
  }

  if (room.status === "playing") {
    const remaining = [...room.players.values()];
    if (remaining.length < 2) {
      endGame(room, "abandoned", []);
      return;
    }
    broadcastRoundState(room, "waiting");
    if (remaining.every((item) => item.pending)) {
      finishRound(room);
    }
  } else if (room.status === "lobby") {
    broadcast(room, "lobby", lobbyPayload(room));
    broadcastRoomList();
  }
}

async function rejoinRoom(ws, msg) {
  const auth = await verifyAuthToken(msg.idToken);
  if (!auth) {
    send(ws, "error", { message: "ต้องล็อกอินก่อนกลับเข้าห้อง" });
    return;
  }

  const code = String(msg.code || "")
    .trim()
    .toUpperCase();
  const password = String(msg.password || "");
  if (!code) {
    send(ws, "error", { message: "ไม่พบรหัสห้องสำหรับกลับเข้า" });
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    send(ws, "error", { message: "ห้องนี้หมดอายุหรือปิดแล้ว" });
    return;
  }

  if (room.passwordHash && !verifyPassword(password, room.passwordHash)) {
    send(ws, "error", { message: "รหัสผ่านห้องไม่ถูกต้อง" });
    return;
  }

  let player = [...room.players.values()].find((item) => item.uid && item.uid === auth.uid);
  if (!player && msg.playerId) {
    const byId = room.players.get(String(msg.playerId));
    if (byId && !byId.isBot && (!byId.uid || byId.uid === auth.uid)) {
      player = byId;
    }
  }

  if (player && player.isBot) player = null;

  if (!player) {
    if (room.status === "lobby") {
      await joinRoom(ws, msg);
      return;
    }
    send(ws, "error", { message: "ไม่พบที่นั่งเดิมในห้องนี้" });
    return;
  }

  if (player.uid && player.uid !== auth.uid) {
    send(ws, "error", { message: "ไม่พบที่นั่งเดิมในห้องนี้" });
    return;
  }

  // อัปเดตชื่อ/uid ถ้ากลับเข้ามา
  if (auth.uid) player.uid = auth.uid;
  if (msg.name) player.name = String(msg.name).trim().slice(0, 20) || player.name;

  leaveCurrent(ws, { intentional: true });
  if (player.ws && player.ws !== ws) {
    const old = player.ws;
    old.roomCode = null;
    old.playerId = null;
    try {
      old.close();
    } catch {
      /* ignore */
    }
  }

  player.ws = ws;
  player.connected = true;
  player.disconnectAt = null;
  ws.roomCode = room.code;
  ws.playerId = player.id;
  lobbyWatchers.delete(ws);

  const base = {
    you: { id: player.id, name: player.name, isHost: player.id === room.hostId, uid: player.uid },
    ...lobbyPayload(room),
    secondsPerLine: room.secondsPerLine,
    rejoined: true,
  };

  if (room.status === "lobby") {
    send(ws, "joined", base);
    broadcast(room, "lobby", lobbyPayload(room));
    broadcastRoomList();
    return;
  }

  if (room.status === "playing") {
    send(ws, "rejoined", {
      ...base,
      status: "playing",
      round: room.currentRound + 1,
      roundLimit: room.roundLimit,
      allowRepeat: room.allowRepeat,
      difficulty: room.difficulty,
      digitCount: room.digitCount,
      roundEndsAt: room.roundEndsAt,
      endsAt: room.roundEndsAt,
      players: publicPlayers(room),
      yourRows: player.rows,
      pending: Boolean(player.pending),
    });
    broadcastRoundState(room, "waiting");
    return;
  }

  if (room.status === "ended") {
    send(ws, "ended", {
      reason: "ended",
      secret: room.secret,
      winners: [],
      papers: [{ id: player.id, name: player.name, rows: player.rows }],
      allowRepeat: room.allowRepeat,
      roundLimit: room.roundLimit,
      difficulty: room.difficulty,
      digitCount: room.digitCount,
    });
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
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      onlineCount: presenceClients.size,
      firebaseAdmin: Boolean(db),
    });
    return;
  }

  if (urlPath === "/api/online-count") {
    sendJson(res, 200, { onlineCount: presenceClients.size });
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
  presenceClients.add(ws);
  broadcastPresence();

  send(ws, "hello", {
    lanAddresses: getLanAddresses(),
    port: PORT,
    secondsPerLine: DEFAULT_SECONDS_PER_LINE,
    rooms: publicRoomList(),
    onlineCount: presenceClients.size,
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
          send(ws, "presence", { onlineCount: presenceClients.size });
          break;
        case "create":
          await createRoom(ws, msg);
          break;
        case "join":
          await joinRoom(ws, msg);
          break;
        case "ready":
          setPlayerReady(ws, msg);
          break;
        case "kick":
          kickPlayer(ws, msg);
          break;
        case "addBot":
          addLobbyBot(ws);
          break;
        case "start":
          startGame(ws);
          break;
        case "submit":
          submitGuess(ws, msg);
          break;
        case "leave":
          leaveCurrent(ws, { intentional: true });
          send(ws, "left", {});
          broadcastRoomList();
          break;
        case "rejoin":
          await rejoinRoom(ws, msg);
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
    presenceClients.delete(ws);
    leaveCurrent(ws, { intentional: false });
    broadcastRoomList();
    broadcastPresence();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const lans = getLanAddresses();
  console.log(`เกมท้ายตัวเลขพร้อมที่ http://localhost:${PORT}`);
  for (const ip of lans) {
    console.log(`  LAN: http://${ip}:${PORT}`);
  }
});
