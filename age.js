(() => {
  const STORAGE_KEY = "tualek-player-age";

  function ageBand(age) {
    const n = Number(age);
    if (!Number.isFinite(n)) return "adult";
    if (n < 13) return "child";
    if (n < 20) return "teen";
    if (n < 45) return "adult";
    if (n < 60) return "mature";
    return "senior";
  }

  function applyAgeTheme(age) {
    const band = ageBand(age);
    document.documentElement.dataset.ageTheme = band;
    document.documentElement.dataset.playerAge = String(age);
    return band;
  }

  function readStoredAge() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return null;
    const age = Number(raw);
    if (!Number.isInteger(age) || age < 1 || age > 120) return null;
    return age;
  }

  function saveAge(age) {
    localStorage.setItem(STORAGE_KEY, String(age));
    applyAgeTheme(age);
    if (window.TualekMusic?.start) {
      window.TualekMusic.start().catch(() => {});
    }
  }

  function showAgeGate() {
    const gate = document.getElementById("age-gate");
    if (!gate) return;
    gate.hidden = false;
    document.body.classList.add("age-gate-open");
    const input = document.getElementById("age-input");
    if (input) {
      window.setTimeout(() => input.focus(), 60);
    }
  }

  function hideAgeGate() {
    const gate = document.getElementById("age-gate");
    if (gate) gate.hidden = true;
    document.body.classList.remove("age-gate-open");
  }

  function showAgeError(message) {
    const el = document.getElementById("age-error");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function submitAge() {
    const input = document.getElementById("age-input");
    const age = Number(input?.value);
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      showAgeError("กรอกอายุเป็นตัวเลข 1–120 ปี");
      return;
    }
    showAgeError("");
    saveAge(age);
    hideAgeGate();
  }

  function mountAgeGate() {
    const stored = readStoredAge();
    if (stored != null) {
      applyAgeTheme(stored);
      hideAgeGate();
      return;
    }

    applyAgeTheme(25);
    showAgeGate();

    const form = document.getElementById("age-form");
    const submit = document.getElementById("age-submit");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitAge();
      });
    }
    if (submit) {
      submit.addEventListener("click", (event) => {
        event.preventDefault();
        submitAge();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAgeGate);
  } else {
    mountAgeGate();
  }

  window.TualekAge = {
    getAge: readStoredAge,
    getBand: () => ageBand(readStoredAge() ?? 25),
    apply: applyAgeTheme,
    save: saveAge,
  };
})();
