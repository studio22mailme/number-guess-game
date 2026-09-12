(() => {
  const BIRTH_YEAR_KEY = "tualek-birth-year";
  const LEGACY_AGE_KEY = "tualek-player-age";

  function currentYear() {
    return new Date().getFullYear();
  }

  function ageBand(age) {
    const n = Number(age);
    if (!Number.isFinite(n)) return "adult";
    if (n < 13) return "child";
    if (n < 20) return "teen";
    if (n < 45) return "adult";
    if (n < 60) return "mature";
    return "senior";
  }

  function ageFromBirthYear(birthYear) {
    const age = currentYear() - Number(birthYear);
    if (!Number.isInteger(age)) return null;
    return Math.min(120, Math.max(1, age));
  }

  function applyAgeTheme(age) {
    const band = ageBand(age);
    document.documentElement.dataset.ageTheme = band;
    document.documentElement.dataset.playerAge = String(age);
    return band;
  }

  function readBirthYear() {
    const rawYear = localStorage.getItem(BIRTH_YEAR_KEY);
    if (rawYear != null && rawYear !== "") {
      const year = Number(rawYear);
      if (Number.isInteger(year) && year >= 1900 && year <= currentYear()) {
        return year;
      }
    }

    // ย้ายค่าเก่าที่เก็บเป็นอายุคงที่ → คิดเป็นปีเกิดจากปีปัจจุบันตอนย้าย
    const legacy = localStorage.getItem(LEGACY_AGE_KEY);
    if (legacy != null && legacy !== "") {
      const age = Number(legacy);
      if (Number.isInteger(age) && age >= 1 && age <= 120) {
        const birthYear = currentYear() - age;
        localStorage.setItem(BIRTH_YEAR_KEY, String(birthYear));
        return birthYear;
      }
    }
    return null;
  }

  function readCurrentAge() {
    const birthYear = readBirthYear();
    if (birthYear == null) return null;
    return ageFromBirthYear(birthYear);
  }

  function saveAge(ageAtEntry) {
    const birthYear = currentYear() - ageAtEntry;
    localStorage.setItem(BIRTH_YEAR_KEY, String(birthYear));
    localStorage.removeItem(LEGACY_AGE_KEY);
    applyAgeTheme(ageFromBirthYear(birthYear));
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
    const age = readCurrentAge();
    if (age != null) {
      applyAgeTheme(age);
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

  function resetAge() {
    localStorage.removeItem(BIRTH_YEAR_KEY);
    localStorage.removeItem(LEGACY_AGE_KEY);
    const input = document.getElementById("age-input");
    if (input) input.value = "";
    showAgeError("");
    applyAgeTheme(25);
    showAgeGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAgeGate);
  } else {
    mountAgeGate();
  }

  window.TualekAge = {
    getAge: readCurrentAge,
    getBirthYear: readBirthYear,
    getBand: () => ageBand(readCurrentAge() ?? 25),
    apply: applyAgeTheme,
    save: saveAge,
    showGate: showAgeGate,
    reset: resetAge,
  };
})();
