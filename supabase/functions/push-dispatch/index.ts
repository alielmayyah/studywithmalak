/**
 * Push Dispatch Edge Function
 *
 * Called every 60s by pg_cron. Queries for due timer notifications,
 * sends Web Push messages to all subscribed devices, and logs delivery.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:ali@studywithmalak.app";

// --- Minimal Web Push implementation for Deno (no npm dependency) ---

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function uint8ArrayToUrlBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importVapidKeys() {
  const publicKeyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const privateKeyBytes = urlBase64ToUint8Array(VAPID_PRIVATE_KEY);

  // Build the raw private key (PKCS8 isn't needed — we use raw JWK import)
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: uint8ArrayToUrlBase64(publicKeyBytes.slice(1, 33)),
    y: uint8ArrayToUrlBase64(publicKeyBytes.slice(33, 65)),
    d: uint8ArrayToUrlBase64(privateKeyBytes),
  };

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  return { privateKey, publicKeyBytes };
}

async function createVapidAuthHeader(audience: string, vapidPrivateKey: CryptoKey) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 86400, sub: VAPID_SUBJECT };

  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToUrlBase64(encoder.encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToUrlBase64(encoder.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapidPrivateKey,
    encoder.encode(unsignedToken),
  );

  // Convert DER signature to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;

  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  } else {
    // DER format: 0x30 len 0x02 rLen r 0x02 sLen s
    let offset = 2; // skip 0x30 + total length
    offset += 1; // skip 0x02
    const rLen = sigBytes[offset++];
    const rRaw = sigBytes.slice(offset, offset + rLen);
    offset += rLen;
    offset += 1; // skip 0x02
    const sLen = sigBytes[offset++];
    const sRaw = sigBytes.slice(offset, offset + sLen);

    r = new Uint8Array(32);
    s = new Uint8Array(32);
    r.set(rRaw.length > 32 ? rRaw.slice(rRaw.length - 32) : rRaw, 32 - Math.min(rRaw.length, 32));
    s.set(sRaw.length > 32 ? sRaw.slice(sRaw.length - 32) : sRaw, 32 - Math.min(sRaw.length, 32));
  }

  const rawSig = new Uint8Array(64);
  rawSig.set(r, 0);
  rawSig.set(s, 32);

  const jwt = `${unsignedToken}.${uint8ArrayToUrlBase64(rawSig)}`;
  return { authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}` };
}

async function encryptPayload(
  payload: string,
  subscriptionKey: string,
  subscriptionAuth: string,
) {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);

  // Import subscription public key
  const clientPublicKeyBytes = urlBase64ToUint8Array(subscriptionKey);
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Generate ephemeral key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    localKeyPair.privateKey,
    256,
  );

  const authBytes = urlBase64ToUint8Array(subscriptionAuth);
  const localPublicKeyRaw = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

  // HKDF helper
  async function hkdf(salt: Uint8Array, ikm: ArrayBuffer, info: Uint8Array, length: number) {
    const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prk = await crypto.subtle.sign("HMAC", key, ikm);
    const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const infoWithCounter = new Uint8Array([...info, 1]);
    const okm = await crypto.subtle.sign("HMAC", prkKey, infoWithCounter);
    return new Uint8Array(okm).slice(0, length);
  }

  // PRK for auth
  const authInfo = encoder.encode("Content-Encoding: auth\0");
  const prk = await hkdf(authBytes, sharedSecret, authInfo, 32);

  // Build key info and nonce info (RFC 8291)
  const keyInfoBuf = new Uint8Array([
    ...encoder.encode("Content-Encoding: aes128gcm\0"),
    ...encoder.encode("P-256\0"),
    0, 65, ...clientPublicKeyBytes,
    0, 65, ...localPublicKeyBytes,
  ]);

  const nonceInfoBuf = new Uint8Array([
    ...encoder.encode("Content-Encoding: nonce\0"),
    ...encoder.encode("P-256\0"),
    0, 65, ...clientPublicKeyBytes,
    0, 65, ...localPublicKeyBytes,
  ]);

  // Salt for this message
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cekBytes = await hkdf(salt, prk, keyInfoBuf, 16);
  const nonceBytes = await hkdf(salt, prk, nonceInfoBuf, 12);

  const cek = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM" }, false, ["encrypt"]);

  // Pad the payload (add a delimiter byte 0x02 per RFC 8188)
  const padded = new Uint8Array([...payloadBytes, 2]);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBytes },
    cek,
    padded,
  );

  // aes128gcm header: salt (16) + rs (4) + idlen (1) + keyid (65) + ciphertext
  const rs = padded.length + 16 + 1; // record size
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs);

  const header = new Uint8Array([
    ...salt,
    ...rsBytes,
    65,
    ...localPublicKeyBytes,
  ]);

  const body = new Uint8Array([...header, ...new Uint8Array(ciphertext)]);

  return body;
}

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPrivateKey: CryptoKey,
) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const { authorization } = await createVapidAuthHeader(audience, vapidPrivateKey);
  const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
    },
    body,
  });

  return response;
}

// --- Main handler ---

Deno.serve(async (req) => {
  // Only accept POST from authorized callers (pg_cron uses service role key)
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.includes(SERVICE_ROLE_KEY) && !authHeader.includes("Bearer")) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { privateKey } = await importVapidKeys();

    // Query due notifications
    const { data: dueNotifications, error: queryError } = await supabase.rpc(
      "due_push_notifications",
    );

    if (queryError) {
      console.error("Query error:", queryError);
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!dueNotifications || dueNotifications.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let removed = 0;

    for (const notification of dueNotifications) {
      const title =
        notification.phase === "focus"
          ? "Focus complete. Take a breath."
          : "Your break is over.";
      const body =
        notification.phase === "focus"
          ? "Your focus time is saved. Time for a little rest."
          : "Ready for another focus session?";

      const payload = JSON.stringify({ title, body, tag: `${notification.profile_id}:${notification.phase}:${notification.deadline_at}` });

      // Get all subscriptions for this user
      const { data: subscriptions } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("profile_id", notification.profile_id);

      if (!subscriptions || subscriptions.length === 0) continue;

      for (const sub of subscriptions) {
        try {
          const response = await sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload,
            privateKey,
          );

          if (response.status === 410 || response.status === 404) {
            // Subscription expired — remove it
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
            removed++;
          } else if (response.ok || response.status === 201) {
            sent++;
          } else {
            console.warn(`Push to ${sub.endpoint} failed: ${response.status}`);
          }
        } catch (pushError) {
          console.error(`Push error for ${sub.endpoint}:`, pushError);
        }
      }

      // Log delivery to prevent duplicates
      await supabase.rpc("log_push_delivery", {
        p_profile_id: notification.profile_id,
        p_phase: notification.phase,
        p_deadline_at: notification.deadline_at,
      });
    }

    // Clean up old push log entries (older than 1 hour)
    await supabase.rpc("cleanup_push_log");

    return new Response(
      JSON.stringify({ sent, removed, processed: dueNotifications.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Dispatch error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
