/**
 * Deploy push notification infrastructure to Supabase.
 *
 * Usage:
 *   node --env-file=.env.local scripts/deploy-push.ts
 *
 * This script:
 *   1. Runs the push migration SQL via the Management API
 *   2. Deploys the push-dispatch Edge Function
 *   3. Sets up the pg_cron job to invoke it every minute
 */
import fs from 'fs';
import path from 'path';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;

if (!accessToken || !supabaseUrl) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or VITE_SUPABASE_URL in .env.local');
  process.exit(1);
}

const ref = new URL(supabaseUrl).hostname.split('.')[0];
const mgmtBase = `https://api.supabase.com/v1/projects/${ref}`;
const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
};

async function runSQL(sql) {
  const res = await fetch(`${mgmtBase}/database/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Step 1: Run the migration SQL (tables, RLS, functions)
console.log('Step 1: Applying push migration…');
const migrationSql = fs.readFileSync(
  path.resolve('supabase/migrations/202609190003_push.sql'),
  'utf-8',
);

// Split the migration: tables/RLS/functions go first, cron scheduling goes second
// because cron needs the Edge Function deployed first.
const cronSplit = migrationSql.indexOf('-- Enable the pg_net extension');
const schemaSql = cronSplit > 0 ? migrationSql.slice(0, cronSplit) : migrationSql;

try {
  await runSQL(schemaSql);
  console.log('  ✓ Tables, RLS policies, and functions created.');
} catch (err) {
  // Tables might already exist
  if (err.message.includes('already exists')) {
    console.log('  ⓘ Schema objects already exist, continuing.');
  } else {
    console.error('  ✗', err.message);
    process.exit(1);
  }
}

// Step 2: Deploy the Edge Function
console.log('Step 2: Deploying push-dispatch Edge Function…');
const functionCode = fs.readFileSync(
  path.resolve('supabase/functions/push-dispatch/index.ts'),
  'utf-8',
);

// The Management API expects the function to be created/updated
// Try to create, if it exists, update it
for (const method of ['POST', 'PATCH']) {
  const url = method === 'POST'
    ? `${mgmtBase}/functions`
    : `${mgmtBase}/functions/push-dispatch`;
  
  const bodyObj = {
    slug: 'push-dispatch',
    name: 'push-dispatch',
    verify_jwt: false,  // Called by pg_cron, not user sessions
    body: functionCode,
  };
  
  if (method === 'PATCH') {
    delete bodyObj.slug;
    delete bodyObj.name;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(bodyObj),
  });

  if (res.ok) {
    console.log(`  ✓ Edge Function deployed (${method}).`);
    break;
  }

  const text = await res.text();
  if (method === 'POST' && (text.includes('already exists') || res.status === 409)) {
    // Try PATCH to update
    continue;
  }
  if (method === 'PATCH') {
    console.warn(`  ⚠ Could not deploy via Management API: ${text}`);
    console.log('  ⓘ You may need to deploy via Supabase CLI: npx supabase functions deploy push-dispatch');
  }
}

// Step 3: Get service role key and set up cron
console.log('Step 3: Setting up pg_cron dispatcher…');
// Fetch the service role key via API keys endpoint
const keysRes = await fetch(`${mgmtBase}/api-keys`, { headers });
if (!keysRes.ok) {
  console.error('  ✗ Could not fetch API keys:', await keysRes.text());
  process.exit(1);
}

const keys = await keysRes.json();
const serviceRoleKey = keys.find(k => k.name === 'service_role')?.api_key;
if (!serviceRoleKey) {
  console.error('  ✗ Service role key not found.');
  process.exit(1);
}

// Set up the cron job using pg_net for HTTP calls
const cronSql = `
-- Ensure pg_net is available
create extension if not exists pg_net with schema extensions;

-- Remove old cron job if it exists
select cron.unschedule('push-dispatch') where exists (
  select 1 from cron.job where jobname = 'push-dispatch'
);

-- Schedule push-dispatch every minute
select cron.schedule(
  'push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := '${supabaseUrl}/functions/v1/push-dispatch',
    headers := '{"Authorization": "Bearer ${serviceRoleKey}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
`;

try {
  await runSQL(cronSql);
  console.log('  ✓ pg_cron job created (every 60 seconds).');
} catch (err) {
  console.error('  ✗ Cron setup failed:', err.message);
  console.log('  ⓘ You may need to enable pg_cron and pg_net extensions in the Supabase dashboard.');
  console.log('    Then run this SQL manually in the SQL Editor:');
  console.log(cronSql);
}

console.log('\n✅ Push notification infrastructure deployed.');
console.log('Open the app, go to Settings, and enable "Phone notifications" to test.');
