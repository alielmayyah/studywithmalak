# Shared study room redesign

The room uses Ali's blue and Malak's pink identities, the existing personal wallpapers across login/room/history, and tinted glass surfaces. These reflect the follow-up requests for pink, visible wallpapers and glass cards. Global colors are centralized in `src/styles.css`.

The original avatar and wallpaper source assets were preserved. The new Malak avatar is `public/avatars/malak-pink.png`, used through `src/lib/avatars.ts` in both login and room views.

## Avatar edit

Created with the built-in imagegen tool using `public/avatars/malak.webp` as the edit target. Final prompt:

> Use case: precise-object-edit. Asset type: existing circular 3D avatar for a private study app. Input image 1 is the edit target. Change ONLY the warm coral/peach circular background behind Malak to a calm soft dusty rose PINK, approximately #D991B1 with natural gentle shading. Preserve her exact face, skin tone, eyes, smile, gray hijab, white outfit, pose, lighting, proportions and crop. Keep the same circular composition and clean edges. Do not tint the character pink. No additional objects, text or decorations. Output a square avatar image.

## Verification

- Lint, TypeScript, 14 unit tests and production build pass.
- Browser layout checks and screenshot review at 1440, 1280, 1024, 768, 390 and 360 pixels.
- Fixture-based browser checks cover focus, idle, pause, break, partner focus, offline, connecting and reconnecting; both identities; custom duration validation; status keyboard navigation; settings; reduced motion; and outgoing timer command payloads.
- Login checked with both identities on desktop and mobile.
- Browser fixtures do not verify a live two-person Supabase session. Existing transaction/locking logic is retained; no database migrations were changed or applied.
- Build retains existing non-fatal React Router directive and bundle-size warnings.
