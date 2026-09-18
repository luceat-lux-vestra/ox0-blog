import test from 'node:test';
import assert from 'node:assert/strict';
import { GhostAdminClient } from '../src/ghost-client.mjs';

test('uploadImageBytes sends the exact provided snapshot bytes and filename', async () => {
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
  let observed = null;
  const fetchImpl = async (url, options) => {
    const form = options.body;
    const file = form.get('file');
    observed = {
      pathname: new URL(url).pathname,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: form.get('purpose'),
      ref: form.get('ref')
    };
    return new Response(JSON.stringify({ images: [{ url: 'https://img.example/cover.png' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const client = new GhostAdminClient({
    url: 'https://ghost.example',
    key: 'id:00112233',
    fetchImpl
  });
  const uploaded = await client.uploadImageBytes(
    { bytes: expected, filename: 'cover.png' },
    'assets/article/cover.png'
  );

  assert.equal(uploaded.url, 'https://img.example/cover.png');
  assert.equal(observed.pathname, '/ghost/api/admin/images/upload/');
  assert.equal(observed.filename, 'cover.png');
  assert.deepEqual(observed.bytes, expected);
  assert.equal(observed.purpose, 'image');
  assert.equal(observed.ref, 'assets/article/cover.png');
});

test('uploadImageBytes rejects unsupported filenames before network access', async () => {
  let called = false;
  const client = new GhostAdminClient({
    url: 'https://ghost.example',
    key: 'id:00112233',
    fetchImpl: async () => { called = true; throw new Error('should not run'); }
  });
  await assert.rejects(
    client.uploadImageBytes({ bytes: Buffer.from('x'), filename: 'cover.exe' }),
    /unsupported image extension/
  );
  assert.equal(called, false);
});
