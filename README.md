# เกมท้ายตัวเลข (Tualek)

ทายตัวเลข 4 หลัก มีโหมด คนเดียว / ส่งเครื่อง / คนละเครื่อง  
เว็บบังคับล็อกอิน เก็บสถิติชนะแยกโหมด และมีล็อบบี้ห้องออนไลน์

## รันบนเครื่อง

```bash
npm install
npm start
```

เปิด `http://localhost:3000`

ถ้ายังไม่ตั้งค่า Firebase จะมีปุ่ม **เข้าเล่นแบบทดลอง**

## ตั้งค่า Firebase (จำเป็นสำหรับ Google / Facebook จริง)

### 1) สร้างโปรเจกต์
1. ไปที่ [Firebase Console](https://console.firebase.google.com/)
2. สร้างโปรเจกต์ใหม่
3. เพิ่มแอป **Web** แล้วคัดลอกค่า config

### 2) เปิด Authentication
1. Authentication → Sign-in method
2. เปิด **Google**
3. เปิด **Facebook** (ต้องมี Facebook App ID / App Secret จาก [Meta Developers](https://developers.facebook.com/))
4. ใส่ Authorized domain: `tualek.onrender.com` และ `localhost`

### 3) สร้าง Firestore
1. Firestore Database → สร้างแบบ production หรือ test
2. แนะนำกฎเริ่มต้นให้อ่านสถิติได้ เขียนผ่านเซิร์ฟเวอร์เท่านั้น:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /stats/{uid} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

### 4) Service Account สำหรับเซิร์ฟเวอร์
1. Project settings → Service accounts → Generate new private key
2. คัดลอก JSON ทั้งก้อน ไปใส่เป็น env บน Render ชื่อ `FIREBASE_SERVICE_ACCOUNT`

### 5) Env บน Render
ตั้งค่า Environment Variables:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT` = JSON ทั้งก้อนของ service account
- `ALLOW_DEMO_AUTH=0` (ปิดโหมดทดลองเมื่อขึ้น production)

จากนั้น Redeploy

## ฟีเจอร์สมาชิก / ล็อบบี้

- เข้าเว็บต้องล็อกอินก่อน
- ลีดเดอร์บอร์ดหน้าแรกเปลี่ยนตามปุ่มโหมด (คนเดียว / ส่งเครื่อง / คนละเครื่อง)
- คนละเครื่อง: เห็นรายชื่อห้อง, ชื่อห้อง, รหัส, ห้องที่มีรหัสผ่าน
- สร้างห้องตั้งชื่อ + รหัสผ่านได้ (ว่าง = ห้องเปิด)
- ชนะแล้วระบบบันทึกสถิติ

## Wi‑Fi บ้าน / อินเทอร์เน็ต

- บ้าน: `npm start` แล้วให้เพื่อนเข้า IP ที่เทอร์มินัลโชว์
- อินเทอร์เน็ต: Deploy บน Render ตาม `render.yaml`

## ไฟล์สำคัญ

- `index.html` / `styles.css` / `game.js` — หน้าเกม
- `auth.js` / `firebase-config.js` — สมาชิก
- `server.js` — WebSocket + API สถิติ/ห้อง
- `package.json` — `npm start`
