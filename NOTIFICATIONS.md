# Timer reminders

Timers remain timestamp-based and keep counting after a tab closes. Presence reports connectivity separately. Offline profiles explicitly say when their timer is running. Returning to an active timer shows Continue and End session controls; Continue dismisses the reminder without resetting time.

The room updates the browser tab title, shows in-app transition notifications, and plays soft Web Audio chimes after user interaction. Settings include mute, volume, a sound preview and opt-in desktop notifications. Preferences are local to the device. Browsers with Web Locks coordinate audible/desktop alerts across tabs; other browsers use best-effort localStorage deduplication.

Desktop notifications require HTTPS and permission. In-app reminders still work if permission is denied or the Notification constructor is unsupported. Sound cannot bypass device mute or browser autoplay policy. These reminders run while the room is mounted; they do not run after closing the browser or navigating to history. Background suspension can delay them.

## Closed-browser push: pending server access

Closed-browser notifications are not enabled by this change. Activation requires Supabase administrator access, which is not available in this workspace. The production setup should include:

1. A web app manifest and scoped service worker to receive push messages and open the room. iPhone users must install the app to the Home Screen and opt in.
2. Per-device Push API subscriptions stored in a private table, tied to the authenticated profile, with RLS and explicit unsubscribe on identity changes.
3. VAPID signing keys held only in server secrets (public application key supplied to the client).
4. A transactional notification queue keyed by profile, phase and deadline. Timer commands must cancel/revise pending entries when pausing, ending or resuming.
5. A scheduled server dispatcher that rechecks authoritative timer state, sends due focus/break reminders, retries transient failures and removes expired subscriptions. Never rely on an open browser to settle or dispatch reminders.
6. Verification on the actual iPhone/Android device with the browser closed, including pause/cancel races and duplicate delivery handling.

Push delivery is best effort and can be delayed by the OS/network. Do not promise an exact-time alarm or advertise closed-browser reminders until the deployed dispatcher and device delivery are verified.
