import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const CHUNK_SIZE = 500; // FCM sendEach max

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { tokens, title, body, imageUrl, clickAction, data = {} } = req.body || {};

  if (!Array.isArray(tokens) || !tokens.length || !title || !body) {
    return res.status(400).json({ error: "tokens (array), title and body are required" });
  }

  if (tokens.length > 100_000) {
    return res.status(400).json({ error: "Max 100,000 tokens per request" });
  }

  const baseMessage = {
    notification: {
      title,
      body,
      ...(imageUrl ? { image: imageUrl } : {}),
    },
    data: {
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      ...(clickAction ? { click_action: clickAction } : {}),
    },
    android: {
      priority: "high",
      notification: { sound: "default", channelId: "default", ...(imageUrl ? { imageUrl } : {}) },
    },
    apns: {
      payload: { aps: { sound: "default", mutableContent: true } },
      fcmOptions: { ...(imageUrl ? { image: imageUrl } : {}) },
    },
  };

  const chunks = chunk(tokens, CHUNK_SIZE);
  let successCount = 0;
  let failureCount = 0;
  const failures = [];

  // Process chunks with controlled concurrency (5 at a time)
  const CONCURRENCY = 5;
  const queue = [...chunks.entries()];

  const processQueue = async () => {
    while (queue.length) {
      const [chunkIdx, tokenBatch] = queue.shift();
      const messages = tokenBatch.map((token) => ({ ...baseMessage, token }));
      try {
        const result = await admin.messaging().sendEach(messages);
        successCount += result.successCount;
        failureCount += result.failureCount;
        result.responses.forEach((r, i) => {
          if (!r.success) {
            failures.push({
              token: tokenBatch[i].slice(0, 12) + "...", // truncate for privacy
              error: r.error?.message || "unknown",
              batch: chunkIdx,
            });
          }
        });
      } catch (err) {
        // Whole batch failed (e.g. network error)
        failureCount += tokenBatch.length;
        failures.push({ batch: chunkIdx, tokens: tokenBatch.length, error: err.message });
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, processQueue);
  await Promise.all(workers);

  return res.status(200).json({
    success: true,
    total: tokens.length,
    successCount,
    failureCount,
    batches: chunks.length,
    failures: failures.slice(0, 50), // cap response size
    ...(failures.length > 50 ? { failuresTruncated: true } : {}),
  });
}
