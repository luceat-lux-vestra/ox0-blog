import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { requireConfinedRegularFile } from './file-confinement.mjs';
import { parseStrictJson } from './strict-json.mjs';

export const ARTICLE_CLAIM_PROOF_VERSION = 1;
export const ARTICLE_CLAIM_PROOF_FINGERPRINT_VERSION = 1;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const CLAIM_KINDS = new Set(['fact', 'classification', 'recommendation', 'example_interpretation']);
const VERDICTS = new Set(['PASS', 'FAIL', 'UNVERIFIED', 'INSUFFICIENT_EVIDENCE']);
const SOURCE_ROLES = new Set([
  'specification',
  'official_reference',
  'architecture_guidance',
  'repository_evidence',
  'experiment',
  'incident',
  'public_example',
  'practitioner_commentary'
]);
const CLAIM_COVERAGE_CHECKS = new Set([
  'material_claims_extracted',
  'recommendation_language_scanned',
  'responsibility_classifications_scanned',
  'examples_and_tutorials_scanned'
]);
const CONSISTENCY_CHECKS = new Set([
  'examples_follow_rules',
  'descriptive_normative_separation',
  'responsibility_consistency',
  'dedicated_abstraction_boundary',
  'exceptions_not_defaults'
]);
const ADVERSARIAL_CHECKS = new Set([
  'strongest_claim_challenged',
  'recommendation_source_role_checked',
  'source_overreach_checked',
  'alternatives_checked',
  'expert_challenge_checked'
]);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, name, keys) {
  const object = requireObject(value, name);
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${name} contains unsupported field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) throw new Error(`${name} is missing required field: ${key}`);
  }
  return object;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function requireFingerprint(value, name) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function requireVerdict(value, name) {
  if (!VERDICTS.has(value)) throw new Error(`${name} must be one of ${[...VERDICTS].join(', ')}`);
  return value;
}

function requireHttpsUrl(value, name) {
  const raw = requireString(value, name);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${name} must be a valid absolute URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use https:`);
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials`);
  return parsed.href;
}

function normalizeEvidence(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const seenUrls = new Set();
  return value.map((entry, index) => {
    const item = exactKeys(entry, `${name}[${index}]`, ['role', 'url', 'relevance']);
    if (!SOURCE_ROLES.has(item.role)) {
      throw new Error(`${name}[${index}].role is unsupported: ${item.role}`);
    }
    const url = requireHttpsUrl(item.url, `${name}[${index}].url`);
    if (seenUrls.has(url)) throw new Error(`${name} must not contain duplicate evidence URLs: ${url}`);
    seenUrls.add(url);
    return {
      role: item.role,
      url,
      relevance: requireString(item.relevance, `${name}[${index}].relevance`)
    };
  });
}

