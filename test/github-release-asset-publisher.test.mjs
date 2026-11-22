import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGitHubReleaseAssetPublisher } from '../host/github-release-asset-publisher.mjs';
import { planAssetDelivery, publishAssetDelivery } from '../src/asset-publisher.mjs';

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

function githubFixture() {
  let release = null;
  const assets = [];
  const mutations = [];
  const repository = 'owner/blog';
  const repositoryId = '12345';
  const tag = 'ox0-article-assets-v1-12345';
  const server = 'https://github.example';
  const api = 'https://api.github.example';
  const upload = 'https://uploads.github.example/repos/owner/blog/releases/7/assets{?name,label}';

  async function fetchImpl(input, options = {}) {
    const url = new URL(input);
    const method = options.method ?? 'GET';

    if (url.origin === api && url.pathname === `/repos/${repository}/releases/tags/${tag}` && method === 'GET') {
      return release
        ? response(200, release)
        : response(404, { message: 'Not Found' });
    }

    if (url.origin === api && url.pathname === `/repos/${repository}/releases` && method === 'POST') {
      mutations.push({ type: 'release' });
      release = {
        id: 7,
        tag_name: tag,
        upload_url: upload
      };
      return response(201, release);
    }

    if (url.origin === api && url.pathname === `/repos/${repository}/releases/7/assets` && method === 'GET') {
      return response(200, assets);
    }

    if (url.origin === 'https://uploads.github.example' && url.pathname === `/repos/${repository}/releases/7/assets` && method === 'POST') {
      const name = url.searchParams.get('name');
      if (assets.some((asset) => asset.name === name)) return response(422, { message: 'Already exists' });
      const bytes = Buffer.from(options.body);
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const created = {
        id: assets.length + 1,
        name,
        state: 'uploaded',
        size: bytes.length,
        digest,
        browser_download_url: `${server}/${repository}/releases/download/${tag}/${name}`
      };
      assets.push(created);
      mutations.push({ type: 'asset', name, bytes });
      return response(201, created);
    }

    throw new Error(`unexpected GitHub request: ${method} ${url.href}`);
  }

  return {
    repository,
    repositoryId,
    server,
    api,
    assets,
    mutations,
    setRelease(value) { release = value; },
    fetchImpl
  };
}

test('GitHub Release planning is read-only and returns a deterministic content-addressed URL before the backing release exists', async () => {
  const gh = githubFixture();
  const publisher = createGitHubReleaseAssetPublisher({
    repository: gh.repository,
    repositoryId: gh.repositoryId,
    token: 'token',
    apiBaseUrl: gh.api,
    serverBaseUrl: gh.server,
    fetchImpl: gh.fetchImpl
  });
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);
  const plan = (await planAssetDelivery(publisher, asset)).plan;
  const digest = asset.fingerprint.slice('sha256:'.length);

  assert.deepEqual(plan, {
    action: 'publish',
    url: `https://github.example/owner/blog/releases/download/ox0-article-assets-v1-12345/${digest}.svg`,
    ref: asset.ref,
    fingerprint: asset.fingerprint
  });
  assert.deepEqual(gh.mutations, []);
});

test('GitHub Release publication lazily creates the backing release, uploads exact bytes and then plans reuse', async () => {
  const gh = githubFixture();
  const publisher = createGitHubReleaseAssetPublisher({
    repository: gh.repository,
    repositoryId: gh.repositoryId,
    token: 'token',
    apiBaseUrl: gh.api,
    serverBaseUrl: gh.server,
    fetchImpl: gh.fetchImpl
  });
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);
  const plan = (await planAssetDelivery(publisher, asset)).plan;

  const published = await publishAssetDelivery(publisher, asset, bytes, plan);
  assert.equal(published.url, plan.url);
  assert.equal(gh.mutations.filter((entry) => entry.type === 'release').length, 1);
  assert.equal(gh.mutations.filter((entry) => entry.type === 'asset').length, 1);

  const next = await planAssetDelivery(publisher, asset);
  assert.equal(next.plan.action, 'reuse');
  assert.equal(next.plan.url, plan.url);
});

test('GitHub Release reuse fails closed when stored digest metadata does not match the content address', async () => {
  const gh = githubFixture();
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);
  const digest = asset.fingerprint.slice('sha256:'.length);
  gh.setRelease({ id: 7, tag_name: 'ox0-article-assets-v1-12345', upload_url: 'https://uploads.github.example/repos/owner/blog/releases/7/assets{?name,label}' });
  gh.assets.push({
    id: 1,
    name: `${digest}.svg`,
    state: 'uploaded',
    size: bytes.length,
    digest: `sha256:${'0'.repeat(64)}`,
    browser_download_url: `https://github.example/owner/blog/releases/download/ox0-article-assets-v1-12345/${digest}.svg`
  });

  const publisher = createGitHubReleaseAssetPublisher({
    repository: gh.repository,
    repositoryId: gh.repositoryId,
    token: 'token',
    apiBaseUrl: gh.api,
    serverBaseUrl: gh.server,
    fetchImpl: gh.fetchImpl
  });

  await assert.rejects(planAssetDelivery(publisher, asset), /metadata mismatch/);
});


test('GitHub base URL composition preserves root/subpath bases without duplicate slashes', async () => {
  const requests = [];
  const publisher = createGitHubReleaseAssetPublisher({
    repository: 'owner/blog',
    repositoryId: '12345',
    token: 'token',
    apiBaseUrl: 'https://api.github.example/api/v3/',
    serverBaseUrl: 'https://github.example/root/',
    async fetchImpl(input, options = {}) {
      requests.push({ url: new URL(input).href, method: options.method ?? 'GET' });
      return response(404, { message: 'Not Found' });
    }
  });
  const bytes = Buffer.from('<svg>v1</svg>');
  const asset = descriptor(bytes);
  const digest = asset.fingerprint.slice('sha256:'.length);

  const plan = (await planAssetDelivery(publisher, asset)).plan;

  assert.deepEqual(requests, [{
    url: 'https://api.github.example/api/v3/repos/owner/blog/releases/tags/ox0-article-assets-v1-12345',
    method: 'GET'
  }]);
  assert.equal(
    plan.url,
    `https://github.example/root/owner/blog/releases/download/ox0-article-assets-v1-12345/${digest}.svg`
  );
  assert.equal(new URL(requests[0].url).pathname.includes('//'), false);
  assert.equal(new URL(plan.url).pathname.includes('//'), false);
});

test('GitHub Release publisher requires deployment identity and credential inputs instead of embedding repository-specific values', () => {
  assert.throws(
    () => createGitHubReleaseAssetPublisher({
      repository: '',
      repositoryId: '',
      token: '',
      apiBaseUrl: 'https://api.github.example',
      serverBaseUrl: 'https://github.example',
      fetchImpl: async () => response(500, {})
    }),
    /GITHUB_REPOSITORY/
  );
});
