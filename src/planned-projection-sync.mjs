import {
  getProjectionSourceFingerprint,
  getProjectionSyncHash,
  projectionLookupTag
} from './projection-managed-state.mjs';
import { synchronizeProjection } from './publisher.mjs';

function tagNames(tags) {
  return (tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter((tag) => typeof tag === 'string' && tag !== '');
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateExpectedObservation(matches, expected) {
  if (expected == null) {
    if (matches.length !== 0) {
      throw new Error('Ghost projection became owned after planning; refusing unplanned mutation');
    }
    return;
  }
  if (matches.length !== 1 || matches[0]?.id !== expected.postId) {
    throw new Error('Ghost projection identity owner changed after planning; refusing stale mutation');
  }
  const current = matches[0];
  if ((current.updated_at ?? null) !== expected.updatedAt) {
    throw new Error('Ghost projection updated_at changed after planning; refusing stale mutation');
  }
  if ((current.status ?? null) !== expected.status || (current.slug ?? null) !== expected.slug) {
    throw new Error('Ghost projection status/slug changed after planning; refusing stale mutation');
  }
  if (getProjectionSourceFingerprint(current) !== expected.projectedSourceFingerprint) {
    throw new Error('Ghost projection revision changed after planning; refusing stale mutation');
  }
  if (getProjectionSyncHash(current) !== expected.syncHash) {
    throw new Error('Ghost projection sync evidence changed after planning; refusing stale mutation');
  }
  if (!sameArray(tagNames(current.tags), expected.tags ?? [])) {
    throw new Error('Ghost projection tags changed after planning; refusing stale mutation');
  }
}

function bindExpectedIdentityRead(client, sourceIdentity, expectedObserved) {
  let checked = false;
  const proxy = new Proxy(client, {
    get(target, property) {
      if (property === 'getPostsBySourceTag') {
        return async (tag) => {
          const matches = await target.getPostsBySourceTag(tag);
          if (!checked && tag === sourceIdentity) {
            validateExpectedObservation(matches, expectedObserved);
            checked = true;
          }
          return matches;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return {
    client: proxy,
    assertChecked() {
      if (!checked) throw new Error('planned Ghost observation was not checked before projection mutation');
    }
  };
}

export async function synchronizePlannedProjection({
  prepared,
  variantPlan,
  action,
  client,
  repoRoot
}) {
  if (!prepared || typeof prepared !== 'object') throw new Error('prepared projection is required');
  if (!variantPlan || typeof variantPlan !== 'object') throw new Error('variant publication plan is required');
  if (variantPlan.locale !== prepared.variant?.locale) {
    throw new Error('variant publication plan locale does not match prepared LocaleVariant');
  }
  if (variantPlan.sourceFingerprint !== prepared.sourceFingerprint) {
    throw new Error('variant publication plan source fingerprint does not match prepared projection');
  }
  const sourceIdentity = projectionLookupTag(prepared.projection.identityTags);
  if (variantPlan.ghost?.sourceIdentity !== sourceIdentity) {
    throw new Error('variant publication plan source identity does not match prepared projection');
  }

  const bound = bindExpectedIdentityRead(client, sourceIdentity, variantPlan.ghost.observed ?? null);
  try {
    return await synchronizeProjection({
      projection: prepared.projection,
      compiledDocument: prepared.compiledDocument,
      action,
      client: bound.client,
      repoRoot
    });
  } finally {
    bound.assertChecked();
  }
}
