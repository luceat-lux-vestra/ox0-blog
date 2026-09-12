import path from 'node:path';
import { planAssetDelivery, publishAssetDelivery } from './asset-publisher.mjs';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';
import { resolveMaterialImageReference } from './material-asset-evidence.mjs';

function requireMaterialAssets(value) {
  if (!Array.isArray(value)) throw new Error('materialAssets must be an array');
  const map = new Map();
  for (const asset of value) {
    if (!asset || typeof asset !== 'object') throw new Error('material asset evidence must be an object');
    if (typeof asset.ref !== 'string' || !asset.ref.startsWith('assets/')) {
      throw new Error('material asset evidence ref must be under assets/');
    }
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`material asset evidence sha256 is invalid for ${asset.ref}`);
    }
    if (map.has(asset.ref)) throw new Error(`duplicate material asset evidence: ${asset.ref}`);
    map.set(asset.ref, asset.sha256);
  }
  return map;
}

function requireVariant(variant) {
  if (!variant || typeof variant !== 'object') throw new Error('LocaleVariant is required');
  if (typeof variant.locale !== 'string' || variant.locale.trim() === '') {
    throw new Error('LocaleVariant.locale must be a non-empty string');
  }
  return variant;
}

function requirePlannedAsset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('planned material asset must be an object');
  }
  if (typeof value.ref !== 'string' || !value.ref.startsWith('assets/')) {
    throw new Error('planned material asset ref must be under assets/');
  }
  if (typeof value.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.fingerprint)) {
    throw new Error(`planned material asset fingerprint is invalid for ${value.ref}`);
  }
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error(`planned material asset size is invalid for ${value.ref}`);
  }
  if (typeof value.filename !== 'string' || value.filename.trim() === '') {
    throw new Error(`planned material asset filename is invalid for ${value.ref}`);
  }
  return value;
}

export async function planMaterialResourceDelivery({
  variant: rawVariant,
  compiledDocument: rawDocument,
  materialAssets,
  repoRoot,
  assetPublisher
}) {
  const variant = requireVariant(rawVariant);
  const compiledDocument = requireCompiledDocument(rawDocument);
  if (compiledDocument.locale !== variant.locale) {
    throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match LocaleVariant.locale=${variant.locale}`);
  }
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  const root = path.resolve(repoRoot);
  const evidence = requireMaterialAssets(materialAssets);
  const referencedLocalRefs = new Set();

  for (const resource of compiledDocument.referencedAssets) {
    if (!resource || resource.kind !== 'image') {
      throw new Error(`unsupported material resource kind: ${resource?.kind ?? '<missing>'}`);
    }
    const resolved = resolveMaterialImageReference({ variant, href: resource.href, repoRoot: root });
    if (resolved.kind === 'local') referencedLocalRefs.add(resolved.ref);
  }

  for (const ref of evidence.keys()) {
    if (!referencedLocalRefs.has(ref)) {
      throw new Error(`material asset evidence is not referenced by compiled source: ${ref}`);
    }
  }
  for (const ref of referencedLocalRefs) {
    if (!evidence.has(ref)) {
      throw new Error(`compiled local material asset is missing fingerprint evidence: ${ref}`);
    }
  }

  const plansByRef = new Map();
  for (const ref of [...referencedLocalRefs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const snapshot = await readRepositoryAssetSnapshot(
      path.resolve(root, ...ref.split('/')),
      root,
      `material asset ${ref}`
    );
    const expectedFingerprint = `sha256:${evidence.get(ref)}`;
    if (snapshot.fingerprint !== expectedFingerprint) {
      throw new Error(
        `material asset changed since Article evaluation: ${ref}; expected ${expectedFingerprint}, got ${snapshot.fingerprint}`
      );
    }
    const planned = await planAssetDelivery(assetPublisher, {
      ref,
      fingerprint: snapshot.fingerprint,
      filename: snapshot.filename,
      size: snapshot.size
    });
    plansByRef.set(ref, {
      ...planned.plan,
      size: snapshot.size,
      filename: snapshot.filename
    });
  }

  async function resolveResource(resource) {
    if (!resource || resource.kind !== 'image') return null;
    const resolved = resolveMaterialImageReference({ variant, href: resource.href, repoRoot: root });
    if (resolved.kind === 'remote') return { href: resolved.href };
    const plan = plansByRef.get(resolved.ref);
    if (!plan) throw new Error(`no AssetPublisher plan exists for material asset: ${resolved.ref}`);
    return { href: plan.url };
  }

  return {
    plans: [...plansByRef.entries()].map(([ref, plan]) => ({ ref, ...plan })),
    resolveResource
  };
}

export async function publishPlannedMaterialAssets({ plans, repoRoot, assetPublisher }) {
  if (!Array.isArray(plans)) throw new Error('planned material assets must be an array');
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  const root = path.resolve(repoRoot);
  const published = [];
  const seen = new Set();

  for (const rawPlan of plans) {
    const plan = requirePlannedAsset(rawPlan);
    if (seen.has(plan.ref)) throw new Error(`duplicate planned material asset: ${plan.ref}`);
    seen.add(plan.ref);
    const snapshot = await readRepositoryAssetSnapshot(
      path.resolve(root, ...plan.ref.split('/')),
      root,
      `planned material asset ${plan.ref}`
    );
    if (snapshot.fingerprint !== plan.fingerprint || snapshot.size !== plan.size) {
      throw new Error(
        `material asset changed after planning: ${plan.ref}; expected ${plan.fingerprint}/${plan.size}, got ${snapshot.fingerprint}/${snapshot.size}`
      );
    }
    const result = await publishAssetDelivery(
      assetPublisher,
      {
        ref: plan.ref,
        fingerprint: plan.fingerprint,
        filename: plan.filename,
        size: plan.size
      },
      snapshot.bytes,
      plan
    );
    published.push({ ref: plan.ref, url: result.url, fingerprint: plan.fingerprint });
  }
  return published;
}
