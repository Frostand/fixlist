import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runner = fileURLToPath(new URL('./test-db.mjs', import.meta.url));
const wrap = body => `begin; set local search_path = public, extensions; ${body} rollback;`;

async function execute(sql) {
  const directory = await mkdtemp(join(tmpdir(), 'fixlist-db-runner-'));
  try {
    const path = join(directory, 'test.sql');
    await writeFile(path, sql);
    // Real fresh WASM Postgres and actual pgTAP for every case; no result mocks.
    const result = spawnSync(process.execPath, [runner, path], { encoding: 'utf8', timeout: 20000 });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('SQL runner process exit status (actual pgTAP)', () => {
  it('accepts a completed plan', async () => {
    const result = await execute(wrap("select plan(1); select ok(true, 'real pgTAP'); select * from finish();"));
    expect(result.status).toBe(0);
    expect(result.output).toContain('PASS: 1/1');
  });
  it.each([
    ['not ok', "select plan(1); select ok(false, 'intentional failure'); select * from finish();", /not ok 1/],
    ['plan under-run', 'select plan(2); select ok(true); select * from finish();', /planned 2 tests but ran 1/],
    ['plan over-run', 'select plan(1); select ok(true); select ok(true); select * from finish();', /planned 1 test but ran 2/],
    ['missing emitted plan', 'do $$begin perform plan(1); end$$; select ok(true); select * from finish();', /TAP plan\/count mismatch/],
    ['missing finish', 'select plan(1); select ok(true);', /finish/],
    ['skipped assertion', "select plan(1); select skip('not executed'); select * from finish();", /skipped TAP/],
    ['SQL error', 'select plan(1); select no_such_function();', /no_such_function/],
    ['missing extension', 'drop extension pgtap cascade; select plan(1);', /function plan\(integer\) does not exist/],
  ])('exits nonzero for %s', async (_name, sql, message) => {
    const result = await execute(wrap(sql));
    expect(result.status).toBe(1);
    expect(result.output).toMatch(message);
    expect(result.output).not.toContain('PASS:');
  });
});
