import path from 'node:path';
import { planAssetDelivery } from './asset-publisher.mjs';
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
