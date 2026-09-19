/**
 * Generate VAPID keys and store them as Supabase project secrets.
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-vapid-keys.ts
 *
 * Requires:
 *   - SUPABASE_ACCESS_TOKEN in .env.local
 *   - VITE_SUPABASE_URL in .env.local (to derive project ref)
 */
import webpush from 'web-push';
import fs from 'fs';
import path from 'path';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;

if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(1);
}
if (!supabaseUrl) {
  console.error('Missing VITE_SUPABASE_URL in .env.local');
  process.exit(1);
}

// Extract project ref from the Supabase URL (e.g. https://abcdef.supabase.co → abcdef)
const ref = new URL(supabaseUrl).hostname.split('.')[0];
console.log(`Project ref: ${ref}`);

// Generate VAPID keys
const vapidKeys = webpush.generateVAPIDKeys();
console.log('Generated VAPID keys.');
console.log(`Public key:  ${vapidKeys.publicKey}`);

// Store as Supabase secrets via Management API
const secrets = [
  { name: 'VAPID_PUBLIC_KEY', value: vapidKeys.publicKey },
  { name: 'VAPID_PRIVATE_KEY', value: vapidKeys.privateKey },
  { name: 'VAPID_SUBJECT', value: 'mailto:ali@studywithmalak.app' },
];

const response = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/secrets`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(secrets),
  },
);

if (!response.ok) {
  const text = await response.text();
  console.error(`Failed to store secrets: ${response.status} ${text}`);
  process.exit(1);
}

console.log('Secrets stored in Supabase.');

// Append VITE_VAPID_PUBLIC_KEY to .env.local if not already present
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
if (!envContent.includes('VITE_VAPID_PUBLIC_KEY=')) {
  fs.appendFileSync(envPath, `\nVITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}\n`);
  console.log('Added VITE_VAPID_PUBLIC_KEY to .env.local');
} else {
  console.log('VITE_VAPID_PUBLIC_KEY already in .env.local — update it manually if needed:');
  console.log(`  VITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
}

console.log('\nDone. Next steps:');
console.log('  1. Apply the push migration in Supabase SQL Editor');
console.log('  2. Deploy the push-dispatch Edge Function');
console.log('  3. Enable push notifications in the app settings');
