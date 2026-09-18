import {
  getProjectionSourceFingerprint,
  getProjectionSyncHash,
  projectionLookupTag
} from './projection-managed-state.mjs';
import { synchronizeProjection } from './publisher.mjs';

const MAX_FEATURE_IMAGE_EVIDENCE_URL_LENGTH = 2000;

export class PlannedProjectionSynchronizationError extends Error {
  constructor(message, { cause = null, featureImageUploads = [] } = {}) {
    super(message);
    this.name = 'PlannedProjectionSynchronizationError';
    this.cause = cause;
    this.featureImageUploads = featureImageUploads;
  }
}

function tagNames(tags) {
  return (tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter((tag) => typeof tag === 'string' && tag !== '');
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requirePublicFeatureImageUploadUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Ghost feature-image upload result must contain a non-empty URL');
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error('Ghost feature-image upload result must be a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Ghost feature-image upload result must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Ghost feature-image upload result must not contain URL credentials');
  }
  return parsed.href;
}

function featureImageUploadEvidence(rawUrl) {
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length === 0
    || rawUrl.length > MAX_FEATURE_IMAGE_EVIDENCE_URL_LENGTH
  ) {
    return { url: null };
  }
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { url: null }; }
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.href, urlCredentialsRedacted: true };
  }
  return { url: parsed.href };
}

function normalizedUploadErrorEvidence(error) {
  if (error?.ghostImageUploadSideEffect !== true) return null;
  const value = error?.uploadEvidence;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { url: null };
  const sanitized = featureImageUploadEvidence(value.url);
  return {
    ...sanitized,
    ...(
      value.urlCredentialsRedacted === true || sanitized.urlCredentialsRedacted === true
        ? { urlCredentialsRedacted: true }
        : {}
    )
  };
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

function bindPlannedClient(client, sourceIdentity, expectedObserved) {
  let checked = false;
  const featureImageUploads = [];
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
      if (property === 'uploadImageBytes' || property === 'uploadImage') {
        return async (...args) => {
          const ref = typeof args[1] === 'string' ? args[1] : null;
          let result;
          try {
            result = await target[property](...args);
          } catch (error) {
            const evidence = normalizedUploadErrorEvidence(error);
            if (evidence) {
              featureImageUploads.push({ method: property, ref, ...evidence });
            }
            throw error;
          }

          const rawUrl = typeof result?.url === 'string' ? result.url : null;
          featureImageUploads.push({
            method: property,
            ref,
            ...featureImageUploadEvidence(rawUrl)
          });
          const url = requirePublicFeatureImageUploadUrl(rawUrl);
          return { ...result, url };
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return {
    client: proxy,
    featureImageUploads,
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

  const bound = bindPlannedClient(client, sourceIdentity, variantPlan.ghost.observed ?? null);
  try {
    const result = await synchronizeProjection({
      projection: prepared.projection,
      compiledDocument: prepared.compiledDocument,
      action,
      client: bound.client,
      repoRoot
    });
    bound.assertChecked();
    return result;
  } catch (cause) {
    if (bound.featureImageUploads.length > 0) {
      throw new PlannedProjectionSynchronizationError(
        cause instanceof Error ? cause.message : String(cause),
        {
          cause,
          featureImageUploads: bound.featureImageUploads.map((entry) => ({ ...entry }))
        }
      );
    }
    throw cause;
  }
}
