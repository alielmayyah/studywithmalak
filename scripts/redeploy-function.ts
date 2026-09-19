/**
 * Redeploy the push-dispatch Edge Function after code changes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/redeploy-function.ts
 */
import fs from 'fs';
import path from 'path';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const ref = new URL(supabaseUrl).hostname.split('.')[0];
const mgmtBase = `https://api.supabase.com/v1/projects/${ref}`;

const functionCode = fs.readFileSync(
  path.resolve('supabase/functions/push-dispatch/index.ts'),
  'utf-8',
);

// Try PATCH first (update existing), then POST (create new)
for (const [method, url] of [
  ['PATCH', `${mgmtBase}/functions/push-dispatch`],
  ['POST', `${mgmtBase}/functions`],
]) {
  const body = method === 'PATCH'
    ? { verify_jwt: false, body: functionCode }
    : { slug: 'push-dispatch', name: 'push-dispatch', verify_jwt: false, body: functionCode };

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log(`✓ Edge Function deployed via ${method}.`);
    process.exit(0);
  }
  console.log(`${method} ${res.status}:`, await res.text());
}

console.error('✗ Could not deploy. Try: npx supabase functions deploy push-dispatch');
process.exit(1);
