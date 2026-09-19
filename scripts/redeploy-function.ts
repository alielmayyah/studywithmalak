/**
 * Redeploy the push-dispatch Edge Function after code changes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/redeploy-function.ts
 */
import { execSync } from 'child_process';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;

if (!accessToken || !supabaseUrl) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or VITE_SUPABASE_URL in .env.local');
  process.exit(1);
}

const ref = new URL(supabaseUrl).hostname.split('.')[0];

console.log(`Deploying push-dispatch Edge Function to ${ref}...`);

try {
  execSync(`npx supabase functions deploy push-dispatch --project-ref ${ref} --no-verify-jwt`, {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
  });
  console.log('✓ Edge Function deployed successfully.');
} catch (err) {
  console.error('✗ Deployment failed:', err);
  process.exit(1);
}
