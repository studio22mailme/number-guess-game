(() => {
  // หน้าแรกเกมนี้ยังไม่บังคับล็อกอิน (คนเดียว / ส่งเครื่อง = แขกได้)
  // อนาคตเว็ปรวมเกมจะบังคับล็อกอินตั้งแต่หน้าแรกพอร์ทัลแทน
  const AUTH_REQUIRED = false;
  // โหมดคนละเครื่องต้องล็อกอิน Google / Facebook จริง
  const ONLINE_AUTH_REQUIRED = true;

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

  function isRealUser() {
    return Boolean(Auth.user && !Auth.demo);
  }

  async function init() {
    const config = await loadConfig();
    Auth.configured = isConfigReady(config);

    if (!Auth.configured) {
      Auth.ready = true;
      if (!AUTH_REQUIRED) loginDemo("ผู้เล่น");
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

    try {
      const redirect = await Auth.auth.getRedirectResult();
      if (redirect?.user) {
        Auth.user = redirect.user;
        Auth.demo = false;
        await ensureUserDoc(redirect.user);
      }
    } catch (error) {
      console.error("Firebase redirect result:", error);
    }

    await new Promise((resolve) => {
      const unsub = Auth.auth.onAuthStateChanged((user) => {
        if (user) {
          Auth.user = user;
          Auth.demo = false;
        } else if (!AUTH_REQUIRED) {
          loginDemo("ผู้เล่น");
        } else {
          Auth.user = null;
          Auth.demo = false;
        }
        Auth.ready = true;
        unsub();
        resolve();
      });
    });

    Auth.auth.onAuthStateChanged(async (user) => {
      if (user) {
        Auth.user = user;
        Auth.demo = false;
        await ensureUserDoc(user);
        window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user } }));
        return;
      }
      if (AUTH_REQUIRED) {
        Auth.user = null;
        Auth.demo = false;
        window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: null } }));
        return;
      }
      // ออกจากระบบจริง → กลับเป็นแขกสำหรับโหมดคนเดียว/ส่งเครื่อง
      loginDemo("ผู้เล่น");
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
        .set(
          {
            soloWins: 0,
            multiWins: 0,
            onlineWins: 0,
            displayName: payload.displayName,
            photoURL: payload.photoURL,
          },
          { merge: true }
        );
    } else {
      await ref.set(payload, { merge: true });
    }
  }

  async function signInWithProvider(provider) {
    if (!Auth.configured || !Auth.auth) throw new Error("ยังไม่ได้ตั้งค่า Firebase");
    if (location.protocol === "file:") {
      throw new Error(
        "เปิดเกมผ่าน http://localhost:3000 เท่านั้น (อย่าดับเบิลคลิกไฟล์ index.html)"
      );
    }
    try {
      await Auth.auth.signInWithPopup(provider);
    } catch (error) {
      const code = error?.code || "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        await Auth.auth.signInWithRedirect(provider);
        return;
      }
      throw error;
    }
  }

  async function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithProvider(provider);
  }

  async function loginFacebook() {
    const provider = new firebase.auth.FacebookAuthProvider();
    await signInWithProvider(provider);
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
      if (!AUTH_REQUIRED) {
        loginDemo("ผู้เล่น");
        return;
      }
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

  async function fetchLeaderboard(mode, difficulty = "normal") {
    const diff = difficulty === "easy" || difficulty === "hard" || difficulty === "extreme" ? difficulty : "normal";
    const modeKey = mode === "multi" ? "multiWins" : mode === "online" ? "onlineWins" : "soloWins";
    const key = `${modeKey}_${diff}`;
    const minutesKey = `${key}_minutes`;
    try {
      const res = await fetch(
        `/api/leaderboard?mode=${encodeURIComponent(mode)}&difficulty=${encodeURIComponent(diff)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rows)) return data.rows;
      }
    } catch {
      /* fall through */
    }

    if (!Auth.db) return [];
    try {
      const snap = await Auth.db.collection("stats").orderBy(key, "desc").limit(20).get();
      return snap.docs
        .map((doc, index) => {
          const data = doc.data() || {};
          return {
            uid: doc.id,
            rank: index + 1,
            name: data.displayName || "ผู้เล่น",
            photoURL: data.photoURL || "",
            wins: Number(data[key] || 0),
            minutes: Number(data[minutesKey] || 0),
          };
        })
        .filter((row) => row.wins > 0);
    } catch {
      return [];
    }
  }

  window.TualekAuth = {
    AUTH_REQUIRED,
    ONLINE_AUTH_REQUIRED,
    init,
    loginGoogle,
    loginFacebook,
    loginDemo,
    logout,
    getIdToken,
    fetchLeaderboard,
    isRealUser,
    get state() {
      return Auth;
    },
  };
})();
