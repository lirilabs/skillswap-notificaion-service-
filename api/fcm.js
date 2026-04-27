import admin from "firebase-admin";

/* ======================================================
   SAFE FIREBASE INIT (SERVERLESS FRIENDLY)
====================================================== */
function getFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin;
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("Missing FIREBASE_PRIVATE_KEY");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });

  return admin;
}

/* ======================================================
   HANDLER
====================================================== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const firebase = getFirebaseAdmin();

    const {
      token,
      title,
      body,
      imageUrl,
      clickAction,
      data = {},
    } = req.body || {};

    if (!token || !title || !body) {
      return res.status(400).json({
        error: "token, title and body are required",
      });
    }

    const message = {
      token,
      notification: {
        title,
        body,
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

    const messageId = await firebase.messaging().send(message);

    return res.status(200).json({
      success: true,
      messageId,
    });

  } catch (err) {
    console.error("🔥 FCM ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Unknown error",
    });
  }
}
