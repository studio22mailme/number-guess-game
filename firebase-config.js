/* ค่านี้ถูกแทนที่ด้วย /api/firebase-config จากเซิร์ฟเวอร์ (env บน Render)
   หรือใส่ค่าจาก Firebase Console ตรงนี้ชั่วคราวตอนพัฒนา */
window.FIREBASE_WEB_CONFIG = window.FIREBASE_WEB_CONFIG || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
