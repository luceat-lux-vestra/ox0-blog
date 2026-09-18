import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const PLAN_SCRIPT_URL = new URL('../scripts/plan-article.mjs', import.meta.url);

test('target publish dry-run applies the same production mode policy as execution', async () => {
  const source = await readFile(PLAN_SCRIPT_URL, 'utf8');
  assert.match(source, /productionPublishModeForPlan\(plan\)/);
  assert.match(source, /action === 'publish'/);
  assert.match(source, /productionMode/);
});
