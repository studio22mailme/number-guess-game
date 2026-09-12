(() => {
  // ชั่วคราว: ปิดบังคับล็อกอิน ให้เล่นได้ทันทีแบบแขก
  const AUTH_REQUIRED = false;

  const Auth = {
    ready: false,
    configured: false,
    user: null,
    demo: false,
    db: null,
    auth: null,
  };

  function isConfigReady(config) {
    return Boolean(config && config.apiKey && config.projectId && config.appId);
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/firebase-config");
      if (res.ok) {
        const data = await res.json();
        if (isConfigReady(data)) return data;
      }
    } catch {
      /* ignore */
    }
    return window.FIREBASE_WEB_CONFIG || {};
  }

  async function init() {
    if (!AUTH_REQUIRED) {
      Auth.ready = true;
      Auth.configured = false;
      loginDemo("ผู้เล่น");
      return Auth;
    }

    const config = await loadConfig();
    Auth.configured = isConfigReady(config);

    if (!Auth.configured) {
      Auth.ready = true;
      return Auth;
    }

    if (!window.firebase) {
      throw new Error("ไม่พบ Firebase SDK");
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    Auth.auth = firebase.auth();
    Auth.db = firebase.firestore();

    await new Promise((resolve) => {
      const unsub = Auth.auth.onAuthStateChanged((user) => {
        Auth.user = user;
        Auth.demo = false;
        Auth.ready = true;
        unsub();
        resolve();
      });
    });

    Auth.auth.onAuthStateChanged(async (user) => {
      Auth.user = user;
      Auth.demo = false;
      if (user) {
        await ensureUserDoc(user);
      }
      window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user } }));
    });

    return Auth;
  }

  async function ensureUserDoc(user) {
    if (!Auth.db || !user) return;
    const ref = Auth.db.collection("users").doc(user.uid);
    const snap = await ref.get();
    const payload = {
      displayName: user.displayName || "ผู้เล่น",
      photoURL: user.photoURL || "",
      email: user.email || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await ref.set(payload);
      await Auth.db
        .collection("stats")
        .doc(user.uid)
        .set({ soloWins: 0, multiWins: 0, onlineWins: 0, displayName: payload.displayName, photoURL: payload.photoURL }, { merge: true });
    } else {
      await ref.set(payload, { merge: true });
    }
  }

  async function loginGoogle() {
    if (!Auth.configured) throw new Error("ยังไม่ได้ตั้งค่า Firebase");
    const provider = new firebase.auth.GoogleAuthProvider();
    await Auth.auth.signInWithPopup(provider);
  }

  async function loginFacebook() {
    if (!Auth.configured) throw new Error("ยังไม่ได้ตั้งค่า Firebase");
    const provider = new firebase.auth.FacebookAuthProvider();
    await Auth.auth.signInWithPopup(provider);
  }

  function loginDemo(name) {
    const DEMO_KEY = "tualek-demo-uid";
    let uid = null;
    try {
      uid = localStorage.getItem(DEMO_KEY);
    } catch {
      uid = null;
    }
    if (!uid) {
      uid = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        localStorage.setItem(DEMO_KEY, uid);
      } catch {
        /* ignore */
      }
    }
    const displayName = String(name || "ผู้เล่นทดลอง").trim().slice(0, 20) || "ผู้เล่นทดลอง";
    Auth.demo = true;
    Auth.user = {
      uid,
      displayName,
      photoURL: "",
      email: "",
      getIdToken: async () => `demo:${displayName}:${uid}`,
    };
    window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: Auth.user } }));
    return Auth.user;
  }

  async function logout() {
    if (Auth.demo) {
      Auth.user = null;
      Auth.demo = false;
      window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: null } }));
      return;
    }
    if (Auth.auth) await Auth.auth.signOut();
  }

  async function getIdToken() {
    if (!Auth.user) return null;
    if (Auth.demo) return Auth.user.getIdToken();
    return Auth.user.getIdToken(true);
  }

  async function fetchLeaderboard(mode) {
    const key = mode === "multi" ? "multiWins" : mode === "online" ? "onlineWins" : "soloWins";
    try {
      const res = await fetch(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rows)) return data.rows;
      }
    } catch {
      /* fall through */
    }

    if (!Auth.db) return [];
    const snap = await Auth.db.collection("stats").orderBy(key, "desc").limit(20).get();
    return snap.docs.map((doc, index) => {
      const data = doc.data() || {};
      return {
        uid: doc.id,
        rank: index + 1,
        name: data.displayName || "ผู้เล่น",
        photoURL: data.photoURL || "",
        wins: Number(data[key] || 0),
      };
    });
  }

  window.TualekAuth = {
    AUTH_REQUIRED,
    init,
    loginGoogle,
    loginFacebook,
    loginDemo,
    logout,
    getIdToken,
    fetchLeaderboard,
    get state() {
      return Auth;
    },
  };
})();
