import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createGitHubRawAssetPublisher,
  createGitHubRawAssetPublisherFromEnvironment
} from '../host/github-raw-asset-publisher.mjs';
import { planAssetDelivery } from '../src/asset-publisher.mjs';

const SOURCE_SHA = 'a'.repeat(40);

function descriptor(bytes, overrides = {}) {
  const buffer = Buffer.from(bytes);
  return {
    ref: 'assets/article/diagram.svg',
    fingerprint: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    filename: 'diagram.svg',
    size: buffer.length,
    ...overrides
  };
}

function response(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function githubFixture(overrides = {}) {
  const repository = 'owner/blog';
  const api = 'https://api.github.example/api/v3';
  const raw = 'https://raw.github.example';
  const requests = [];
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);

  async function fetchImpl(input, options = {}) {
    const url = new URL(input);
    requests.push({
      url: url.href,
      method: options.method ?? 'GET',
      authorization: options.headers?.Authorization ?? null
    });
    const expectedPath = `/api/v3/repos/${repository}/contents/${asset.ref}`;
    if (url.origin !== 'https://api.github.example' || url.pathname !== expectedPath || url.searchParams.get('ref') !== SOURCE_SHA) {
      throw new Error(`unexpected GitHub request: ${url.href}`);
    }

    const body = {
      type: 'file',
      path: asset.ref,
      name: 'diagram.svg',
      size: asset.size,
      sha: 'git-blob-sha',
      download_url: `${raw}/${repository}/${SOURCE_SHA}/${asset.ref}`,
      ...overrides
    };
    return response(200, body);
  }

  return { repository, api, raw, requests, bytes, asset, fetchImpl };
}

test('GitHub Raw planning resolves the exact commit-backed repository download URL without storage mutation', async () => {
  const gh = githubFixture();
  const publisher = createGitHubRawAssetPublisher({
    repository: gh.repository,
    sourceSha: SOURCE_SHA,
    token: 'token',
    apiBaseUrl: gh.api,
    fetchImpl: gh.fetchImpl
  });

  const plan = (await planAssetDelivery(publisher, gh.asset)).plan;

  assert.deepEqual(plan, {
    action: 'reuse',
    url: `${gh.raw}/${gh.repository}/${SOURCE_SHA}/${gh.asset.ref}`,
    ref: gh.asset.ref,
    fingerprint: gh.asset.fingerprint
  });
  assert.equal(publisher.publishAsset, undefined);
  assert.deepEqual(gh.requests, [{
    url: `${gh.api}/repos/${gh.repository}/contents/${gh.asset.ref}?ref=${SOURCE_SHA}`,
    method: 'GET',
    authorization: 'Bearer token'
  }]);
});

test('GitHub Raw planning rejects a mutable or wrong-commit download URL', async () => {
  for (const download_url of [
    'https://raw.github.example/owner/blog/main/assets/article/diagram.svg',
    `https://raw.github.example/owner/blog/${'b'.repeat(40)}/assets/article/diagram.svg`
  ]) {
    const gh = githubFixture({ download_url });
    const publisher = createGitHubRawAssetPublisher({
      repository: gh.repository,
      sourceSha: SOURCE_SHA,
      token: 'token',
      apiBaseUrl: gh.api,
      fetchImpl: gh.fetchImpl
    });
    await assert.rejects(planAssetDelivery(publisher, gh.asset), /exact source SHA/);
  }
});

test('GitHub Raw planning rejects repository path or size drift', async () => {
  {
    const gh = githubFixture({ path: 'assets/article/other.svg' });
    const publisher = createGitHubRawAssetPublisher({
      repository: gh.repository,
      sourceSha: SOURCE_SHA,
      token: 'token',
      apiBaseUrl: gh.api,
      fetchImpl: gh.fetchImpl
    });
    await assert.rejects(planAssetDelivery(publisher, gh.asset), /path mismatch/);
  }
  {
    const gh = githubFixture({ size: 999 });
    const publisher = createGitHubRawAssetPublisher({
      repository: gh.repository,
      sourceSha: SOURCE_SHA,
      token: 'token',
      apiBaseUrl: gh.api,
      fetchImpl: gh.fetchImpl
    });
    await assert.rejects(planAssetDelivery(publisher, gh.asset), /size mismatch/);
  }
});

test('GitHub Raw publisher requires exact deployment identity instead of embedding repository or branch values', () => {
  assert.throws(
    () => createGitHubRawAssetPublisherFromEnvironment({
      env: {
        GITHUB_REPOSITORY: 'owner/blog',
        GITHUB_TOKEN: 'token',
        GITHUB_API_URL: 'https://api.github.example',
        OX0_ARTICLE_SOURCE_SHA: 'main'
      },
      fetchImpl: async () => response(500, {})
    }),
    /exact 40-character lowercase commit SHA/
  );

  assert.throws(
    () => createGitHubRawAssetPublisherFromEnvironment({
      env: {
        GITHUB_REPOSITORY: '',
        GITHUB_TOKEN: '',
        GITHUB_API_URL: 'https://api.github.example',
        OX0_ARTICLE_SOURCE_SHA: SOURCE_SHA
      },
      fetchImpl: async () => response(500, {})
    }),
    /GITHUB_REPOSITORY/
  );
});