function strings(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function nonEmptyStrings(value, name) {
  const normalized = strings(value, name);
  if (normalized.length === 0) throw new Error(`${name} must be a non-empty array`);
  return normalized;
}

function normalizeRecommendationBasis(value, claim, name) {
  if (claim.kind !== 'recommendation') {
    if (value !== null) throw new Error(`${name} must be null for non-recommendation claims`);
    return null;
  }
  const basis = exactKeys(value, name, ['kind', 'conditions', 'alternatives']);
  if (!['direct_guidance', 'bounded_judgment'].includes(basis.kind)) {
    throw new Error(`${name}.kind must be direct_guidance or bounded_judgment`);
  }
  const conditions = basis.kind === 'bounded_judgment'
    ? nonEmptyStrings(basis.conditions, `${name}.conditions`)
    : strings(basis.conditions, `${name}.conditions`);
  const alternatives = basis.kind === 'bounded_judgment'
    ? nonEmptyStrings(basis.alternatives, `${name}.alternatives`)
    : strings(basis.alternatives, `${name}.alternatives`);
  const supportive = claim.evidence.filter((entry) => entry.role !== 'practitioner_commentary');
  const hasSubstantiveEvidence = claim.evidence.some((entry) =>
    ['specification', 'official_reference', 'architecture_guidance', 'repository_evidence', 'experiment', 'incident'].includes(entry.role)
  );

  if (basis.kind === 'direct_guidance') {
    const direct = claim.evidence.some((entry) =>
      entry.role === 'architecture_guidance' || entry.role === 'specification'
    );
    if (!direct) {
      throw new Error(`${name} direct_guidance requires architecture_guidance or specification evidence`);
    }
  } else {
    if (supportive.length < 2) {
      throw new Error(`${name} bounded_judgment requires at least two non-commentary evidence items`);
    }
    if (!hasSubstantiveEvidence) {
      throw new Error(`${name} bounded_judgment requires at least one substantive non-example evidence item`);
    }
  }
  return { kind: basis.kind, conditions, alternatives };
}

function normalizeClaim(value, index) {
  const name = `claimProof.claims[${index}]`;
  const item = exactKeys(value, name, [
    'id',
    'kind',
    'statement',
    'evidence',
    'counterEvidence',
    'counterEvidenceStatus',
    'counterEvidenceReview',
    'recommendationBasis',
    'verdict'
  ]);
  const id = requireString(item.id, `${name}.id`);
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) {
    throw new Error(`${name}.id must use lowercase stable token syntax`);
  }
  if (!CLAIM_KINDS.has(item.kind)) throw new Error(`${name}.kind is unsupported: ${item.kind}`);
  const evidence = normalizeEvidence(item.evidence, `${name}.evidence`);
  const counterEvidence = normalizeEvidence(item.counterEvidence, `${name}.counterEvidence`);
  if (!['PRESENT', 'REVIEWED_NONE_FOUND'].includes(item.counterEvidenceStatus)) {
    throw new Error(`${name}.counterEvidenceStatus must be PRESENT or REVIEWED_NONE_FOUND`);
  }
  if (item.counterEvidenceStatus === 'PRESENT' && counterEvidence.length === 0) {
    throw new Error(`${name}.counterEvidence must be non-empty when status is PRESENT`);
  }
  if (item.counterEvidenceStatus === 'REVIEWED_NONE_FOUND' && counterEvidence.length !== 0) {
    throw new Error(`${name}.counterEvidence must be empty when status is REVIEWED_NONE_FOUND`);
  }
  const verdict = requireVerdict(item.verdict, `${name}.verdict`);
  if (verdict === 'PASS' && evidence.length === 0) {
    throw new Error(`${name}.evidence must be non-empty for PASS`);
  }
  const partial = {
    id,
    kind: item.kind,
    statement: requireString(item.statement, `${name}.statement`),
    evidence,
    counterEvidence,
    counterEvidenceStatus: item.counterEvidenceStatus,
    counterEvidenceReview: requireString(item.counterEvidenceReview, `${name}.counterEvidenceReview`)
  };
  const recommendationBasis = normalizeRecommendationBasis(
    item.recommendationBasis,
    partial,
    `${name}.recommendationBasis`
  );
  return { ...partial, recommendationBasis, verdict };
}

function normalizeReviewBlock(value, name, requiredChecks) {
  const block = exactKeys(value, name, ['verdict', 'checks', 'summary']);
  const verdict = requireVerdict(block.verdict, `${name}.verdict`);
  const summary = requireString(block.summary, `${name}.summary`);
  if (!Array.isArray(block.checks)) throw new Error(`${name}.checks must be an array`);
  const seen = new Set();
  const checks = block.checks.map((entry, index) => {
    const check = exactKeys(entry, `${name}.checks[${index}]`, ['id', 'result']);
    if (!requiredChecks.has(check.id)) throw new Error(`${name}.checks[${index}].id is unsupported: ${check.id}`);
    if (seen.has(check.id)) throw new Error(`${name}.checks contains duplicate id: ${check.id}`);
    seen.add(check.id);
    if (check.result !== 'PASS') throw new Error(`${name}.checks[${index}].result must be PASS`);
    return { id: check.id, result: 'PASS' };
  });
  const missing = [...requiredChecks].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`${name}.checks is missing required checks: ${missing.join(', ')}`);
  if (verdict !== 'PASS') throw new Error(`${name}.verdict must be PASS for durable accepted proof`);
  return { verdict, checks, summary };
}

function normalizeCoveredFingerprints(value) {
  const object = requireObject(value, 'claimProof.coveredTranslationFingerprints');
  const normalized = {};
  for (const [locale, fingerprint] of Object.entries(object)) {
    normalized[requireString(locale, 'claimProof covered locale')] = requireFingerprint(
      fingerprint,
      `claimProof.coveredTranslationFingerprints.${locale}`
    );
  }
  if (Object.keys(normalized).length === 0) {
    throw new Error('claimProof.coveredTranslationFingerprints must not be empty');
  }
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
    return result;
  }
  return value;
}

