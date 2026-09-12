(() => {
  const MAX_PLAYERS = 8;
  const MAX_ROUNDS = 30;
  const DEFAULT_SECONDS_PER_LINE = 120;

  const DIFFICULTY = {
    easy: {
      id: "easy",
      label: "ง่าย",
      digitCount: 4,
      secondsPerLine: 120,
      columnFeedback: true,
      timeoutEnds: false,
      hint: "ง่าย · เลข 4 หลัก · สัญลักษณ์ตรงคอลัมน์ตัวเลข",
    },
    normal: {
      id: "normal",
      label: "ปกติ",
      digitCount: 4,
      secondsPerLine: 120,
      columnFeedback: false,
      timeoutEnds: false,
      hint: "ปกติ · เลข 4 หลัก · สัญลักษณ์รวมด้านขวา",
    },
    hard: {
      id: "hard",
      label: "ยาก",
      digitCount: 5,
      secondsPerLine: 120,
      columnFeedback: false,
      timeoutEnds: false,
      hint: "ยาก · เลข 5 หลัก",
    },
    extreme: {
      id: "extreme",
      label: "ยากมาก",
      digitCount: 5,
      secondsPerLine: 30,
      columnFeedback: false,
      timeoutEnds: true,
      hint: "ยากมาก · เลข 5 หลัก · ตอบใน 30 วินาที/รอบ",
    },
  };

  function difficultyConfig(id) {
    return DIFFICULTY[id] || DIFFICULTY.normal;
  }

  const screens = {
    login: document.getElementById("screen-login"),
    setup: document.getElementById("screen-setup"),
    lobby: document.getElementById("screen-lobby"),
    gate: document.getElementById("screen-gate"),
    play: document.getElementById("screen-play"),
    result: document.getElementById("screen-result"),
  };

  const els = {
    loginStatus: document.getElementById("login-status"),
    loginError: document.getElementById("login-error"),
    loginActions: document.getElementById("login-actions"),
    demoLogin: document.getElementById("demo-login"),
    demoNameInput: document.getElementById("demo-name-input"),
    userAvatar: document.getElementById("user-avatar"),
    userName: document.getElementById("user-name"),
    leaderboardLabel: document.getElementById("leaderboard-label"),
    leaderboardList: document.getElementById("leaderboard-list"),
    playerList: document.getElementById("player-list"),
    playersField: document.getElementById("players-field"),
    onlineField: document.getElementById("online-field"),
    roomList: document.getElementById("room-list"),
    onlineNameInput: document.getElementById("online-name-input"),
    onlineHint: document.getElementById("online-hint"),
    roomTitleInput: document.getElementById("room-title-input"),
    roomPasswordInput: document.getElementById("room-password-input"),
    joinPasswordInput: document.getElementById("join-password-input"),
    playerNameInput: document.getElementById("player-name-input"),
    roomCodeInput: document.getElementById("room-code-input"),
    addPlayerBtn: document.getElementById("add-player-btn"),
    roundsField: document.getElementById("rounds-field"),
    roundsLabel: document.getElementById("rounds-label"),
    limitChoices: document.getElementById("limit-choices"),
    roundsRow: document.getElementById("rounds-row"),
    roundsInput: document.getElementById("rounds-input"),
    roundsInputLabel: document.getElementById("rounds-input-label"),
    roundsSuffix: document.getElementById("rounds-suffix"),
    timePreview: document.getElementById("time-preview"),
    repeatField: document.getElementById("repeat-field"),
    setupError: document.getElementById("setup-error"),
    startBtn: document.getElementById("start-btn"),
    lobbyTitle: document.getElementById("lobby-title"),
    lobbyCode: document.getElementById("lobby-code"),
    lobbySettings: document.getElementById("lobby-settings"),
    lobbyPlayers: document.getElementById("lobby-players"),
    lobbyError: document.getElementById("lobby-error"),
    lobbyStartBtn: document.getElementById("lobby-start-btn"),
    lobbyAddBotBtn: document.getElementById("lobby-add-bot-btn"),
    lobbyLeaveBtn: document.getElementById("lobby-leave-btn"),
    shareCopyBtn: document.getElementById("share-copy-btn"),
    shareLineBtn: document.getElementById("share-line-btn"),
    shareFbBtn: document.getElementById("share-fb-btn"),
    shareNativeBtn: document.getElementById("share-native-btn"),
    gateKicker: document.getElementById("gate-kicker"),
    gateName: document.getElementById("gate-name"),
    gateNote: document.getElementById("gate-note"),
    readyBtn: document.getElementById("ready-btn"),
    paperBody: document.getElementById("paper-body"),
    paperOwner: document.getElementById("paper-owner"),
    paperSecret: document.getElementById("paper-secret"),
    playStatus: document.getElementById("play-status"),
    waitFriends: document.getElementById("wait-friends"),
    botStatus: document.getElementById("bot-status"),
    playError: document.getElementById("play-error"),
    gameTimer: document.getElementById("game-timer"),
    keypad: document.getElementById("keypad"),
    afterTurn: document.getElementById("after-turn"),
    nextBtn: document.getElementById("next-btn"),
    reviewBar: document.getElementById("review-bar"),
    reviewPlayers: document.getElementById("review-players"),
    resultKicker: document.getElementById("result-kicker"),
    resultTitle: document.getElementById("result-title"),
    resultSecret: document.getElementById("result-secret"),
    resultDetail: document.getElementById("result-detail"),
    difficultyHint: null,
    setupTagline: document.getElementById("setup-tagline"),
    onlineBadge: document.getElementById("online-badge"),
    onlineCount: document.getElementById("online-count"),
  };

  const setup = {
    mode: "solo",
    difficulty: "normal",
    allowRepeat: false,
    limitRounds: false,
    names: [],
  };

  let game = null;
  let shuffleTimer = null;
  let gameToken = 0;
  let timerTick = null;
  let socket = null;
  let socketPromise = null;
  let roomCatalog = [];
  let handoffTimer = null;
  let handoffEndsAt = null;

  let online = {
    you: null,
    code: null,
    roomName: "",
    hostId: null,
    players: [],
    endsAt: null,
    round: 1,
    waiting: false,
    papers: null,
    secondsPerLine: DEFAULT_SECONDS_PER_LINE,
    lanAddresses: [],
    port: null,
    difficulty: "normal",
    password: "",
    reconnecting: false,
  };

  const ROOM_SESSION_KEY = "tualek-room-session";
  const SETUP_SESSION_KEY = "tualek-setup-session";

  function saveRoomSession(extra = {}) {
    if (!online.code) return;
    try {
      localStorage.setItem(
        ROOM_SESSION_KEY,
        JSON.stringify({
          code: online.code,
          playerId: online.you?.id || null,
          name: online.you?.name || els.onlineNameInput?.value || "ผู้เล่น",
          password: online.password || "",
          difficulty: online.difficulty || "normal",
          savedAt: Date.now(),
          ...extra,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function clearRoomSession() {
    try {
      localStorage.removeItem(ROOM_SESSION_KEY);
      sessionStorage.removeItem(ROOM_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  function readRoomSession() {
    try {
      const raw = localStorage.getItem(ROOM_SESSION_KEY) || sessionStorage.getItem(ROOM_SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // เก่าเกิน 6 ชม. ไม่ใช้
      if (data.savedAt && Date.now() - data.savedAt > 6 * 60 * 60 * 1000) {
        clearRoomSession();
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function saveSetupSession() {
    try {
      localStorage.setItem(
        SETUP_SESSION_KEY,
        JSON.stringify({
          mode: setup.mode,
          difficulty: setup.difficulty,
          allowRepeat: setup.allowRepeat,
          limitRounds: setup.limitRounds,
          names: setup.names,
          rounds: els.roundsInput?.value || "10",
          onlineName: els.onlineNameInput?.value || "",
          roomTitle: els.roomTitleInput?.value || "",
          roomCode: els.roomCodeInput?.value || "",
          savedAt: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreSetupSession() {
    try {
      const raw = localStorage.getItem(SETUP_SESSION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;

      if (data.mode) {
        setup.mode = data.mode;
        setChoiceGroup("[data-mode]", "mode", setup.mode);
      }
      if (data.difficulty) {
        setup.difficulty = data.difficulty;
        setChoiceGroup("[data-difficulty]", "difficulty", setup.difficulty);
      }
      if (typeof data.allowRepeat === "boolean") {
        setup.allowRepeat = data.allowRepeat;
        setChoiceGroup("[data-repeat]", "repeat", data.allowRepeat ? "yes" : "no");
      }
      if (typeof data.limitRounds === "boolean") {
        setup.limitRounds = data.limitRounds;
        setChoiceGroup("[data-limit]", "limit", data.limitRounds ? "yes" : "no");
      }
      if (Array.isArray(data.names)) {
        setup.names = data.names.filter((name) => typeof name === "string").slice(0, MAX_PLAYERS);
        renderPlayerList();
      }
      if (els.roundsInput && data.rounds) els.roundsInput.value = data.rounds;
      if (els.onlineNameInput && data.onlineName) els.onlineNameInput.value = data.onlineName;
      if (els.roomTitleInput && data.roomTitle) els.roomTitleInput.value = data.roomTitle;
      if (els.roomCodeInput && data.roomCode) els.roomCodeInput.value = data.roomCode;
    } catch {
      /* ignore */
    }
  }

  let rejoinAttempts = 0;

  async function attemptAutoRejoin() {
    const session = readRoomSession();
    if (!session?.code || online.reconnecting) return;
    if (rejoinAttempts >= 10) return;
    online.reconnecting = true;
    rejoinAttempts += 1;
    try {
      await ensureSocket({ skipAutoRejoin: true });
      const idToken = await window.TualekAuth.getIdToken();
      online.password = session.password || "";
      sendSocket({
        type: "rejoin",
        idToken,
        code: session.code,
        name: session.name,
        password: session.password || "",
        playerId: session.playerId || null,
      });
    } catch (error) {
      console.error(error);
      online.reconnecting = false;
      showPlayError(error.message || "เชื่อมต่อกลับไม่สำเร็จ");
    }
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => {
      if (node) node.hidden = key !== name;
    });
    if (els.onlineBadge) {
      els.onlineBadge.hidden = name !== "setup" && name !== "login";
    }
  }

  function showSetupError(message) {
    els.setupError.hidden = !message;
    els.setupError.textContent = message || "";
  }

  function showLobbyError(message) {
    els.lobbyError.hidden = !message;
    els.lobbyError.textContent = message || "";
  }

  function showPlayError(message) {
    els.playError.hidden = !message;
    els.playError.textContent = message || "";
  }

  function showLoginError(message) {
    els.loginError.hidden = !message;
    els.loginError.textContent = message || "";
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function currentUser() {
    return window.TualekAuth?.state?.user || null;
  }

  function digitCount() {
    return game?.digitCount || difficultyConfig(setup.difficulty).digitCount;
  }

  function generateSecret(allowRepeat, count = digitCount()) {
    if (allowRepeat) {
      return Array.from({ length: count }, () => Math.floor(Math.random() * 10));
    }
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  function evaluateGuess(guess, secret) {
    const count = secret.length;
    const exact = Array(count).fill(false);
    const secretUsed = Array(count).fill(false);
    const marks = Array(count).fill("none");
    let blacks = 0;
    let whites = 0;

    for (let i = 0; i < count; i += 1) {
      if (guess[i] === secret[i]) {
        exact[i] = true;
        secretUsed[i] = true;
        marks[i] = "black";
        blacks += 1;
      }
    }

    for (let i = 0; i < count; i += 1) {
      if (exact[i]) continue;
      for (let j = 0; j < count; j += 1) {
        if (!secretUsed[j] && guess[i] === secret[j]) {
          secretUsed[j] = true;
          marks[i] = "white";
          whites += 1;
          break;
        }
      }
    }

    const win = blacks === count;
    if (win) {
      for (let i = 0; i < count; i += 1) marks[i] = "star";
    }

    return {
      blacks,
      whites,
      win,
      none: blacks === 0 && whites === 0,
      marks,
    };
  }

  function markIcon(kind) {
    if (kind === "star") return '<span class="mark-star">★</span>';
    if (kind === "black") return '<span class="peg black"></span>';
    if (kind === "white") return '<span class="peg white"></span>';
    return '<span class="peg none"></span>';
  }

  function feedbackMarkup(row, easy = false) {
    if (row?.skipped) {
      return `<span class="feedback-pegs feedback-skipped">ว่าง</span>`;
    }
    const count = row.guess?.length || digitCount();
    if (easy && Array.isArray(row.marks)) {
      return `<span class="feedback-pegs">${row.marks.map((kind) => markIcon(kind)).join("")}</span>`;
    }
    if (row.win) {
      return `<span class="feedback-pegs">${'<span class="mark-star">★</span>'.repeat(count)}</span>`;
    }
    if (row.none) return `<span class="feedback-pegs"><span class="peg none"></span></span>`;
    const parts = [];
    for (let i = 0; i < row.blacks; i += 1) parts.push('<span class="peg black"></span>');
    for (let i = 0; i < row.whites; i += 1) parts.push('<span class="peg white"></span>');
    return `<span class="feedback-pegs">${parts.join("")}</span>`;
  }

  function currentPlayer() {
    return game.players[game.currentIndex];
  }

  function remainingRounds(player) {
    if (!game.roundLimit) return null;
    return game.roundLimit - player.rows.length;
  }

  function playerHasRounds(player) {
    return !game.roundLimit || player.rows.length < game.roundLimit;
  }

  function nextPlayerIndex(fromIndex) {
    const total = game.players.length;
    for (let step = 1; step <= total; step += 1) {
      const idx = (fromIndex + step) % total;
      if (playerHasRounds(game.players[idx])) return idx;
    }
    return null;
  }

  function emptyDraft() {
    return Array(digitCount()).fill(null);
  }

  function formatDuration(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function difficultyLabel(id) {
    return difficultyConfig(id).label;
  }

  function updateDifficultyUi() {
    const cfg = difficultyConfig(setup.difficulty);
    if (els.setupTagline) {
      els.setupTagline.innerHTML = `ทายเลข ${cfg.digitCount} หลักให้ถูกก่อนเพื่อน<br />สนุกได้ทั้งเล่นคนเดียวและแข่งทีม`;
    }
    updateTimePreview();
  }

  function modeLabel(mode) {
    if (mode === "multi") return "ส่งเครื่อง";
    if (mode === "online") return "คนละเครื่อง";
    return "คนเดียว";
  }

  function formatRoomSettings(room) {
    const bits = [
      difficultyLabel(room.difficulty),
      `${room.digitCount || 4} หลัก`,
      room.allowRepeat ? "ซ้ำได้" : "ไม่ซ้ำ",
      `${room.roundLimit} บรรทัด`,
      `รอบละ ${room.secondsPerLine || DEFAULT_SECONDS_PER_LINE} วิ`,
    ];
    if (room.hasPassword) bits.unshift("มีรหัสผ่าน");
    return bits.join(" · ");
  }

  function updateTimePreview() {
    if (setup.mode !== "online") {
      els.timePreview.hidden = true;
      return;
    }
    const cfg = difficultyConfig(setup.difficulty);
    els.timePreview.hidden = false;
    els.timePreview.textContent = `แต่ละบรรทัด ${cfg.secondsPerLine === 120 ? "2 นาที" : `${cfg.secondsPerLine} วินาที`} · ไม่ส่งทัน = แถวว่าง ไปรอบถัดไป`;
  }

  function updateSetupVisibility() {
    const isMulti = setup.mode === "multi";
    const isOnline = setup.mode === "online";

    els.playersField.hidden = !isMulti;
    els.onlineField.hidden = !isOnline;
    els.repeatField.hidden = false;
    els.limitChoices.hidden = false;
    els.roundsRow.hidden = !setup.limitRounds;
    els.roundsLabel.textContent = "จำกัดจำนวนรอบไหม";
    els.roundsInputLabel.textContent = "กี่รอบ";
    els.roundsSuffix.textContent = isOnline ? "บรรทัด" : "รอบต่อคน";

    if (isOnline) {
      els.startBtn.textContent = "เข้าห้อง / สร้างห้อง";
      updateTimePreview();
      ensureSocket()
        .then(() => sendSocket({ type: "watchRooms" }))
        .catch(() => {});
    } else {
      els.timePreview.hidden = true;
      els.startBtn.textContent = "เริ่มเกม";
    }

    if (els.leaderboardLabel) {
      els.leaderboardLabel.textContent = "อันดับชนะ";
    }
    refreshLeaderboard();
  }

  function setOnlineCount(count) {
    if (!els.onlineCount) return;
    const n = Math.max(0, Number(count) || 0);
    els.onlineCount.textContent = String(n);
  }

  async function refreshOnlineCount() {
    try {
      const res = await fetch("/api/online-count");
      if (!res.ok) return;
      const data = await res.json();
      setOnlineCount(data.onlineCount);
    } catch {
      /* ignore */
    }
  }

  function renderPlayerList() {
    if (!setup.names.length) {
      els.playerList.innerHTML = `<li class="empty-players">ยังไม่มีชื่อ · เพิ่มอย่างน้อย 2 คน</li>`;
      return;
    }
    els.playerList.innerHTML = setup.names
      .map(
        (name, index) => `
        <li class="player-item">
          <span>${escapeHtml(name)}</span>
          <button type="button" class="remove-player" data-remove="${index}">ลบ</button>
        </li>`
      )
      .join("");
  }

  function renderRoomList() {
    if (!roomCatalog.length) {
      els.roomList.innerHTML = `<li class="empty-players">ยังไม่มีห้อง · สร้างห้องใหม่ได้ด้านล่าง</li>`;
      return;
    }
    els.roomList.innerHTML = roomCatalog
      .map(
        (room) => `
        <li class="room-item">
          <div class="room-main">
            <strong>${escapeHtml(room.roomName || "ห้อง")}</strong>
            <span class="room-meta">รหัส ${escapeHtml(room.code)} · ${escapeHtml(formatRoomSettings(room))} · ${room.playerCount}/${room.maxPlayers || MAX_PLAYERS} คน</span>
          </div>
          <button type="button" class="btn btn-ink room-join-btn" data-join-code="${escapeHtml(room.code)}" data-locked="${room.hasPassword ? "1" : "0"}">เข้า</button>
        </li>`
      )
      .join("");
  }

  function setChoiceGroup(selector, key, value) {
    document.querySelectorAll(selector).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[key] === value));
    });
  }

  function addPlayerName() {
    const name = els.playerNameInput.value.trim();
    showSetupError("");
    if (!name) {
      showSetupError("พิมพ์ชื่อก่อนแล้วค่อยเพิ่ม");
      return;
    }
    if (setup.names.length >= MAX_PLAYERS) {
      showSetupError(`เพิ่มได้สูงสุด ${MAX_PLAYERS} คน`);
      return;
    }
    if (setup.names.some((item) => item === name)) {
      showSetupError("ชื่อนี้มีแล้ว");
      return;
    }
    setup.names.push(name);
    els.playerNameInput.value = "";
    renderPlayerList();
    els.playerNameInput.focus();
  }

  async function refreshLeaderboard() {
    try {
      const rows = await window.TualekAuth.fetchLeaderboard("online");
      if (!rows.length) {
        els.leaderboardList.innerHTML = `<li class="empty-players">ยังไม่มีสถิติในโหมดนี้</li>`;
        return;
      }
      els.leaderboardList.innerHTML = rows
        .map(
          (row) => `
          <li class="leaderboard-item">
            <span class="lb-rank">#${row.rank}</span>
            <span class="lb-name">${escapeHtml(row.name)}</span>
            <span class="lb-wins">${row.wins} ชนะ</span>
          </li>`
        )
        .join("");
    } catch {
      els.leaderboardList.innerHTML = `<li class="empty-players">โหลดสถิติไม่สำเร็จ</li>`;
    }
  }

  async function recordLocalWin(mode) {
    const user = currentUser();
    if (!user) return;
    try {
      const idToken = await window.TualekAuth.getIdToken();
      await fetch("/api/record-win", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          mode,
          displayName: user.displayName || "ผู้เล่น",
          photoURL: user.photoURL || "",
        }),
      });
      refreshLeaderboard();
    } catch (error) {
      console.error(error);
    }
  }

  function collectSettings() {
    if (setup.mode === "online") {
      const typedName = (els.onlineNameInput?.value || "").trim().slice(0, 20);
      const name = typedName || (currentUser()?.displayName || "ผู้เล่น").slice(0, 20);
      const code = els.roomCodeInput.value.trim().toUpperCase();
      const roomName = els.roomTitleInput.value.trim().slice(0, 24);
      const password = els.roomPasswordInput.value;
      const joinPassword = els.joinPasswordInput.value;

      let roundLimit = MAX_ROUNDS;
      if (setup.limitRounds) {
        const rounds = Number(els.roundsInput.value);
        if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
          return { error: `จำนวนรอบต้องเป็นเลข 1–${MAX_ROUNDS}` };
        }
        roundLimit = rounds;
      }

      if (!name) {
        return { error: "กรุณาใส่ชื่อของคุณในห้อง" };
      }

      if (code) {
        return {
          mode: "online",
          action: "join",
          name,
          code,
          password: joinPassword,
          roundLimit,
          allowRepeat: setup.allowRepeat,
          difficulty: setup.difficulty,
        };
      }

      return {
        mode: "online",
        action: "create",
        name,
        roomName: roomName || `${name} ห้อง`,
        password,
        allowRepeat: setup.allowRepeat,
        roundLimit,
        difficulty: setup.difficulty,
      };
    }

    const user = currentUser();
    const names =
      setup.mode === "solo"
        ? [user?.displayName || "ผู้เล่น"]
        : setup.names.map((name) => name.trim()).filter(Boolean);

    if (setup.mode === "multi" && names.length < 2) {
      return { error: "แข่งกับเพื่อนต้องมีอย่างน้อย 2 คน" };
    }

    let roundLimit = null;
    if (setup.limitRounds) {
      const rounds = Number(els.roundsInput.value);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
        return { error: `จำนวนรอบต้องเป็นเลข 1–${MAX_ROUNDS}` };
      }
      roundLimit = rounds;
    }

    return {
      mode: setup.mode,
      difficulty: setup.difficulty,
      allowRepeat: setup.allowRepeat,
      roundLimit,
      names,
    };
  }

  function createGame(settings, secret) {
    const cfg = difficultyConfig(settings.difficulty || "normal");
    return {
      mode: settings.mode,
      difficulty: cfg.id,
      digitCount: cfg.digitCount,
      columnFeedback: cfg.columnFeedback,
      timeoutEnds: cfg.timeoutEnds,
      secondsPerLine: cfg.secondsPerLine,
      allowRepeat: settings.allowRepeat,
      roundLimit: settings.roundLimit,
      secret: secret || generateSecret(settings.allowRepeat, cfg.digitCount),
      players: settings.names.map((name) => ({ name, rows: [] })),
      currentIndex: 0,
      draft: Array(cfg.digitCount).fill(null),
      caret: 0,
      phase: "playing",
      winnerIndex: null,
      reviewing: false,
      reviewIndex: 0,
    };
  }

  function paperRowCount(player) {
    if (game.roundLimit) return game.roundLimit;
    return Math.max(player.rows.length + 1, 8);
  }

  function renderPaper(player, interactive) {
    const rowCount = paperRowCount(player);
    const count = game.digitCount;
    const easy = game.columnFeedback;
    const rows = [];
    const paper = document.querySelector(".paper");
    if (paper) {
      paper.classList.remove("paper-easy", "digits-4", "digits-5");
      paper.classList.add(`digits-${count}`);
    }
    const headCell = document.querySelector(".paper thead th");
    if (headCell) headCell.colSpan = 1 + count + 1;

    for (let i = 0; i < rowCount; i += 1) {
      const filled = player.rows[i];
      const isDraftRow = interactive && i === player.rows.length && game.phase === "playing";
      const isPendingRow =
        game.mode === "online" && online.waiting && i === player.rows.length && !filled;
      const digits = filled
        ? filled.skipped
          ? Array(count).fill(null)
          : filled.guess
        : isDraftRow || isPendingRow
          ? game.draft
          : Array(count).fill(null);
      const feedback = filled
        ? feedbackMarkup(filled, easy)
        : isPendingRow
          ? "รอ…"
          : "";
      const feedbackClass = filled?.win ? "feedback win" : filled?.skipped ? "feedback skipped" : "feedback";

      const digitCells = digits
        .map((digit, digitIndex) => {
          const active = isDraftRow && game.caret === digitIndex ? " cell-active" : "";
          const value = digit === null ? "" : String(digit);
          return `<td class="digit${active}"${isDraftRow ? ` data-draft-cell="${digitIndex}"` : ""}>${value}</td>`;
        })
        .join("");

      rows.push(`
        <tr>
          <td class="idx">${i + 1}</td>
          ${digitCells}
          <td class="${feedbackClass}">${feedback}</td>
        </tr>`);
    }

    els.paperBody.innerHTML = rows.join("");
    if (game.mode === "multi" || game.mode === "online") {
      els.paperOwner.textContent = `กระดาษของ ${player.name}`;
    } else {
      els.paperOwner.textContent = "";
    }

    const revealSecret =
      Array.isArray(game.secret) &&
      game.secret.length === count &&
      (game.phase === "over" || game.reviewing);
    if (revealSecret) {
      els.paperSecret.hidden = false;
      els.paperSecret.innerHTML = `เฉลย <span class="paper-secret-digits">${game.secret
        .map((digit) => `<span class="paper-secret-digit">${digit}</span>`)
        .join("")}</span>`;
    } else {
      els.paperSecret.hidden = true;
      els.paperSecret.textContent = "";
    }
  }

  function updateKeypadState() {
    document.querySelectorAll(".key[data-digit]").forEach((btn) => {
      const digit = Number(btn.dataset.digit);
      const alreadyUsed = game.draft.some((value, index) => value === digit && index !== game.caret);
      btn.disabled = !game.allowRepeat && alreadyUsed;
    });
  }

  function stopGameTimer() {
    if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    }
    els.gameTimer.hidden = true;
  }

  function startGameTimer(endsAt, onExpire = null) {
    stopGameTimer();
    if (!endsAt) return;
    online.endsAt = endsAt;
    els.gameTimer.hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      els.gameTimer.textContent = `เหลือเวลาตอบ ${formatDuration(left)}`;
      if (left <= 30) els.gameTimer.classList.add("urgent");
      else els.gameTimer.classList.remove("urgent");
      if (left <= 0) {
        stopGameTimer();
        if (typeof onExpire === "function") onExpire();
      }
    };
    tick();
    timerTick = setInterval(tick, 250);
  }

  function startLocalRoundTimer() {
    if (!game || !game.timeoutEnds || game.mode === "online") return;
    if (game.phase !== "playing" || game.reviewing) return;
    startGameTimer(Date.now() + game.secondsPerLine * 1000, () => {
      if (!game || game.phase !== "playing" || game.mode === "online") return;
      const player = currentPlayer();
      const count = digitCount();
      player.rows.push({
        guess: Array(count).fill(null),
        blacks: 0,
        whites: 0,
        win: false,
        none: true,
        skipped: true,
      });
      game.draft = emptyDraft();
      game.caret = 0;
      if (game.mode === "solo") {
        if (!playerHasRounds(player)) {
          game.phase = "over";
          renderPlay();
          window.setTimeout(() => showResult(), 450);
          return;
        }
        renderPlay();
        startLocalRoundTimer();
        return;
      }
      game.phase = "waiting-next";
      renderPlay();
      const nxt = nextPlayerIndex(game.currentIndex);
      if (nxt === null) {
        game.phase = "over";
        els.afterTurn.hidden = true;
        window.setTimeout(() => showResult(), 450);
        return;
      }
      els.afterTurn.hidden = false;
      startHandoffCountdown();
    });
  }

  function meOnlineState(players) {
    if (!online.you || !players) return null;
    return players.find((player) => player.id === online.you.id) || null;
  }

  function renderBotStatus() {
    if (els.botStatus) els.botStatus.hidden = true;
  }

  function renderWaitFriends(players) {
    const me = meOnlineState(players);
    if (!players || !online.waiting || me?.submitted) {
      // ซ่อนข้อความรอเพื่อน / รอหมดเวลา
      els.waitFriends.hidden = true;
      return;
    }
    els.waitFriends.hidden = true;
  }

  function signalHumanActivity() {
    /* no substitute-bot resume */
  }

  function renderPlay() {
    const player = game.reviewing ? game.players[game.reviewIndex] : currentPlayer();
    const me = meOnlineState(online.players);
    const interactive =
      !game.reviewing && game.phase === "playing" && !online.waiting;
    renderPaper(player, interactive);

    if (game.reviewing) {
      els.keypad.hidden = true;
      els.afterTurn.hidden = true;
      els.reviewBar.hidden = false;
      els.waitFriends.hidden = true;
      if (els.botStatus) els.botStatus.hidden = true;
      document.getElementById("quit-btn").hidden = true;
      els.playStatus.textContent = "จบเกมแล้ว · ดูกระดาษของตัวเอง";
      showPlayError("");
      return;
    }

    document.getElementById("quit-btn").hidden = false;
    els.reviewBar.hidden = true;
    els.keypad.hidden = game.phase !== "playing" || online.waiting;
    els.afterTurn.hidden = game.phase !== "waiting-next";

    if (game.phase === "playing") {
      const left = remainingRounds(player);
      const repeatText = game.allowRepeat ? "ซ้ำได้" : "ไม่ซ้ำ";
      if (game.mode === "online") {
        const leftText = left === null ? "" : ` · เหลือ ${left} บรรทัด`;
        els.playStatus.textContent = `${repeatText} · บรรทัดที่ ${online.round}/${game.roundLimit}${leftText}`;
      } else {
        const soloRound = game.roundLimit ? `จำกัด ${game.roundLimit} รอบ` : "ไม่จำกัดรอบ";
        const soloLeft = left === null ? "" : ` · เหลือ ${left} รอบ`;
        els.playStatus.textContent = `${repeatText} · ${soloRound}${soloLeft}`;
      }
      updateKeypadState();
    }

    if (game.mode === "online") {
      renderWaitFriends(online.players);
      renderBotStatus();
    } else {
      els.waitFriends.hidden = true;
      if (els.botStatus) els.botStatus.hidden = true;
    }
  }

  function placeDigit(digit) {
    signalHumanActivity();
    if (!game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    showPlayError("");
    if (!game.allowRepeat) {
      const duplicate = game.draft.some((value, index) => value === digit && index !== game.caret);
      if (duplicate) {
        showPlayError("โหมดนี้ห้ามใช้เลขซ้ำ");
        return;
      }
    }
    game.draft[game.caret] = digit;
    const nextEmpty = game.draft.findIndex((value, index) => index > game.caret && value === null);
    if (nextEmpty !== -1) game.caret = nextEmpty;
    else if (game.caret < digitCount() - 1) game.caret += 1;
    renderPlay();
  }

  function backspace() {
    signalHumanActivity();
    if (!game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    showPlayError("");
    if (game.draft[game.caret] !== null) game.draft[game.caret] = null;
    else if (game.caret > 0) {
      game.caret -= 1;
      game.draft[game.caret] = null;
    }
    renderPlay();
  }

  function submitGuess() {
    signalHumanActivity();
    if (!game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    showPlayError("");
    if (game.draft.some((digit) => digit === null)) {
      showPlayError(`ต้องกรอกตัวเลข ${digitCount()} หลักทุกครั้ง`);
      return;
    }
    if (!game.allowRepeat && new Set(game.draft).size !== digitCount()) {
      showPlayError("โหมดนี้ห้ามใช้เลขซ้ำ");
      return;
    }

    if (game.mode === "online") {
      online.waiting = true;
      renderPlay();
      sendSocket({ type: "submit", round: online.round, digits: [...game.draft] });
      return;
    }

    stopGameTimer();
    const player = currentPlayer();
    const result = evaluateGuess(game.draft, game.secret);
    player.rows.push({ guess: [...game.draft], ...result });
    game.draft = emptyDraft();
    game.caret = 0;

    if (result.win) {
      game.winnerIndex = game.currentIndex;
      game.phase = "over";
      renderPlay();
      if (game.mode === "solo") recordLocalWin("solo");
      if (game.mode === "multi") {
        const winnerName = game.players[game.winnerIndex]?.name;
        if (winnerName && winnerName === (currentUser()?.displayName || "")) {
          recordLocalWin("multi");
        }
      }
      window.setTimeout(() => showResult(), 450);
      return;
    }

    if (game.mode === "solo") {
      if (!playerHasRounds(player)) {
        game.phase = "over";
        renderPlay();
        window.setTimeout(() => showResult(), 450);
        return;
      }
      renderPlay();
      startLocalRoundTimer();
      return;
    }

    game.phase = "waiting-next";
    renderPlay();
    const nxt = nextPlayerIndex(game.currentIndex);
    if (nxt === null) {
      game.phase = "over";
      els.afterTurn.hidden = true;
      window.setTimeout(() => showResult(), 450);
      return;
    }
    els.afterTurn.hidden = false;
    startHandoffCountdown();
  }

  const HANDOFF_SECONDS = 60;

  function clearHandoffCountdown() {
    if (handoffTimer) {
      window.clearInterval(handoffTimer);
      handoffTimer = null;
    }
    handoffEndsAt = null;
    if (els.nextBtn) {
      els.nextBtn.disabled = false;
      els.nextBtn.textContent = "คนถัดไป";
    }
  }

  function goToNextPlayer() {
    clearHandoffCountdown();
    const nxt = nextPlayerIndex(game.currentIndex);
    if (nxt === null) {
      showResult();
      return;
    }
    game.currentIndex = nxt;
    game.phase = "gated";
    showGate({ first: false, shuffling: false });
  }

  function startHandoffCountdown() {
    clearHandoffCountdown();
    handoffEndsAt = Date.now() + HANDOFF_SECONDS * 1000;
    if (els.nextBtn) {
      els.nextBtn.disabled = false;
      els.nextBtn.textContent = "คนถัดไป";
    }
    const tick = () => {
      if (!game || game.phase !== "waiting-next") {
        clearHandoffCountdown();
        return;
      }
      const left = Math.max(0, Math.ceil((handoffEndsAt - Date.now()) / 1000));
      els.playStatus.textContent =
        left > 0
          ? `ตรวจแล้ว · กดคนถัดไปได้เลย หรือรออีก ${formatDuration(left)}`
          : "ตรวจแล้ว · กำลังส่งเครื่องให้คนถัดไป";
      if (left <= 0) {
        goToNextPlayer();
      }
    };
    tick();
    handoffTimer = window.setInterval(tick, 250);
  }

  function secretText(secret) {
    return (secret || game.secret).join("  ");
  }

  function showResult(extra = null) {
    clearHandoffCountdown();
    stopGameTimer();
    const onlineEnded = game.mode === "online" && extra && !extra.local;
    const winners = onlineEnded ? extra.winners || [] : [];
    const won = onlineEnded ? winners.length > 0 : game.winnerIndex !== null;
    const winner = !onlineEnded && won ? game.players[game.winnerIndex] : null;

    if (extra?.local && extra.reason === "timeout") {
      els.resultKicker.textContent = "หมดเวลาแล้ว";
      els.resultTitle.textContent = "ส่งไม่ทัน";
      els.resultSecret.textContent = secretText();
      els.resultDetail.textContent = `โหมดยากมาก · ต้องตอบภายใน ${game.secondsPerLine} วินาทีต่อรอบ`;
    } else if (onlineEnded) {
      if (extra.reason === "timeout") els.resultKicker.textContent = "หมดเวลาแล้ว";
      else if (extra.reason === "rounds") els.resultKicker.textContent = "ครบทุกบรรทัดแล้ว";
      else if (extra.reason === "abandoned") els.resultKicker.textContent = "คู่แข่งหลุดจากห้อง";
      else els.resultKicker.textContent = won ? "มีคนทายถูกแล้ว" : "จบเกม";

      if (winners.length === 1) els.resultTitle.textContent = `${winners[0].name} ชนะ`;
      else if (winners.length > 1) els.resultTitle.textContent = `เสมอ · ${winners.map((w) => w.name).join(", ")}`;
      else if (extra.reason === "abandoned") els.resultTitle.textContent = "ไม่มีใครชนะ";
      else els.resultTitle.textContent = extra.reason === "timeout" ? "หมดเวลารอบ · ไม่มีใครส่งทัน" : "ยังไม่มีใครทายถูก";

      els.resultSecret.textContent = secretText(extra.secret);
      els.resultDetail.textContent = won
        ? "ทายถูกแล้ว · รหัสคือตัวเลขด้านบน"
        : extra.reason === "abandoned"
          ? "เหลือผู้เล่นไม่พอ · จบเกมโดยไม่มีผู้ชนะ"
          : `รหัสคือตัวเลขด้านบน · ${difficultyLabel(game.difficulty)} · ${game.allowRepeat ? "โหมดซ้ำได้" : "โหมดไม่ซ้ำ"}`;
    } else {
      els.resultKicker.textContent = won ? "มีคนทายถูกแล้ว" : "หมดรอบแล้ว";
      els.resultTitle.textContent = won
        ? game.mode === "solo"
          ? "คุณชนะ"
          : `${winner.name} ชนะ`
        : "ยังไม่มีใครทายถูก";
      els.resultSecret.textContent = secretText();
      els.resultDetail.textContent = won
        ? `ทายถูกใน ${winner.rows.length} รอบ · รหัสคือตัวเลขด้านบน`
        : `รหัสคือตัวเลขด้านบน · ${difficultyLabel(game.difficulty)} · ${game.allowRepeat ? "โหมดซ้ำได้" : "โหมดไม่ซ้ำ"}`;
    }

    screens.result.hidden = false;
    if (onlineEnded || won) refreshLeaderboard();
  }

  function showGate({ first, shuffling }) {
    const player = currentPlayer();
    els.gateKicker.textContent = first ? "เริ่มที่" : "ส่งเครื่องให้";
    els.gateName.textContent = shuffling ? "..." : player.name;
    els.gateNote.textContent = shuffling
      ? "กำลังสุ่มคนเล่นก่อน"
      : "ยังไม่เห็นกระดาษจนกว่าจะกดพร้อม";
    els.readyBtn.hidden = shuffling;
    showScreen("gate");
  }

  function startFromSettings(settings) {
    const token = (gameToken += 1);
    game = createGame(settings);
    if (settings.mode === "solo") {
      showScreen("play");
      renderPlay();
      startLocalRoundTimer();
      return;
    }

    showGate({ first: true, shuffling: true });
    const names = settings.names;
    let tick = 0;
    window.clearInterval(shuffleTimer);
    shuffleTimer = window.setInterval(() => {
      if (token !== gameToken) return;
      els.gateName.textContent = names[tick % names.length];
      tick += 1;
    }, 90);

    window.setTimeout(() => {
      if (token !== gameToken) return;
      window.clearInterval(shuffleTimer);
      game.currentIndex = Math.floor(Math.random() * names.length);
      showGate({ first: true, shuffling: false });
    }, 1400);
  }

  function openReview(index) {
    game.reviewing = true;
    let reviewIndex = index;
    if (game.mode === "online" && online.you) {
      const found = game.players.findIndex((p) => p.id === online.you.id || p.name === online.you.name);
      reviewIndex = found >= 0 ? found : 0;
    } else if (game.mode === "multi") {
      const myName = currentUser()?.displayName;
      const found = myName ? game.players.findIndex((p) => p.name === myName) : -1;
      reviewIndex = found >= 0 ? found : Math.max(0, game.winnerIndex ?? 0);
    } else {
      reviewIndex = 0;
    }
    game.reviewIndex = reviewIndex;
    screens.result.hidden = true;
    showScreen("play");
    els.reviewPlayers.innerHTML = "";
    els.reviewPlayers.hidden = true;
    const label = document.querySelector(".review-label");
    if (label) label.textContent = "ดูกระดาษของตัวเอง";
    renderPlay();
  }

  function replaySameSettings() {
    screens.result.hidden = true;
    if (game.mode === "online") {
      resetToSetup();
      return;
    }
    startFromSettings({
      mode: game.mode,
      difficulty: game.difficulty,
      allowRepeat: game.allowRepeat,
      roundLimit: game.roundLimit,
      names: game.players.map((player) => player.name),
    });
  }

  function resetToSetup() {
    gameToken += 1;
    window.clearInterval(shuffleTimer);
    clearHandoffCountdown();
    stopGameTimer();
    leaveOnlineRoom();
    game = null;
    online.waiting = false;
    online.papers = null;
    screens.result.hidden = true;
    if (currentUser()) {
      showScreen("setup");
      updateSetupVisibility();
    } else {
      showScreen("login");
    }
  }

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}`;
  }

  function ensureSocket(options = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(socket);
    }
    if (socketPromise) return socketPromise;

    if (location.protocol === "file:") {
      return Promise.reject(new Error("ต้องเปิดผ่านเซิร์ฟเวอร์ เช่น npm start"));
    }

    const previous = socket;
    socketPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl());
      socket = ws;

      if (previous && previous !== ws) {
        try {
          previous.onclose = null;
          previous.close();
        } catch {
          /* ignore */
        }
      }

      const onOpen = () => {
        cleanup();
        socketPromise = null;
        resolve(ws);
        if (!options.skipAutoRejoin && readRoomSession()?.code && !online.reconnecting) {
          window.setTimeout(() => {
            attemptAutoRejoin();
          }, 120);
        }
      };
      const onError = () => {
        cleanup();
        if (socket === ws) socket = null;
        socketPromise = null;
        reject(new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"));
      };
      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        handleSocketMessage(msg);
      });
      ws.addEventListener("close", () => {
        if (socket === ws) socket = null;
        if (socketPromise && socket === null) socketPromise = null;
        if (readRoomSession()?.code) {
          window.setTimeout(() => {
            attemptAutoRejoin();
          }, 800);
        }
      });
    });

    return socketPromise;
  }

  function sendSocket(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showPlayError("หลุดจากเซิร์ฟเวอร์");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function leaveOnlineRoom() {
    if (socket && socket.readyState === WebSocket.OPEN && online.code) {
      sendSocket({ type: "leave" });
    }
    clearRoomSession();
    online.code = null;
    online.you = null;
    online.hostId = null;
    online.players = [];
    online.password = "";
  }

  function roomShareUrl(code) {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    return url.toString();
  }

  function shareText(code) {
    return `มาร่วมเล่นเกมท้ายตัวเลขห้อง ${code} ได้ที่ ${roomShareUrl(code)}`;
  }

  function renderLobby(payload) {
    online.code = payload.code;
    online.roomName = payload.roomName || "";
    online.players = payload.players || [];
    online.hostId = payload.hostId || online.hostId || null;
    online.secondsPerLine = payload.secondsPerLine || online.secondsPerLine;
    els.lobbyTitle.textContent = payload.roomName || "ห้องรอเพื่อน";
    els.lobbyCode.textContent = payload.code;
    els.lobbySettings.textContent = formatRoomSettings(payload);

    const isHost = online.you?.id === payload.hostId;
    const me = meOnlineState(online.players);
    const allReady =
      online.players.length >= 2 &&
      online.players.every((player) => player.ready || player.isHost || player.isBot);
    const waitingNames = online.players
      .filter((player) => !player.isBot && !player.isHost && !player.ready)
      .map((player) => player.name);

    els.lobbyPlayers.innerHTML = online.players
      .map((player) => {
        const readyClass = player.ready || player.isHost || player.isBot ? "is-ready" : "is-wait";
        let readyText = "รอพร้อม";
        if (player.isBot) readyText = "บอท";
        else if (player.isHost) readyText = "หัวห้อง";
        else if (player.ready) readyText = "พร้อม";

        const actions = [];
        if (!player.isHost && !player.isBot && online.you?.id === player.id) {
          const ready = Boolean(player.ready);
          actions.push(
            `<button type="button" class="btn btn-ink ready-toggle-btn" data-ready-toggle="${ready ? "0" : "1"}">${
              ready ? "ยกเลิกพร้อม" : "กดพร้อม"
            }</button>`
          );
        }
        if (isHost && !player.isHost && (player.isBot || !player.ready)) {
          actions.push(
            `<button type="button" class="btn btn-ink kick-btn" data-kick-id="${escapeHtml(player.id)}">เตะ</button>`
          );
        }
        return `
        <li class="player-item">
          <span>${escapeHtml(player.name)}${player.isHost ? " (เจ้าของห้อง)" : ""}${
            player.isBot ? "" : online.you?.id === player.id ? " · คุณ" : ""
          }
            <span class="ready-pill ${readyClass}">${readyText}</span>
          </span>
          ${actions.join("")}
        </li>`;
      })
      .join("");

    if (els.lobbyAddBotBtn) {
      els.lobbyAddBotBtn.hidden = !isHost;
      els.lobbyAddBotBtn.disabled = online.players.length >= MAX_PLAYERS;
      els.lobbyAddBotBtn.textContent =
        online.players.length >= MAX_PLAYERS ? "เต็ม 8 ที่แล้ว" : "เพิ่มบอทแข่ง";
    }

    els.lobbyStartBtn.hidden = !isHost;
    els.lobbyStartBtn.disabled = !allReady;
    if (!isHost) {
      els.lobbyStartBtn.textContent = "เริ่มเกม";
    } else if (online.players.length < 2) {
      els.lobbyStartBtn.textContent = "รอเพื่อนหรือเพิ่มบอท";
    } else if (!allReady) {
      els.lobbyStartBtn.textContent = waitingNames.length
        ? `รอพร้อม: ${waitingNames.join(", ")}`
        : "รอเพื่อนกดพร้อม";
    } else {
      els.lobbyStartBtn.textContent = "เริ่มเกม";
    }
  }

  function handleSocketMessage(msg) {
    switch (msg.type) {
      case "hello":
        online.lanAddresses = msg.lanAddresses || [];
        online.port = msg.port;
        online.secondsPerLine = msg.secondsPerLine || DEFAULT_SECONDS_PER_LINE;
        roomCatalog = msg.rooms || [];
        if (msg.onlineCount != null) setOnlineCount(msg.onlineCount);
        renderRoomList();
        break;
      case "presence":
        if (msg.onlineCount != null) setOnlineCount(msg.onlineCount);
        break;
      case "roomList":
        roomCatalog = msg.rooms || [];
        renderRoomList();
        break;
      case "error":
        online.reconnecting = false;
        if (
          /ไม่พบที่นั่ง|หมดอายุ|ปิดแล้ว|ไม่พบห้อง/.test(String(msg.message || ""))
        ) {
          clearRoomSession();
          if (!screens.setup || screens.setup.hidden) {
            showScreen("setup");
            updateSetupVisibility();
          }
        }
        if (!screens.lobby.hidden) showLobbyError(msg.message);
        else if (!screens.play.hidden) {
          online.waiting = false;
          showPlayError(msg.message);
          renderPlay();
        } else showSetupError(msg.message);
        break;
      case "joined":
        online.you = msg.you;
        online.secondsPerLine = msg.secondsPerLine || DEFAULT_SECONDS_PER_LINE;
        online.difficulty = msg.difficulty || "normal";
        online.code = msg.code;
        online.hostId = msg.hostId || null;
        online.reconnecting = false;
        rejoinAttempts = 0;
        saveRoomSession();
        showLobbyError("");
        showScreen("lobby");
        renderLobby(msg);
        break;
      case "lobby":
        renderLobby(msg);
        saveRoomSession();
        break;
      case "rejoined":
        online.you = msg.you;
        online.code = msg.code;
        online.hostId = msg.hostId || online.hostId || null;
        online.difficulty = msg.difficulty || online.difficulty || "normal";
        online.secondsPerLine = msg.secondsPerLine || DEFAULT_SECONDS_PER_LINE;
        online.players = msg.players || [];
        rejoinAttempts = 0;
        online.reconnecting = false;
        saveRoomSession();
        if (msg.status === "playing") {
          beginOnlineGame({
            ...msg,
            round: msg.round,
            players: msg.players,
          });
          if (Array.isArray(msg.yourRows) && game) {
            game.players[0].rows = msg.yourRows;
          }
          online.waiting = Boolean(msg.pending);
          renderPlay();
        } else {
          showScreen("lobby");
          renderLobby(msg);
        }
        break;
      case "started":
        beginOnlineGame(msg);
        saveRoomSession();
        break;
      case "waiting":
        online.players = msg.players || [];
        online.round = msg.round;
        {
          const ends = msg.roundEndsAt || msg.endsAt;
          if (ends && online.endsAt !== ends) startGameTimer(ends);
          const me = meOnlineState(online.players);
          online.waiting = Boolean(me?.submitted);
        }
        renderPlay();
        break;
      case "roundResult":
        applyOnlineRoundResult(msg);
        break;
      case "ended":
        clearRoomSession();
        finishOnlineGame(msg);
        break;
      case "left":
        online.code = null;
        online.you = null;
        online.hostId = null;
        online.players = [];
        clearRoomSession();
        stopGameTimer();
        game = null;
        showScreen("setup");
        updateSetupVisibility();
        if (msg.reason === "kicked") {
          showSetupError("ถูกเตะออกจากห้องเพราะยังไม่กดพร้อม");
        }
        try {
          sendSocket({ type: "watchRooms" });
        } catch {
          /* ignore */
        }
        break;
      default:
        break;
    }
  }

  function beginOnlineGame(msg) {
    online.round = msg.round;
    online.waiting = false;
    online.players = msg.players || [];
    online.papers = null;
    online.difficulty = msg.difficulty || "normal";
    online.secondsPerLine = msg.secondsPerLine || difficultyConfig(online.difficulty).secondsPerLine;
    game = createGame({
      mode: "online",
      difficulty: msg.difficulty || "normal",
      allowRepeat: msg.allowRepeat,
      roundLimit: msg.roundLimit,
      names: [online.you?.name || "คุณ"],
    });
    game.secret = null;
    game.draft = emptyDraft();
    game.caret = 0;
    game.phase = "playing";
    startGameTimer(msg.roundEndsAt || msg.endsAt);
    showScreen("play");
    renderPlay();
  }

  function applyOnlineRoundResult(msg) {
    if (!game) return;
    if (msg.yourRow) game.players[0].rows.push(msg.yourRow);
    game.draft = emptyDraft();
    game.caret = 0;
    online.waiting = false;
    online.players = msg.submitted || [];
    if (msg.nextRound) {
      online.round = msg.nextRound;
      game.phase = "playing";
    } else game.phase = "over";
    renderPlay();
  }

  function finishOnlineGame(msg) {
    if (!game) {
      game = createGame({
        mode: "online",
        difficulty: msg.difficulty || online.difficulty || "normal",
        allowRepeat: msg.allowRepeat,
        roundLimit: msg.roundLimit,
        names: [online.you?.name || "คุณ"],
      });
    }
    if (msg.difficulty) {
      const cfg = difficultyConfig(msg.difficulty);
      game.difficulty = cfg.id;
      game.digitCount = cfg.digitCount;
      game.columnFeedback = cfg.columnFeedback;
      game.timeoutEnds = cfg.timeoutEnds;
      game.secondsPerLine = cfg.secondsPerLine;
    }
    game.secret = msg.secret;
    game.phase = "over";
    online.waiting = false;
    online.papers = msg.papers || [];
    if (online.papers.length) {
      game.players = online.papers.map((paper) => ({
        name: paper.name,
        rows: paper.rows || [],
        id: paper.id,
      }));
      const me = game.players.findIndex((p) => p.id === online.you?.id);
      if (me >= 0) game.currentIndex = me;
    }
    renderPlay();
    showResult(msg);
  }

  async function startOnlineFlow(settings) {
    showSetupError("");
    try {
      await ensureSocket();
      const idToken = await window.TualekAuth.getIdToken();
      online.password = settings.password || "";
      if (settings.action === "create") {
        sendSocket({
          type: "create",
          idToken,
          name: settings.name,
          roomName: settings.roomName,
          password: settings.password || "",
          allowRepeat: settings.allowRepeat,
          roundLimit: settings.roundLimit,
          difficulty: settings.difficulty || "normal",
        });
      } else {
        sendSocket({
          type: "join",
          idToken,
          name: settings.name,
          code: settings.code,
          password: settings.password || "",
        });
      }
    } catch (error) {
      showSetupError(error.message);
    }
  }

  function renderUserBar() {
    const user = currentUser();
    if (!user) return;
    els.userName.textContent = user.displayName || "ผู้เล่น";
    if (user.photoURL) {
      els.userAvatar.src = user.photoURL;
      els.userAvatar.hidden = false;
    } else {
      els.userAvatar.hidden = true;
    }
  }

  function enterApp() {
    renderUserBar();
    const logoutBtn = document.getElementById("logout-btn");
    const userNote = document.querySelector(".user-note");
    if (!window.TualekAuth.AUTH_REQUIRED) {
      if (logoutBtn) logoutBtn.hidden = true;
      if (userNote) userNote.textContent = "เล่นแบบแขก (ยังไม่บังคับล็อกอิน)";
      const userBar = document.querySelector(".user-bar");
      if (userBar) userBar.hidden = true;
    } else {
      if (logoutBtn) logoutBtn.hidden = false;
      if (userNote) userNote.textContent = "ล็อกอินแล้ว";
      const userBar = document.querySelector(".user-bar");
      if (userBar) userBar.hidden = false;
    }

    restoreSetupSession();

    const roomParam = new URLSearchParams(location.search).get("room");
    if (roomParam) {
      setup.mode = "online";
      setChoiceGroup("[data-mode]", "mode", "online");
      if (els.roomCodeInput) {
        els.roomCodeInput.value = roomParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      }
    }

    const session = readRoomSession();
    if (session?.code) {
      showScreen("lobby");
      els.lobbyTitle.textContent = "กำลังกลับเข้าห้อง…";
      els.lobbyCode.textContent = session.code;
      els.lobbySettings.textContent = "รีเฟรชแล้ว · กำลังเชื่อมต่อห้องล่าสุด";
      if (els.lobbyPlayers) {
        els.lobbyPlayers.innerHTML = `<li class="empty-players">กำลังกลับเข้าห้อง ${escapeHtml(session.code)}…</li>`;
      }
      if (els.lobbyStartBtn) els.lobbyStartBtn.hidden = true;
      if (els.lobbyAddBotBtn) els.lobbyAddBotBtn.hidden = true;
    } else {
      showScreen("setup");
    }

    updateSetupVisibility();
    updateDifficultyUi();
    refreshOnlineCount();
    ensureSocket()
      .then(() => {
        if (session?.code) attemptAutoRejoin();
      })
      .catch(() => {});
    if (window.TualekMusic?.start) window.TualekMusic.start().catch(() => {});
    if (!setup.names.length && currentUser()?.displayName) {
      setup.names = [currentUser().displayName];
      renderPlayerList();
    }
    saveSetupSession();
  }

  function showLoginScreen() {
    showScreen("login");
    const configured = window.TualekAuth.state.configured;
    els.loginStatus.textContent = configured
      ? "ล็อกอินด้วย Google หรือ Facebook เพื่อเริ่มเล่นและเก็บสถิติ"
      : "ยังไม่ได้ตั้งค่า Firebase · ใช้โหมดทดลองได้ชั่วคราว หรือใส่ค่าใน Render ตาม README";
    els.loginActions.hidden = !configured;
    els.demoLogin.hidden = configured;
  }

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.mode = btn.dataset.mode;
      setChoiceGroup("[data-mode]", "mode", setup.mode);
      updateSetupVisibility();
      showSetupError("");
      saveSetupSession();
    });
  });

  document.querySelectorAll("[data-difficulty]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.difficulty = btn.dataset.difficulty;
      setChoiceGroup("[data-difficulty]", "difficulty", setup.difficulty);
      updateDifficultyUi();
      showSetupError("");
      saveSetupSession();
    });
  });

  document.querySelectorAll("[data-repeat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.allowRepeat = btn.dataset.repeat === "yes";
      setChoiceGroup("[data-repeat]", "repeat", btn.dataset.repeat);
      saveSetupSession();
    });
  });

  document.querySelectorAll("[data-limit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.limitRounds = btn.dataset.limit === "yes";
      setChoiceGroup("[data-limit]", "limit", btn.dataset.limit);
      updateSetupVisibility();
      saveSetupSession();
    });
  });

  els.roundsInput.addEventListener("input", () => {
    updateTimePreview();
    saveSetupSession();
  });
  els.addPlayerBtn.addEventListener("click", () => {
    addPlayerName();
    saveSetupSession();
  });
  els.playerNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      addPlayerName();
      saveSetupSession();
    }
  });

  els.playerList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    setup.names.splice(Number(btn.dataset.remove), 1);
    renderPlayerList();
    saveSetupSession();
  });

  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    saveSetupSession();
  });

  [els.onlineNameInput, els.roomTitleInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", saveSetupSession);
  });

  window.addEventListener("beforeunload", () => {
    saveSetupSession();
    if (online.code) saveRoomSession();
  });
  window.addEventListener("pagehide", () => {
    saveSetupSession();
    if (online.code) saveRoomSession();
  });

  els.roomList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-join-code]");
    if (!btn) return;
    els.roomCodeInput.value = btn.dataset.joinCode;
    if (btn.dataset.locked === "1") els.joinPasswordInput.focus();
    else els.startBtn.click();
  });

  document.getElementById("refresh-rooms-btn").addEventListener("click", () => {
    ensureSocket()
      .then(() => sendSocket({ type: "watchRooms" }))
      .catch((error) => showSetupError(error.message));
  });

  els.startBtn.addEventListener("click", () => {
    if (!currentUser()) {
      showLoginScreen();
      return;
    }
    const settings = collectSettings();
    if (settings.error) {
      showSetupError(settings.error);
      return;
    }
    showSetupError("");
    if (settings.mode === "online") startOnlineFlow(settings);
    else startFromSettings(settings);
  });

  els.lobbyStartBtn.addEventListener("click", () => {
    showLobbyError("");
    sendSocket({ type: "start" });
  });

  if (els.lobbyAddBotBtn) {
    els.lobbyAddBotBtn.addEventListener("click", () => {
      showLobbyError("");
      sendSocket({ type: "addBot" });
    });
  }

  els.lobbyPlayers.addEventListener("click", (event) => {
    const readyBtn = event.target.closest("[data-ready-toggle]");
    if (readyBtn) {
      showLobbyError("");
      sendSocket({ type: "ready", ready: readyBtn.dataset.readyToggle === "1" });
      return;
    }
    const kickBtn = event.target.closest("[data-kick-id]");
    if (!kickBtn) return;
    showLobbyError("");
    sendSocket({ type: "kick", playerId: kickBtn.dataset.kickId });
  });

  function currentShareCode() {
    return online.code || els.lobbyCode?.textContent || "";
  }

  if (els.shareCopyBtn) {
    els.shareCopyBtn.addEventListener("click", async () => {
      const code = currentShareCode();
      if (!code) return;
      try {
        await navigator.clipboard.writeText(roomShareUrl(code));
        showLobbyError("");
        els.shareCopyBtn.textContent = "คัดลอกแล้ว";
        window.setTimeout(() => {
          els.shareCopyBtn.textContent = "คัดลอกลิงก์";
        }, 1200);
      } catch {
        showLobbyError("คัดลอกลิงก์ไม่สำเร็จ");
      }
    });
  }
  if (els.shareLineBtn) {
    els.shareLineBtn.addEventListener("click", () => {
      const code = currentShareCode();
      if (!code) return;
      window.open(
        `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(roomShareUrl(code))}`,
        "_blank",
        "noopener,noreferrer"
      );
    });
  }
  if (els.shareFbBtn) {
    els.shareFbBtn.addEventListener("click", () => {
      const code = currentShareCode();
      if (!code) return;
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(roomShareUrl(code))}`,
        "_blank",
        "noopener,noreferrer"
      );
    });
  }
  if (els.shareNativeBtn) {
    els.shareNativeBtn.addEventListener("click", async () => {
      const code = currentShareCode();
      if (!code) return;
      const url = roomShareUrl(code);
      if (navigator.share) {
        try {
          await navigator.share({ title: "เกมท้ายตัวเลข", text: shareText(code), url });
        } catch {
          /* cancelled */
        }
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  }

  els.lobbyLeaveBtn.addEventListener("click", () => {
    leaveOnlineRoom();
    showScreen("setup");
    sendSocket({ type: "watchRooms" });
  });

  els.readyBtn.addEventListener("click", () => {
    game.phase = "playing";
    game.draft = emptyDraft();
    game.caret = 0;
    showScreen("play");
    renderPlay();
    startLocalRoundTimer();
  });

  els.nextBtn.addEventListener("click", () => {
    if (els.nextBtn.disabled) return;
    goToNextPlayer();
  });

  els.paperBody.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-draft-cell]");
    if (!cell || !game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    game.caret = Number(cell.dataset.draftCell);
    renderPlay();
  });

  document.getElementById("keypad").addEventListener("click", (event) => {
    const key = event.target.closest(".key");
    if (!key || key.disabled) return;
    if (key.dataset.digit !== undefined) placeDigit(Number(key.dataset.digit));
  });

  document.getElementById("backspace-btn").addEventListener("click", backspace);
  document.getElementById("submit-btn").addEventListener("click", submitGuess);

  document.getElementById("view-papers-btn").addEventListener("click", () => {
    openReview(0);
  });
  document.getElementById("play-again-btn").addEventListener("click", replaySameSettings);
  document.getElementById("home-btn").addEventListener("click", resetToSetup);
  document.getElementById("review-again-btn").addEventListener("click", replaySameSettings);
  document.getElementById("review-home-btn").addEventListener("click", resetToSetup);
  document.getElementById("quit-btn").addEventListener("click", resetToSetup);

  screens.play.addEventListener("pointerdown", () => {
    signalHumanActivity();
  });

  els.reviewPlayers.addEventListener("click", (event) => {
    event.preventDefault();
  });

  document.getElementById("login-google-btn").addEventListener("click", async () => {
    showLoginError("");
    try {
      await window.TualekAuth.loginGoogle();
    } catch (error) {
      showLoginError(error.message || "ล็อกอิน Google ไม่สำเร็จ");
    }
  });

  document.getElementById("login-facebook-btn").addEventListener("click", async () => {
    showLoginError("");
    try {
      await window.TualekAuth.loginFacebook();
    } catch (error) {
      showLoginError(error.message || "ล็อกอิน Facebook ไม่สำเร็จ");
    }
  });

  document.getElementById("login-demo-btn").addEventListener("click", () => {
    showLoginError("");
    window.TualekAuth.loginDemo(els.demoNameInput.value);
    enterApp();
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await window.TualekAuth.logout();
    leaveOnlineRoom();
    if (!window.TualekAuth.AUTH_REQUIRED) {
      window.TualekAuth.loginDemo("ผู้เล่น");
      enterApp();
      return;
    }
    showLoginScreen();
  });

  document.addEventListener("keydown", (event) => {
    if (!game || screens.play.hidden || game.phase !== "playing" || game.reviewing || online.waiting) return;
    if (event.key >= "0" && event.key <= "9") {
      event.preventDefault();
      placeDigit(Number(event.key));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      backspace();
    } else if (event.key === "Enter") {
      event.preventDefault();
      submitGuess();
    } else if (event.key === "ArrowLeft") {
      game.caret = Math.max(0, game.caret - 1);
      renderPlay();
    } else if (event.key === "ArrowRight") {
      game.caret = Math.min(digitCount() - 1, game.caret + 1);
      renderPlay();
    }
  });

  window.addEventListener("auth-changed", () => {
    if (currentUser()) enterApp();
    else if (!window.TualekAuth.AUTH_REQUIRED) {
      window.TualekAuth.loginDemo("ผู้เล่น");
      enterApp();
    } else {
      showLoginScreen();
    }
  });

  renderPlayerList();

  window.TualekAuth.init()
    .then(() => {
      if (currentUser()) enterApp();
      else if (!window.TualekAuth.AUTH_REQUIRED) {
        window.TualekAuth.loginDemo("ผู้เล่น");
        enterApp();
      } else {
        showLoginScreen();
      }
    })
    .catch((error) => {
      if (!window.TualekAuth.AUTH_REQUIRED) {
        window.TualekAuth.loginDemo("ผู้เล่น");
        enterApp();
        return;
      }
      els.loginStatus.textContent = "โหลดระบบสมาชิกไม่สำเร็จ";
      showLoginError(error.message);
      els.demoLogin.hidden = false;
    });

  updateDifficultyUi();
})();
