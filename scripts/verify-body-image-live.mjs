#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { renderMarkdown } from '../src/markdown.mjs';

if (process.env.OX0_GHOST_LIVE_VERIFY !== '1') {
  throw new Error('live Ghost verification is mutating; set OX0_GHOST_LIVE_VERIFY=1 to opt in explicitly');
}

const url = process.env.GHOST_ADMIN_URL;
const key = process.env.GHOST_ADMIN_API_KEY;
if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

const repoRoot = process.cwd();
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const slug = `ox0-live-body-image-${suffix}`;
const title = `ox0 body-image verification ${suffix}`;
const syntheticPostPath = path.join(repoRoot, 'posts', `.ox0-live-body-image-${suffix}.md`);
const markdown = '# Body image verification\n\n![inline fixture](../assets/verification/inline.svg)\n';
const renderedHtml = await renderMarkdown(markdown, { postPath: syntheticPostPath, repoRoot });
assert.match(renderedHtml, /src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
const lexical = createHtmlCardLexical(renderedHtml);
const client = new GhostAdminClient({ url, key });

let pageId = null;
let ownsTemporaryNamespace = false;
let primaryError = null;
let successSummary = null;

async function getPageById(id) {
  try {
    const payload = await client.request(`pages/${encodeURIComponent(id)}/`, {
      query: { formats: 'lexical' }
    });
    return payload?.pages?.[0] ?? null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

function assertOwnedPage(page, id) {
  if (
    !page || page.id !== id || page.title !== title || page.lexical !== lexical || page.status !== 'draft'
  ) {
    throw new Error('body-image verification page id resolves to unexpected state; refusing cleanup');
  }
}

async function assertPageMissing(id) {
  if (await getPageById(id)) {
    throw new Error(`body-image verification page still exists after cleanup: ${id}`);
  }
}

async function cleanup() {
  if (!ownsTemporaryNamespace) return [];
  const errors = [];

  if (!pageId) {
    try {
      const unresolved = await client.getPageBySlug(slug);
      if (unresolved) {
        throw new Error('body-image verification page exists without a proven owned id; refusing slug-only cleanup; manual reconciliation required');
      }
    } catch (error) {
      errors.push(error);
    }
    return errors;
  }

  try {
    const page = await getPageById(pageId);
    if (!page) return errors;
    assertOwnedPage(page, pageId);
    try {
      await client.request(`pages/${encodeURIComponent(pageId)}/`, { method: 'DELETE' });
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    await assertPageMissing(pageId);
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

try {
  assert.equal(await client.getPostBySlug(slug), null, `temporary verification post slug already exists: ${slug}`);
  assert.equal(await client.getPageBySlug(slug), null, `temporary verification page slug already exists: ${slug}`);
  ownsTemporaryNamespace = true;

  const payload = await client.request('pages/', {
    method: 'POST',
    query: { formats: 'lexical' },
    body: {
      pages: [{ title, slug, lexical, status: 'draft' }]
    }
  });
  const created = payload?.pages?.[0] ?? null;
  pageId = created?.id ?? null;
  assert.ok(pageId, 'Ghost did not return an id for the body-image verification page');
  assert.equal(created.title, title, 'Ghost changed body-image verification page title on create');
  assert.equal(created.slug, slug, 'Ghost changed body-image verification page slug on create');
  assert.equal(created.lexical, lexical, 'Ghost changed data-URI Lexical content on create');
  assert.equal(created.status, 'draft', 'Ghost changed body-image verification page status on create');

  const persisted = await getPageById(pageId);
  assertOwnedPage(persisted, pageId);
  assert.equal(persisted.slug, slug, 'persisted body-image verification page slug changed');
  assert.match(persisted.lexical, /data:image\/svg\+xml;base64,/);

  successSummary = {
    result: 'PASS',
    pageId,
    checks: [
      'repository-owned SVG rendered as data URI',
      'direct Lexical page create preserved exact data-URI HTML card',
      'fresh ID read preserved exact Lexical representation',
      'ID-bound cleanup ownership and persisted absence'
    ]
  };
} catch (error) {
  primaryError = error;
}

const cleanupErrors = await cleanup();
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length) {
  throw new AggregateError(cleanupErrors, 'body-image Ghost verification passed but cleanup failed');
}
console.log(JSON.stringify(successSummary, null, 2));
