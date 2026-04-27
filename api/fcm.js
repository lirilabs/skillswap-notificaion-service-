import admin from "firebase-admin";

/* ======================================================
   SAFE SINGLETON INIT (SERVERLESS)
====================================================== */
let firebaseApp;

function initFirebase() {
  if (firebaseApp) return firebaseApp;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  // 🔍 Validate ENV (prevents silent crash)
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing Firebase environment variables");
  }

  // 🔥 CRITICAL FIX: clean key
  const privateKey = FIREBASE_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "");

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  return firebaseApp;
}

/* ======================================================
   HANDLER
====================================================== */
export default async function handler(req, res) {
  // 🌐 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    // 🔥 Init Firebase safely
    initFirebase();

    // 🔥 Ensure body parsing works in Vercel
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      token,
      title,
      body: messageBody,
      imageUrl,
      clickAction,
      data = {},
    } = body || {};

    if (!token || !title || !messageBody) {
      return res.status(400).json({
        error: "token, title, body required",
      });
    }

    // 📦 Build FCM message
    const message = {
      token,
      notification: {
        title,
        body: messageBody,
        ...(imageUrl && { image: imageUrl }),
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        ...(clickAction && { click_action: clickAction }),
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",
          ...(imageUrl && { imageUrl }),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            mutableContent: true,
          },
        },
        fcmOptions: {
          ...(imageUrl && { image: imageUrl }),
        },
      },
    };

    // 🚀 Send notification
    const messageId = await admin.messaging().send(message);

    return res.status(200).json({
      success: true,
      messageId,
    });

  } catch (err) {
    console.error("🔥 FULL ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack, // 🔥 critical for debugging
    });
  }
}
