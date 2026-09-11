const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const DIGIT_COUNT = 4;
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 30;
const SECONDS_PER_LINE = 120;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
    isHost: player.id === room.hostId,
    submitted: Boolean(player.pending),
  }));
}

function lobbyPayload(room) {
  return {
    code: room.code,
    allowRepeat: room.allowRepeat,
    roundLimit: room.roundLimit,
    status: room.status,
    players: publicPlayers(room),
    hostId: room.hostId,
  };
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
  }
}

function endGame(room, reason, winners = []) {
  if (room.status === "ended") return;
  room.status = "ended";
  clearRoomTimer(room);

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
    if (result.win) winners.push({ id: player.id, name: player.name });
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

function createRoom(ws, msg) {
  const name = String(msg.name || "").trim().slice(0, 20);
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
    name,
    ws,
    rows: [],
    pending: null,
  };

  const room = {
    code,
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

  send(ws, "joined", {
    you: { id: player.id, name: player.name, isHost: true },
    ...lobbyPayload(room),
    secondsPerLine: SECONDS_PER_LINE,
  });
  broadcast(room, "lobby", lobbyPayload(room));
}

function joinRoom(ws, msg) {
  const name = String(msg.name || "").trim().slice(0, 20);
  const code = String(msg.code || "")
    .trim()
    .toUpperCase();

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
  if ([...room.players.values()].some((player) => player.name === name)) {
    send(ws, "error", { message: "ชื่อนี้มีในห้องแล้ว" });
    return;
  }

  leaveCurrent(ws);

  const player = {
    id: cryptoRandomId(),
    name,
    ws,
    rows: [],
    pending: null,
  };
  room.players.set(player.id, player);
  ws.roomCode = code;
  ws.playerId = player.id;

  send(ws, "joined", {
    you: { id: player.id, name: player.name, isHost: false },
    ...lobbyPayload(room),
    secondsPerLine: SECONDS_PER_LINE,
  });
  broadcast(room, "lobby", lobbyPayload(room));
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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
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
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, "error", { message: "ข้อความไม่ถูกต้อง" });
      return;
    }

    try {
      switch (msg.type) {
        case "create":
          createRoom(ws, msg);
          break;
        case "join":
          joinRoom(ws, msg);
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
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const lans = getLanAddresses();
  console.log(`เกมท้ายตัวเลขพร้อมที่ http://localhost:${PORT}`);
  for (const ip of lans) {
    console.log(`  LAN: http://${ip}:${PORT}`);
  }
});
