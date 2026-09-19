import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True when the browser and environment support push subscriptions. */
export function pushSupported(): boolean {
  return Boolean(
    VAPID_PUBLIC_KEY &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      window.isSecureContext,
  );
}

/** Register the service worker (idempotent). */
async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}sw.js`,
    { scope: import.meta.env.BASE_URL },
  );
  // Wait for the service worker to be active
  if (!reg.active) {
    await new Promise<void>((resolve) => {
      const sw = reg.installing || reg.waiting;
      if (!sw) {
        resolve();
        return;
      }
      sw.addEventListener("statechange", () => {
        if (sw.state === "activated") resolve();
      });
    });
  }
  return reg;
}

/**
 * Subscribe to push notifications.
 * Returns the subscription endpoint if successful, or null on failure.
 */
export async function subscribeToPush(
  profileId: string,
): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await ensureServiceWorker();
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;

    // Store in Supabase (upsert by profile + endpoint)
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        profile_id: profileId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: "profile_id,endpoint" },
    );
    if (error) {
      console.error("Failed to store push subscription:", error);
      return null;
    }
    return json.endpoint;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return null;
  }
}

/**
 * Unsubscribe from push notifications on this device.
 */
export async function unsubscribeFromPush(
  profileId: string,
): Promise<boolean> {
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration(
        import.meta.env.BASE_URL,
      );
      const subscription = await reg?.pushManager.getSubscription();
      if (subscription) {
        // Remove from DB
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("profile_id", profileId)
          .eq("endpoint", subscription.endpoint);
        await subscription.unsubscribe();
      }
    }
    return true;
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
    return false;
  }
}

/**
 * Check if this device currently has an active push subscription stored in Supabase.
 */
export async function getPushStatus(profileId: string): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(
      import.meta.env.BASE_URL,
    );
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return false;

    const { data } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("profile_id", profileId)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Check if running on an iOS device (iPhone, iPad, iPod). */
export function isIOS(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Check if running in standalone display mode (added to Home Screen). */
export function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    Boolean((navigator as unknown as { standalone?: boolean }).standalone) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/** Trigger an immediate test push notification to this user's subscribed devices. */
export async function sendTestNotification(
  profileId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("push-dispatch", {
      body: { action: "test", profile_id: profileId },
    });
    if (error) {
      return { success: false, message: error.message || "Failed to send test notification." };
    }
    if (data?.error) {
      return { success: false, message: data.error };
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

/** Check if the other room member has registered at least one push device. */
export async function getPartnerPushStatus(roomId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("partner_push_status", {
      p_room: roomId,
    });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

