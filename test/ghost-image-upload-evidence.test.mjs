import test from 'node:test';
import assert from 'node:assert/strict';
import { GhostAdminClient } from '../src/ghost-client.mjs';

function clientFor(image) {
  return new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'ab'.repeat(32)}`,
    fetchImpl: async () => new Response(JSON.stringify({ images: [image] }), { status: 200 })
  });
}

async function rejectedUpload(image) {
  const client = clientFor(image);
  try {
    await client.uploadImageBytes({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: 'cover.png'
    }, 'assets/cover.png');
  } catch (error) {
    return error;
  }
  throw new Error('expected Ghost image upload response validation to reject');
}

test('Ghost image response validation marks a completed upload side effect', async () => {
  const error = await rejectedUpload({ url: 'http://cdn.example/cover.png' });
  assert.equal(error.name, 'GhostImageUploadResponseError');
  assert.equal(error.ghostImageUploadSideEffect, true);
  assert.deepEqual(error.uploadEvidence, {
    url: 'http://cdn.example/cover.png'
  });
});

test('Ghost image response side-effect evidence redacts URL credentials', async () => {
  const error = await rejectedUpload({
    url: 'https://user:password@cdn.example/content/images/cover.png'
  });
  assert.equal(error.ghostImageUploadSideEffect, true);
  assert.deepEqual(error.uploadEvidence, {
    url: 'https://cdn.example/content/images/cover.png',
    urlCredentialsRedacted: true
  });
  assert.doesNotMatch(JSON.stringify(error.uploadEvidence), /user|password/);
});

test('malformed Ghost image response preserves side-effect marker without echoing untrusted URL text', async () => {
  const error = await rejectedUpload({ url: 'not a valid absolute URL' });
  assert.equal(error.ghostImageUploadSideEffect, true);
  assert.deepEqual(error.uploadEvidence, { url: null });
});
