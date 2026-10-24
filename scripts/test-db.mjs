// CI / no Docker: npm ci --ignore-scripts && npm run test:db && npm run test:db:runner
// Requires the project's Node/npm versions; no credentials, services or disk DB.
// 0.4.6 is the last official PGlite release bundling pgTAP. 0.5.x requires a
// second package. Keep this test-only dependency out of src/ and app bundles.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite/pgtap';

const root = fileURLToPath(new URL('../', import.meta.url));

function checkTap(results) {
  const finishes = results.filter(result => result.fields.some(field => field.name === 'finish'));
  let planned, count = 0;
  for (const result of results) {
    for (const row of result.rows) {
      const values = Object.values(row);
      if (values.length !== 1 || typeof values[0] !== 'string') throw new Error('Unexpected non-TAP SQL result');
      for (const line of values[0].split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue;
        if (/^(?:not ok\b|Bail out!)/i.test(line)) throw new Error(`pgTAP failure: ${line}`);
        const plan = /^1\.\.(\d+)$/.exec(line);
        if (plan) {
          if (planned !== undefined || Number(plan[1]) < 1) throw new Error('Invalid or duplicate TAP plan');
          planned = Number(plan[1]);
          continue;
        }
        const test = /^ok (\d+)(?: - .*)?$/.exec(line);
        if (!test || /#\s*(?:SKIP|TODO)\b/i.test(line)) throw new Error(`Unexpected or skipped TAP result: ${line}`);
        count++;
        if (Number(test[1]) !== count) throw new Error('Non-sequential TAP test numbers');
      }
    }
  }
  if (planned === undefined || count !== planned) throw new Error(`TAP plan/count mismatch: planned ${planned}, ran ${count}`);
  if (finishes.length !== 1 || finishes[0].rows.length !== 0) {
    throw new Error('Expected exactly one successful pgTAP finish()');
  }
  return count;
}

async function main() {
  // Optional SQL paths support focused runs and genuine negative harness tests.
  const paths = process.argv.slice(2);
  const testPaths = paths.length ? paths.map(path => resolve(path))
    : (await readdir(new URL('../supabase/tests/', import.meta.url)))
      .filter(name => name.endsWith('.test.sql')).sort().map(name => resolve(root, 'supabase/tests', name));
  if (!testPaths.length) throw new Error('No SQL tests found');
  const [fixture, migration, ...suites] = await Promise.all([
    readFile(new URL('./db/auth-fixture.sql', import.meta.url), 'utf8'),
    // Execute the production file verbatim, never a translated/copy migration.
    readFile(new URL('../supabase/migrations/202610240001_account_profiles.sql', import.meta.url), 'utf8'),
    ...testPaths.map(path => readFile(path, 'utf8')),
  ]);
  const { version: pgliteVersion } = JSON.parse(await readFile(new URL('../node_modules/@electric-sql/pglite/package.json', import.meta.url), 'utf8'));
  const db = await PGlite.create({ dataDir: 'memory://', extensions: { pgtap } });
  try {
    await db.exec(fixture);
    await db.exec('create extension pgtap with schema extensions');
    const { rows: [engine] } = await db.query("select version() as postgres, (select extversion from pg_extension where extname = 'pgtap') as pgtap");
    if (!engine?.pgtap) throw new Error('Actual pgTAP extension is missing');
    console.log(`PGlite ${pgliteVersion}; ${engine.postgres}; pgTAP ${engine.pgtap}`);
    console.log('TEST ONLY: mocked AUTH users/JWT GUCs; PostgreSQL roles/RLS are real. No provider JWT verification.');
    await db.exec(migration);
    for (const [index, sql] of suites.entries()) {
      console.log(`\n${testPaths[index]}`);
      const results = await db.exec(sql);
      for (const result of results) for (const row of result.rows) console.log(...Object.values(row));
      const count = checkTap(results);
      console.log(`PASS: ${count}/${count} pgTAP assertions`);
    }
  } finally {
    await db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`Database validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