export function normalizeArticleClaimProof(raw) {
  const value = exactKeys(raw, 'claimProof', [
    'version',
    'coveredTranslationFingerprints',
    'claims',
    'claimCoverage',
    'crossClaimConsistency',
    'adversarialReview'
  ]);
  if (value.version !== ARTICLE_CLAIM_PROOF_VERSION) {
    throw new Error(`unsupported claim proof version: ${value.version}`);
  }
  if (!Array.isArray(value.claims) || value.claims.length === 0) {
    throw new Error('claimProof.claims must be a non-empty array');
  }
  const claims = value.claims.map(normalizeClaim);
  const ids = claims.map((claim) => claim.id);
  if (new Set(ids).size !== ids.length) throw new Error('claimProof.claims must not contain duplicate ids');

  return {
    version: ARTICLE_CLAIM_PROOF_VERSION,
    coveredTranslationFingerprints: normalizeCoveredFingerprints(value.coveredTranslationFingerprints),
    claims,
    claimCoverage: normalizeReviewBlock(
      value.claimCoverage,
      'claimProof.claimCoverage',
      CLAIM_COVERAGE_CHECKS
    ),
    crossClaimConsistency: normalizeReviewBlock(
      value.crossClaimConsistency,
      'claimProof.crossClaimConsistency',
      CONSISTENCY_CHECKS
    ),
    adversarialReview: normalizeReviewBlock(
      value.adversarialReview,
      'claimProof.adversarialReview',
      ADVERSARIAL_CHECKS
    )
  };
}

export function articleClaimProofFingerprintV1(raw) {
  const proof = normalizeArticleClaimProof(raw);
  const canonical = JSON.stringify(stable(proof));
  return `sha256:${createHash('sha256').update('ox0-article-claim-proof:v1\0', 'utf8').update(canonical, 'utf8').digest('hex')}`;
}

export function evaluateArticleClaimProof({ proof, requiredLocales, currentTranslationFingerprints }) {
  if (proof == null) return { state: 'MISSING', fingerprint: null };
  const normalized = normalizeArticleClaimProof(proof);
  const locales = [...requiredLocales].sort();
  const covered = Object.keys(normalized.coveredTranslationFingerprints).sort();
  if (locales.length !== covered.length || locales.some((locale, index) => locale !== covered[index])) {
    return { state: 'STALE', reason: 'LOCALE_SET_CHANGED', fingerprint: articleClaimProofFingerprintV1(normalized) };
  }
  for (const locale of locales) {
    if (normalized.coveredTranslationFingerprints[locale] !== currentTranslationFingerprints[locale]) {
      return { state: 'STALE', reason: 'SOURCE_CHANGED', fingerprint: articleClaimProofFingerprintV1(normalized) };
    }
  }
  const failed = normalized.claims.filter((claim) => claim.verdict !== 'PASS');
  if (failed.length > 0) {
    return { state: 'FAIL', reason: 'CLAIM_VERDICT', claimIds: failed.map((claim) => claim.id), fingerprint: articleClaimProofFingerprintV1(normalized) };
  }
  return { state: 'PASS', fingerprint: articleClaimProofFingerprintV1(normalized), proof: normalized };
}

export async function loadArticleClaimProof(articleDir) {
  const entries = await readdir(articleDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.toLowerCase() !== 'claim-proof.json') continue;
    if (entry.name !== 'claim-proof.json') {
      throw new Error(`Article claim proof filename must use exact lowercase claim-proof.json: ${path.join(articleDir, entry.name)}`);
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Article claim proof must be a regular file: ${path.join(articleDir, entry.name)}`);
    }
  }

  const proofPath = path.join(articleDir, 'claim-proof.json');
  try {
    const stat = await lstat(proofPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Article claim proof must be a regular file: ${proofPath}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: proofPath, proof: null };
    throw error;
  }
  const confined = await requireConfinedRegularFile(proofPath, articleDir, 'Article claim proof');
  const bytes = await readFile(confined.realPath);
  if (bytes.length !== confined.size) throw new Error(`Article claim proof changed while reading: ${proofPath}`);
  let text;
  try { text = UTF8_DECODER.decode(bytes); } catch { throw new Error(`Article claim proof must be valid UTF-8: ${proofPath}`); }
  let raw;
  try { raw = parseStrictJson(text); } catch (error) { throw new Error(`failed to parse Article claim proof ${proofPath}: ${error.message}`); }
  return { path: proofPath, proof: normalizeArticleClaimProof(raw) };
}
