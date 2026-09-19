# Ali × Malak

A private shared study room. Two people can see each other online, study side by side, pause, and review their time together.

## Stack

React, Vite, TypeScript, Tailwind CSS, Supabase Auth/Postgres/Realtime, and GitHub Pages.

## Set up Supabase

1. Create a Supabase project. Apply [`supabase/migrations/202609190001_init.sql`](supabase/migrations/202609190001_init.sql), then [`supabase/migrations/202609190002_pomodoro.sql`](supabase/migrations/202609190002_pomodoro.sql), in the SQL editor or with the Supabase CLI.
2. In Authentication → Providers, enable **Anonymous Sign-Ins**. The app creates anonymous Supabase Auth sessions and unlocks a stable Ali or Malak profile with a private passcode.
3. Replace the passcode placeholders in [`supabase/seed.sql`](supabase/seed.sql) with long, distinct random passcodes, then run it in the SQL editor. It stores only salted hashes and creates the room and memberships. Keep the passcodes outside Git and give each person only their own.
4. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase Project Settings → API. These are public client values. Never use a service role key in the frontend.
5. In Supabase Realtime settings, enable private channels. The migration creates room-scoped authorization policies for Presence and enables Postgres changes for the study tables.

The identity choice is a remembered preference. Actual access is enforced by a passcode check in Postgres and room membership. Passcodes are never saved in browser storage. Losing an anonymous browser session is safe: enter the same passcode again to unlock the stable profile and its history.

## Develop

```bash
npm install
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.

## Deploy to GitHub Pages

Push to `main`, set GitHub repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then select **GitHub Actions** as the Pages build source. The workflow runs checks and deploys `dist`. Vite derives the repository base path from `GITHUB_REPOSITORY`; HashRouter keeps deep links working on static hosting. Add the published `https://OWNER.github.io/REPOSITORY/**` URL to Supabase Auth redirect URLs.

No backend server is required. Live Presence and timer updates require a connected Supabase project. Pomodoro actions run through a database function. Hiding or closing a tab sends a Presence leave; abrupt network loss depends on the server detecting a lost socket.
