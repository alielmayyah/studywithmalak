/**
 * Enable pg_cron and pg_net extensions, then set up the cron job.
 *
 * Usage:
 *   node --env-file=.env.local scripts/setup-cron.ts
 */

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
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
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text}`);
  return text;
}

// Step 1: Enable pg_cron extension
console.log('Enabling pg_cron extension…');
try {
  await runSQL("create extension if not exists pg_cron with schema pg_catalog;");
  console.log('  ✓ pg_cron enabled.');
} catch (err) {
  console.log('  pg_cron enable result:', err.message);
  // Some Supabase projects need it enabled via dashboard
  // Try the extensions API instead
  console.log('  Trying via extensions API…');
  const res = await fetch(`${mgmtBase}/extensions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'pg_cron', schema: 'pg_catalog' }),
  });
  console.log('  Extensions API:', res.status, await res.text());
}

// Step 2: Enable pg_net extension
console.log('Enabling pg_net extension…');
try {
  await runSQL("create extension if not exists pg_net with schema extensions;");
  console.log('  ✓ pg_net enabled.');
} catch (err) {
  console.log('  pg_net enable result:', err.message);
}

// Step 3: Get service role key
console.log('Fetching service role key…');
const keysRes = await fetch(`${mgmtBase}/api-keys`, { headers });
const keys = await keysRes.json();
const serviceRoleKey = keys.find(k => k.name === 'service_role')?.api_key;
if (!serviceRoleKey) {
  console.error('Could not find service role key.');
  process.exit(1);
}

// Step 4: Create cron job
console.log('Creating cron job…');
const cronSql = `
select cron.schedule(
  'push-dispatch',
  '* * * * *',
  $CRON$
  select net.http_post(
    url := '${supabaseUrl}/functions/v1/push-dispatch',
    headers := '{"Authorization": "Bearer ${serviceRoleKey}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $CRON$
);
`;

try {
  const result = await runSQL(cronSql);
  console.log('  ✓ Cron job created:', result);
} catch (err) {
  console.error('  ✗ Cron failed:', err.message);
  console.log('\nIf pg_cron is not available, enable it in the Supabase Dashboard:');
  console.log('  Database → Extensions → Search "pg_cron" → Enable');
  console.log('  Database → Extensions → Search "pg_net" → Enable');
  console.log('  Then re-run this script.');
}

console.log('\nDone.');
