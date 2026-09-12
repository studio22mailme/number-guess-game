(() => {
  const DIGIT_COUNT = 4;
  const MAX_PLAYERS = 8;
  const MAX_ROUNDS = 30;
  const SECONDS_PER_LINE = 120;

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
    lobbyLink: document.getElementById("lobby-link"),
    lobbyPlayers: document.getElementById("lobby-players"),
    lobbyError: document.getElementById("lobby-error"),
    lobbyStartBtn: document.getElementById("lobby-start-btn"),
    lobbyLeaveBtn: document.getElementById("lobby-leave-btn"),
    gateKicker: document.getElementById("gate-kicker"),
    gateName: document.getElementById("gate-name"),
    gateNote: document.getElementById("gate-note"),
    readyBtn: document.getElementById("ready-btn"),
    paperBody: document.getElementById("paper-body"),
    paperOwner: document.getElementById("paper-owner"),
    paperSecret: document.getElementById("paper-secret"),
    playStatus: document.getElementById("play-status"),
    waitFriends: document.getElementById("wait-friends"),
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
  };

  const setup = {
    mode: "solo",
    allowRepeat: false,
    limitRounds: false,
    names: [],
  };

  let game = null;
  let shuffleTimer = null;
  let gameToken = 0;
  let timerTick = null;
  let socket = null;
  let roomCatalog = [];

  let online = {
    you: null,
    code: null,
    roomName: "",
    players: [],
    endsAt: null,
    round: 1,
    waiting: false,
    papers: null,
    secondsPerLine: SECONDS_PER_LINE,
    lanAddresses: [],
    port: null,
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => {
      if (node) node.hidden = key !== name;
    });
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

  function feedbackMarkup(row) {
    if (row.win) {
      return `<span class="feedback-pegs">${'<span class="mark-star">★</span>'.repeat(DIGIT_COUNT)}</span>`;
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
    return Array(DIGIT_COUNT).fill(null);
  }

  function formatDuration(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function modeLabel(mode) {
    if (mode === "multi") return "ส่งเครื่อง";
    if (mode === "online") return "คนละเครื่อง";
    return "คนเดียว";
  }

  function updateTimePreview() {
    if (setup.mode !== "online") {
      els.timePreview.hidden = true;
      return;
    }
    const rounds = Number(els.roundsInput.value) || 0;
    const mins = Math.floor((rounds * SECONDS_PER_LINE) / 60);
    els.timePreview.hidden = false;
    els.timePreview.textContent = `แต่ละบรรทัดมีเวลา 2 นาที · ส่งได้เลยไม่ต้องรอเพื่อน · ไม่ส่งทัน Bot เล่นแทน`;
  }

  function updateSetupVisibility() {
    const isMulti = setup.mode === "multi";
    const isOnline = setup.mode === "online";

    els.playersField.hidden = !isMulti;
    els.onlineField.hidden = !isOnline;
    els.repeatField.hidden = false;

    if (isOnline) {
      els.limitChoices.hidden = true;
      els.roundsRow.hidden = false;
      els.roundsLabel.textContent = "จำนวนบรรทัด (บังคับ)";
      els.roundsInputLabel.textContent = "กี่บรรทัด";
      els.roundsSuffix.textContent = "บรรทัด";
      els.startBtn.textContent = "เข้าห้อง / สร้างห้อง";
      updateTimePreview();
      ensureSocket()
        .then(() => sendSocket({ type: "watchRooms" }))
        .catch(() => {});
    } else {
      els.limitChoices.hidden = false;
      els.roundsRow.hidden = !setup.limitRounds;
      els.roundsLabel.textContent = "จำกัดจำนวนรอบไหม";
      els.roundsInputLabel.textContent = "กี่รอบ";
      els.roundsSuffix.textContent = "รอบต่อคน";
      els.timePreview.hidden = true;
      els.startBtn.textContent = "เริ่มเกม";
    }

    els.leaderboardLabel.textContent = `อันดับชนะ · ${modeLabel(setup.mode)}`;
    refreshLeaderboard();
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
            <span class="room-meta">รหัส ${escapeHtml(room.code)} · ${room.playerCount}/${room.maxPlayers || MAX_PLAYERS} คน${room.hasPassword ? " · มีรหัสผ่าน" : ""}</span>
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
      const rows = await window.TualekAuth.fetchLeaderboard(setup.mode);
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
      const rounds = Number(els.roundsInput.value);

      if (!name) {
        return { error: "กรุณาใส่ชื่อของคุณในห้อง" };
      }
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
        return { error: `จำนวนบรรทัดต้องเป็นเลข 1–${MAX_ROUNDS}` };
      }

      if (code) {
        return {
          mode: "online",
          action: "join",
          name,
          code,
          password: joinPassword,
          roundLimit: rounds,
          allowRepeat: setup.allowRepeat,
        };
      }

      return {
        mode: "online",
        action: "create",
        name,
        roomName: roomName || `${name} ห้อง`,
        password,
        allowRepeat: setup.allowRepeat,
        roundLimit: rounds,
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
      allowRepeat: setup.allowRepeat,
      roundLimit,
      names,
    };
  }

  function createGame(settings, secret) {
    return {
      mode: settings.mode,
      allowRepeat: settings.allowRepeat,
      roundLimit: settings.roundLimit,
      secret: secret || generateSecret(settings.allowRepeat),
      players: settings.names.map((name) => ({ name, rows: [] })),
      currentIndex: 0,
      draft: emptyDraft(),
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
    const rows = [];

    for (let i = 0; i < rowCount; i += 1) {
      const filled = player.rows[i];
      const isDraftRow = interactive && i === player.rows.length && game.phase === "playing";
      const isPendingRow =
        game.mode === "online" && online.waiting && i === player.rows.length && !filled;
      const digits = filled
        ? filled.guess
        : isDraftRow || isPendingRow
          ? game.draft
          : [null, null, null, null];
      const feedback = filled ? feedbackMarkup(filled) : isPendingRow ? "รอ…" : "";
      const feedbackClass = filled?.win ? "feedback win" : "feedback";

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
      game.secret.length === DIGIT_COUNT &&
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

  function startGameTimer(endsAt) {
    stopGameTimer();
    if (!endsAt) return;
    online.endsAt = endsAt;
    els.gameTimer.hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      els.gameTimer.textContent = `เหลือเวลาตอบ ${formatDuration(left)}`;
      if (left <= 30) els.gameTimer.classList.add("urgent");
      else els.gameTimer.classList.remove("urgent");
    };
    tick();
    timerTick = setInterval(tick, 250);
  }

  function meOnlineState(players) {
    if (!online.you || !players) return null;
    return players.find((player) => player.id === online.you.id) || null;
  }

  function renderWaitFriends(players) {
    const me = meOnlineState(players);
    if (!players || (!online.waiting && !me?.botMode)) {
      els.waitFriends.hidden = true;
      return;
    }
    els.waitFriends.hidden = false;
    if (me?.botMode) {
      els.waitFriends.textContent = me.submitted
        ? "Bot เล่นแทนอยู่ · แตะหน้าจอเพื่อกลับมาเล่นเอง"
        : "Bot พร้อมเล่นแทน · แตะหน้าจอเพื่อเล่นเอง";
      return;
    }
    if (online.waiting) {
      els.waitFriends.textContent = "ส่งแล้ว · รอหมดเวลารอบนี้เพื่อตรวจคำตอบ (ไม่ต้องรอเพื่อน)";
      return;
    }
    els.waitFriends.hidden = true;
  }

  function signalHumanActivity() {
    if (!game || game.mode !== "online" || game.phase !== "playing" || game.reviewing) return;
    const me = meOnlineState(online.players);
    if (!me?.botMode && !me?.fromBot) return;
    online.players = (online.players || []).map((player) =>
      player.id === online.you?.id
        ? { ...player, botMode: false, submitted: false, fromBot: false }
        : player
    );
    online.waiting = false;
    try {
      sendSocket({ type: "resume" });
    } catch {
      /* ignore */
    }
  }

  function renderPlay() {
    const player = game.reviewing ? game.players[game.reviewIndex] : currentPlayer();
    const me = meOnlineState(online.players);
    const blockedByBot = game.mode === "online" && Boolean(me?.botMode && me?.submitted);
    const interactive =
      !game.reviewing && game.phase === "playing" && !online.waiting && !blockedByBot;
    renderPaper(player, interactive);

    if (game.reviewing) {
      els.keypad.hidden = true;
      els.afterTurn.hidden = true;
      els.reviewBar.hidden = false;
      els.waitFriends.hidden = true;
      document.getElementById("quit-btn").hidden = true;
      els.playStatus.textContent = "จบเกมแล้ว · ดูกระดาษของตัวเอง";
      showPlayError("");
      return;
    }

    document.getElementById("quit-btn").hidden = false;
    els.reviewBar.hidden = true;
    els.keypad.hidden = game.phase !== "playing" || online.waiting || blockedByBot;
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
    } else {
      els.waitFriends.hidden = true;
    }
  }

  function placeDigit(digit) {
    signalHumanActivity();
    if (!game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    const me = meOnlineState(online.players);
    if (me?.botMode && me?.submitted) return;
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
    else if (game.caret < DIGIT_COUNT - 1) game.caret += 1;
    renderPlay();
  }

  function backspace() {
    signalHumanActivity();
    if (!game || game.phase !== "playing" || game.reviewing || online.waiting) return;
    const me = meOnlineState(online.players);
    if (me?.botMode && me?.submitted) return;
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
    const me = meOnlineState(online.players);
    if (me?.botMode && me?.submitted) return;
    showPlayError("");
    if (game.draft.some((digit) => digit === null)) {
      showPlayError("ต้องกรอกตัวเลข 4 หลักทุกครั้ง");
      return;
    }
    if (!game.allowRepeat && new Set(game.draft).size !== DIGIT_COUNT) {
      showPlayError("โหมดนี้ห้ามใช้เลขซ้ำ");
      return;
    }

    if (game.mode === "online") {
      online.waiting = true;
      renderPlay();
      sendSocket({ type: "submit", round: online.round, digits: [...game.draft] });
      return;
    }

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
    els.playStatus.textContent = "ตรวจแล้ว · ส่งเครื่องให้คนถัดไปได้";
  }

  function secretText(secret) {
    return (secret || game.secret).join("  ");
  }

  function showResult(extra = null) {
    stopGameTimer();
    const onlineEnded = game.mode === "online" && extra;
    const winners = onlineEnded ? extra.winners || [] : [];
    const won = onlineEnded ? winners.length > 0 : game.winnerIndex !== null;
    const winner = !onlineEnded && won ? game.players[game.winnerIndex] : null;

    if (onlineEnded) {
      if (extra.reason === "timeout") els.resultKicker.textContent = "หมดเวลาแล้ว";
      else if (extra.reason === "rounds") els.resultKicker.textContent = "ครบทุกบรรทัดแล้ว";
      else if (extra.reason === "abandoned") els.resultKicker.textContent = "เพื่อนออกจากห้อง";
      else els.resultKicker.textContent = won ? "มีคนทายถูกแล้ว" : "จบเกม";

      if (winners.length === 1) els.resultTitle.textContent = `${winners[0].name} ชนะ`;
      else if (winners.length > 1) els.resultTitle.textContent = `เสมอ · ${winners.map((w) => w.name).join(", ")}`;
      else els.resultTitle.textContent = "ยังไม่มีใครทายถูก";

      els.resultSecret.textContent = secretText(extra.secret);
      els.resultDetail.textContent = won
        ? "ทายถูก · รหัสคือตัวเลขด้านบน"
        : `รหัสคือตัวเลขด้านบน · ${game.allowRepeat ? "โหมดซ้ำได้" : "โหมดไม่ซ้ำ"}`;
      refreshLeaderboard();
    } else {
      els.resultKicker.textContent = won ? "มีคนทายถูกแล้ว" : "หมดรอบแล้ว";
      els.resultTitle.textContent = won
        ? game.mode === "solo"
          ? "ถูกต้องแล้ว"
          : `${winner.name} ชนะ`
        : "ยังไม่มีใครทายถูก";
      els.resultSecret.textContent = secretText();
      els.resultDetail.textContent = won
        ? `ทายถูกใน ${winner.rows.length} รอบ · รหัสคือตัวเลขด้านบน`
        : `รหัสคือตัวเลขด้านบน · ${game.allowRepeat ? "โหมดซ้ำได้" : "โหมดไม่ซ้ำ"}`;
    }

    screens.result.hidden = false;
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
      allowRepeat: game.allowRepeat,
      roundLimit: game.roundLimit,
      names: game.players.map((player) => player.name),
    });
  }

  function resetToSetup() {
    gameToken += 1;
    window.clearInterval(shuffleTimer);
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

  function ensureSocket() {
    return new Promise((resolve, reject) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        resolve(socket);
        return;
      }
      if (location.protocol === "file:") {
        reject(new Error("ต้องเปิดผ่านเซิร์ฟเวอร์ เช่น npm start"));
        return;
      }

      const ws = new WebSocket(wsUrl());
      socket = ws;
      const onOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onError = () => {
        cleanup();
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
    });
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
    online.code = null;
    online.you = null;
    online.players = [];
  }

  function renderLobby(payload) {
    online.code = payload.code;
    online.roomName = payload.roomName || "";
    online.players = payload.players || [];
    els.lobbyTitle.textContent = payload.roomName || "ห้องรอเพื่อน";
    els.lobbyCode.textContent = payload.code;
    const mins = Math.floor((payload.roundLimit * (online.secondsPerLine || SECONDS_PER_LINE)) / 60);
    els.lobbySettings.textContent = `${payload.hasPassword ? "มีรหัสผ่าน · " : ""}${payload.allowRepeat ? "ซ้ำได้" : "ไม่ซ้ำ"} · ${payload.roundLimit} บรรทัด · เวลารวม ${mins} นาที`;
    els.lobbyLink.textContent = `ลิงก์นี้: ${location.origin} · ให้เพื่อนล็อกอินแล้วเข้าร่วมด้วยรหัส ${payload.code}`;

    els.lobbyPlayers.innerHTML = online.players
      .map(
        (player) => `
        <li class="player-item">
          <span>${escapeHtml(player.name)}${player.isHost ? " (เจ้าของห้อง)" : ""}${online.you?.id === player.id ? " · คุณ" : ""}</span>
        </li>`
      )
      .join("");

    const isHost = online.you?.id === payload.hostId;
    els.lobbyStartBtn.hidden = !isHost;
    els.lobbyStartBtn.disabled = online.players.length < 2;
    els.lobbyStartBtn.textContent =
      online.players.length < 2 ? "รอเพื่อนอย่างน้อย 2 คน" : "เริ่มเกม";
  }

  function handleSocketMessage(msg) {
    switch (msg.type) {
      case "hello":
        online.lanAddresses = msg.lanAddresses || [];
        online.port = msg.port;
        online.secondsPerLine = msg.secondsPerLine || SECONDS_PER_LINE;
        roomCatalog = msg.rooms || [];
        renderRoomList();
        break;
      case "roomList":
        roomCatalog = msg.rooms || [];
        renderRoomList();
        break;
      case "error":
        if (!screens.lobby.hidden) showLobbyError(msg.message);
        else if (!screens.play.hidden) {
          online.waiting = false;
          showPlayError(msg.message);
          renderPlay();
        } else showSetupError(msg.message);
        break;
      case "joined":
        online.you = msg.you;
        online.secondsPerLine = msg.secondsPerLine || SECONDS_PER_LINE;
        showLobbyError("");
        showScreen("lobby");
        renderLobby(msg);
        break;
      case "lobby":
        renderLobby(msg);
        break;
      case "started":
        beginOnlineGame(msg);
        break;
      case "waiting":
        online.players = msg.players || [];
        online.round = msg.round;
        {
          const ends = msg.roundEndsAt || msg.endsAt;
          if (ends && online.endsAt !== ends) startGameTimer(ends);
          const me = meOnlineState(online.players);
          online.waiting = Boolean(me?.submitted && !me?.botMode);
        }
        renderPlay();
        break;
      case "roundResult":
        applyOnlineRoundResult(msg);
        break;
      case "ended":
        finishOnlineGame(msg);
        break;
      case "left":
        online.code = null;
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
    game = createGame({
      mode: "online",
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
        allowRepeat: msg.allowRepeat,
        roundLimit: msg.roundLimit,
        names: [online.you?.name || "คุณ"],
      });
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
      if (settings.action === "create") {
        sendSocket({
          type: "create",
          idToken,
          name: settings.name,
          roomName: settings.roomName,
          password: settings.password || "",
          allowRepeat: settings.allowRepeat,
          roundLimit: settings.roundLimit,
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
    showScreen("setup");
    updateSetupVisibility();
    if (!setup.names.length && currentUser()?.displayName) {
      setup.names = [currentUser().displayName];
      renderPlayerList();
    }
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
    });
  });

  document.querySelectorAll("[data-repeat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.allowRepeat = btn.dataset.repeat === "yes";
      setChoiceGroup("[data-repeat]", "repeat", btn.dataset.repeat);
    });
  });

  document.querySelectorAll("[data-limit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setup.limitRounds = btn.dataset.limit === "yes";
      setChoiceGroup("[data-limit]", "limit", btn.dataset.limit);
      updateSetupVisibility();
    });
  });

  els.roundsInput.addEventListener("input", updateTimePreview);
  els.addPlayerBtn.addEventListener("click", addPlayerName);
  els.playerNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPlayerName();
  });

  els.playerList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    setup.names.splice(Number(btn.dataset.remove), 1);
    renderPlayerList();
  });

  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
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
  });

  els.nextBtn.addEventListener("click", () => {
    const nxt = nextPlayerIndex(game.currentIndex);
    if (nxt === null) {
      showResult();
      return;
    }
    game.currentIndex = nxt;
    game.phase = "gated";
    showGate({ first: false, shuffling: false });
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
      game.caret = Math.min(DIGIT_COUNT - 1, game.caret + 1);
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
})();
