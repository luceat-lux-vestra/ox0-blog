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

function response(status, body, headers = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function githubFixture({
  contentOverrides = {},
  rawContentType = 'image/svg+xml',
  rawStatus = 200
} = {}) {
  const repository = 'owner/blog';
  const api = 'https://api.github.example/api/v3';
  const raw = 'https://raw.github.example';
  const requests = [];
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);
  const rawUrl = `${raw}/${repository}/${SOURCE_SHA}/${asset.ref}`;

  async function fetchImpl(input, options = {}) {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    requests.push({
      url: url.href,
      method,
      authorization: options.headers?.Authorization ?? null
    });

    const expectedApiPath = `/api/v3/repos/${repository}/contents/${asset.ref}`;
    if (url.origin === 'https://api.github.example' && url.pathname === expectedApiPath && method === 'GET') {
      if (url.searchParams.get('ref') !== SOURCE_SHA) {
        throw new Error(`unexpected GitHub ref: ${url.href}`);
      }
      const body = {
        type: 'file',
        path: asset.ref,
        name: 'diagram.svg',
        size: asset.size,
        sha: 'git-blob-sha',
        download_url: rawUrl,
        ...contentOverrides
      };
      return response(200, body);
    }

    if (url.href === rawUrl && method === 'HEAD') {
      return new Response(null, {
        status: rawStatus,
        headers: { 'Content-Type': rawContentType }
      });
    }

    throw new Error(`unexpected GitHub request: ${method} ${url.href}`);
  }

  return { repository, api, raw, rawUrl, requests, bytes, asset, fetchImpl };
}

test('GitHub Raw planning resolves the exact commit-backed repository download URL and validates browser delivery', async () => {
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
    url: gh.rawUrl,
    ref: gh.asset.ref,
    fingerprint: gh.asset.fingerprint
  });
  assert.equal(publisher.publishAsset, undefined);
  assert.deepEqual(gh.requests, [
    {
      url: `${gh.api}/repos/${gh.repository}/contents/${gh.asset.ref}?ref=${SOURCE_SHA}`,
      method: 'GET',
      authorization: 'Bearer token'
    },
    {
      url: gh.rawUrl,
      method: 'HEAD',
      authorization: null
    }
  ]);
});

test('GitHub Raw planning rejects a mutable or wrong-commit download URL before browser probing', async () => {
  for (const download_url of [
    'https://raw.github.example/owner/blog/main/assets/article/diagram.svg',
    `https://raw.github.example/owner/blog/${'b'.repeat(40)}/assets/article/diagram.svg`
  ]) {
    const gh = githubFixture({ contentOverrides: { download_url } });
    const publisher = createGitHubRawAssetPublisher({
      repository: gh.repository,
      sourceSha: SOURCE_SHA,
      token: 'token',
      apiBaseUrl: gh.api,
      fetchImpl: gh.fetchImpl
    });
    await assert.rejects(planAssetDelivery(publisher, gh.asset), /exact source SHA/);
    assert.equal(gh.requests.length, 1);
  }
});

test('GitHub Raw planning rejects repository path or size drift', async () => {
  {
    const gh = githubFixture({ contentOverrides: { path: 'assets/article/other.svg' } });
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
    const gh = githubFixture({ contentOverrides: { size: 999 } });
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

test('GitHub Raw planning fails closed when the public asset is not browser-delivered as the expected image MIME', async () => {
  for (const fixture of [
    githubFixture({ rawContentType: 'application/octet-stream' }),
    githubFixture({ rawContentType: 'text/plain' }),
    githubFixture({ rawStatus: 404 })
  ]) {
    const publisher = createGitHubRawAssetPublisher({
      repository: fixture.repository,
      sourceSha: SOURCE_SHA,
      token: 'token',
      apiBaseUrl: fixture.api,
      fetchImpl: fixture.fetchImpl
    });
    await assert.rejects(
      planAssetDelivery(publisher, fixture.asset),
      /content-type mismatch|failed with HTTP 404/
    );
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
