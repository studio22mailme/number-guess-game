(() => {
  const STORAGE_KEY = "tualek-bgm-on";
  const BPM = 76;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;
  const SWING = 0.06;

  // Soft jazz-hop progressions (root MIDI notes in C minor-ish chill keys)
  const PROGRESSIONS = [
    [
      [48, 51, 55, 58, 62], // Cm9
      [53, 57, 60, 63, 67], // Fm9
      [46, 50, 53, 57, 60], // Bbmaj7
      [43, 47, 50, 53, 58], // Gm7
    ],
    [
      [45, 48, 52, 55, 59], // Am7
      [50, 53, 57, 60, 64], // Dm9
      [43, 47, 50, 54, 57], // G7
      [48, 52, 55, 59, 62], // Cmaj7
    ],
    [
      [46, 50, 53, 57, 60], // Bbmaj7
      [41, 45, 48, 52, 55], // F7
      [43, 46, 50, 53, 58], // Gm7
      [48, 51, 55, 58, 62], // Cm7
    ],
  ];

  const BASS_PATTERNS = [
    [0, null, 7, null, 3, null, 10, null],
    [0, null, null, 7, 3, null, 5, null],
    [0, 0, null, 7, null, 3, null, 10],
  ];

  let ctx = null;
  let master = null;
  let filter = null;
  let playing = false;
  if (localStorage.getItem(STORAGE_KEY) == null) {
    localStorage.setItem(STORAGE_KEY, "1");
  }
  let muted = localStorage.getItem(STORAGE_KEY) === "0";
  let nextNoteTime = 0;
  let step = 0;
  let barIndex = 0;
  let progressionIndex = 0;
  let timerId = null;
  let crackleNode = null;
  let startedOnce = false;

  function preferMusicOn() {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  }

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.22;

    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;

    const softShelf = ctx.createBiquadFilter();
    softShelf.type = "highshelf";
    softShelf.frequency.value = 3500;
    softShelf.gain.value = -4;

    filter.connect(softShelf);
    softShelf.connect(master);
    master.connect(ctx.destination);

    return ctx;
  }

  function scheduleTone(freq, start, dur, type, gain, dest) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest || filter);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function scheduleRhodes(freqs, start, dur) {
    const chordGain = ctx.createGain();
    chordGain.gain.value = 1;
    chordGain.connect(filter);

    freqs.forEach((midi, i) => {
      const f = midiToHz(midi);
      const voice = ctx.createGain();
      voice.gain.value = 0.12 / (1 + i * 0.15);
      voice.connect(chordGain);

      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = "sine";
      b.type = "triangle";
      a.frequency.setValueAtTime(f, start);
      b.frequency.setValueAtTime(f * 2.002, start);
      b.detune.setValueAtTime(6, start);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(1, start + 0.04);
      env.gain.exponentialRampToValueAtTime(0.35, start + dur * 0.45);
      env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      a.connect(env);
      b.connect(env);
      env.connect(voice);
      a.start(start);
      b.start(start);
      a.stop(start + dur + 0.05);
      b.stop(start + dur + 0.05);
    });
  }

  function scheduleKick(time) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.18);
    g.gain.setValueAtTime(0.55, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    osc.connect(g);
    g.connect(filter);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  function scheduleSnare(time) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.18);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    noise.connect(noiseFilter);
    noiseFilter.connect(g);
    g.connect(filter);
    noise.start(time);
    noise.stop(time + 0.18);

    scheduleTone(180, time, 0.08, "triangle", 0.08);
  }

  function scheduleHat(time, open) {
    const bufferSize = Math.floor(ctx.sampleRate * (open ? 0.12 : 0.05));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.06 : 0.035, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.1 : 0.04));
    noise.connect(hp);
    hp.connect(g);
    g.connect(filter);
    noise.start(time);
    noise.stop(time + (open ? 0.12 : 0.05));
  }

  function scheduleBass(midi, time, dur) {
    const f = midiToHz(midi);
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    sub.type = "sine";
    osc.frequency.setValueAtTime(f, time);
    sub.frequency.setValueAtTime(f * 0.5, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.28, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    sub.connect(g);
    g.connect(filter);
    osc.start(time);
    sub.start(time);
    osc.stop(time + dur + 0.02);
    sub.stop(time + dur + 0.02);
  }

  function startCrackle() {
    if (crackleNode || !ctx) return;
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const dust = Math.random() < 0.002 ? (Math.random() * 2 - 1) * 0.35 : 0;
      data[i] = (Math.random() * 2 - 1) * 0.012 + dust;
    }
    crackleNode = ctx.createBufferSource();
    crackleNode.buffer = buffer;
    crackleNode.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.45;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 0.5;
    crackleNode.connect(bp);
    bp.connect(g);
    g.connect(filter);
    crackleNode.start();
  }

  function stopCrackle() {
    if (!crackleNode) return;
    try {
      crackleNode.stop();
    } catch (_) {
      /* already stopped */
    }
    crackleNode = null;
  }

  function currentChord() {
    const prog = PROGRESSIONS[progressionIndex % PROGRESSIONS.length];
    return prog[barIndex % prog.length];
  }

  function scheduleBarSlice() {
    if (!playing || muted || !ctx) return;

    const lookAhead = 0.12;
    const scheduleAhead = 0.25;

    while (nextNoteTime < ctx.currentTime + scheduleAhead) {
      const chord = currentChord();
      const root = chord[0];
      const eighth = BEAT / 2;
      const swingOffset = step % 2 === 1 ? eighth * SWING : 0;
      const t = nextNoteTime + swingOffset;
      const bassPat = BASS_PATTERNS[progressionIndex % BASS_PATTERNS.length];

      if (step === 0) {
        scheduleRhodes(chord, t, BAR * 0.95);
      }

      // Kick on 1 and 3, soft ghost on & of 2
      if (step === 0 || step === 4) scheduleKick(t);
      if (step === 3 && Math.random() < 0.35) scheduleKick(t);

      // Snare on 2 and 4
      if (step === 2 || step === 6) scheduleSnare(t);

      // Hats every 8th, open occasionally
      if (step % 1 === 0) {
        const open = step === 7 && Math.random() < 0.4;
        scheduleHat(t, open);
      }

      const bassStep = bassPat[step];
      if (bassStep != null) {
        scheduleBass(root + bassStep - 12, t, eighth * 1.4);
      }

      // Soft melody sparkles every other bar
      if (barIndex % 2 === 1 && (step === 1 || step === 5) && Math.random() < 0.55) {
        const pick = chord[2 + Math.floor(Math.random() * Math.min(3, chord.length - 2))];
        scheduleTone(midiToHz(pick + 12), t, eighth * 1.6, "sine", 0.05);
      }

      step += 1;
      if (step >= 8) {
        step = 0;
        barIndex += 1;
        if (barIndex % 4 === 0) {
          progressionIndex = (progressionIndex + 1) % PROGRESSIONS.length;
        }
      }
      nextNoteTime += eighth;
    }

    timerId = window.setTimeout(scheduleBarSlice, lookAhead * 1000);
  }

  function setMasterMute(isMuted) {
    if (!master || !ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(isMuted ? 0.0001 : 0.22, now + 0.25);
  }

  async function start() {
    if (!ensureCtx()) return false;
    if (ctx.state === "suspended") await ctx.resume();
    if (playing) {
      muted = false;
      setMasterMute(false);
      localStorage.setItem(STORAGE_KEY, "1");
      syncToggle();
      return true;
    }
    playing = true;
    muted = false;
    startedOnce = true;
    step = 0;
    barIndex = 0;
    progressionIndex = Math.floor(Math.random() * PROGRESSIONS.length);
    nextNoteTime = ctx.currentTime + 0.08;
    startCrackle();
    setMasterMute(false);
    localStorage.setItem(STORAGE_KEY, "1");
    scheduleBarSlice();
    syncToggle();
    return true;
  }

  function stop() {
    muted = true;
    playing = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    stopCrackle();
    setMasterMute(true);
    localStorage.setItem(STORAGE_KEY, "0");
    syncToggle();
  }

  async function toggle() {
    if (!ensureCtx()) return;
    if (ctx.state === "suspended") await ctx.resume();
    if (playing && !muted) stop();
    else await start();
  }

  function syncToggle() {
    const btn = document.getElementById("music-toggle");
    if (!btn) return;
    const on = preferMusicOn();
    if (btn.type === "checkbox") {
      btn.checked = on;
    } else {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    btn.title = on ? "ปิดเพลง" : "เปิดเพลง";
    btn.setAttribute("aria-label", on ? "ปิดเพลง" : "เปิดเพลง");
    const text = document.getElementById("music-switch-text");
    if (text) text.textContent = on ? "เปิด" : "ปิด";
  }

  function mountToggle() {
    const btn = document.getElementById("music-toggle");
    if (!btn) return;
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("change", async () => {
        if (btn.checked) await start();
        else stop();
        syncToggle();
      });
    }
    syncToggle();
  }

  // Auto-start after first user gesture (default: on)
  function armAutoStart() {
    if (!preferMusicOn() || startedOnce) return;
    const once = () => {
      document.removeEventListener("pointerdown", once);
      document.removeEventListener("keydown", once);
      start();
    };
    document.addEventListener("pointerdown", once, { once: true });
    document.addEventListener("keydown", once, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountToggle();
      armAutoStart();
    });
  } else {
    mountToggle();
    armAutoStart();
  }

  window.TualekMusic = { start, stop, toggle, isOn: () => playing && !muted };
})();
