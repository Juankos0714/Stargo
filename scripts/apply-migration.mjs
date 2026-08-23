/**
 * Ejecuta la migración SQL directamente contra Supabase vía pg (connection string).
 * Solo funciona con la connection string directa de Supabase.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Supabase direct connection: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
// We use the REST API approach instead since we don't have the DB password.

const SUPABASE_URL = 'https://uwfjfkcytohrjnyspkkt.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3Zmpma2N5dG9ocmpueXNwa2t0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTk1Njg3NiwiZXhwIjoyMTAxNTMyODc2fQ.lmpSW57ioL_uA886SDfS07QWSRau2holNXCVAM0N40E';

const sql = readFileSync(resolve(ROOT, 'supabase/migrations/20260825000000_fix_constraints_rls_pendientes.sql'), 'utf-8');

// Execute each statement individually via PostgREST RPC
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

console.log(`Found ${statements.length} statements to execute.`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  // Skip comments-only chunks
  const lines = stmt.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
  if (lines.length === 0) continue;
  
  console.log(`\n[${i + 1}/${statements.length}] Executing...`);
  console.log(`  ${lines[0].slice(0, 80)}...`);
  
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: stmt + ';' })
    });
    
    if (res.ok) {
      const body = await res.json().catch(() => null);
      console.log(`  ✅ OK`, body ? JSON.stringify(body).slice(0, 100) : '');
    } else {
      const err = await res.text();
      console.log(`  ❌ HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
  }
}
