import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  articleClaimProofFingerprintV1,
  normalizeArticleClaimProof
} from '../src/article-claim-proof.mjs';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';

function publication() {
  return { tags: [], featureImage: null, featureImageAlt: null, featured: false, visibility: 'public', canonicalUrl: null };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-claim-proof-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      { variantId: 'ko', locale: 'ko-KR', source: 'ko-KR.md', title: '제목', excerpt: '요약', slug: 'ko', publication: publication() },
      { variantId: 'en', locale: 'en', source: 'en.md', title: 'Title', excerpt: 'Summary', slug: 'en', publication: publication() }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2) + '\n', 'utf8');
  return { repoRoot, articleDir, manifestPath };
}

async function evaluation(value) {
  const loaded = await loadArticleManifest(value);
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale,
    claimProof: loaded.claimProof
  });
}

function proof(fingerprints, statement = 'Spring request scope binds a bean instance to one request.') {
  return {
    version: 1,
    coveredTranslationFingerprints: fingerprints,
    claims: [{
      id: 'request-scope-lifetime',
      kind: 'fact',
      statement,
      evidence: [{ role: 'official_reference', url: 'https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html', relevance: 'Documents Spring bean scopes and request scope behavior.' }],
      counterEvidence: [],
      counterEvidenceStatus: 'REVIEWED_NONE_FOUND',
      counterEvidenceReview: 'Reviewed the bounded fixture evidence set; no conflicting fixture evidence applies.',
      recommendationBasis: null,
      verdict: 'PASS'
    }],
    claimCoverage: {
      verdict: 'PASS',
      summary: 'Scanned the complete fixture source for material claims and recommendation language.',
      checks: [
        { id: 'material_claims_extracted', result: 'PASS' },
        { id: 'recommendation_language_scanned', result: 'PASS' },
        { id: 'responsibility_classifications_scanned', result: 'PASS' },
        { id: 'examples_and_tutorials_scanned', result: 'PASS' }
      ]
    },
    crossClaimConsistency: {
      verdict: 'PASS',
      summary: 'Checked the fixture claim set for internal consistency.',
      checks: [
        { id: 'examples_follow_rules', result: 'PASS' },
        { id: 'descriptive_normative_separation', result: 'PASS' },
        { id: 'responsibility_consistency', result: 'PASS' },
        { id: 'dedicated_abstraction_boundary', result: 'PASS' },
        { id: 'exceptions_not_defaults', result: 'PASS' }
      ]
    },
    adversarialReview: {
      verdict: 'PASS',
      summary: 'Fresh pass challenged source-role fit and omitted alternatives for the fixture.',
      checks: [
        { id: 'strongest_claim_challenged', result: 'PASS' },
        { id: 'recommendation_source_role_checked', result: 'PASS' },
        { id: 'source_overreach_checked', result: 'PASS' },
        { id: 'alternatives_checked', result: 'PASS' },
        { id: 'expert_challenge_checked', result: 'PASS' }
      ]
    }
  };
}

test('claim proof filename is exact and case variants fail closed', async () => {
  const value = await fixture();
  await writeFile(path.join(value.articleDir, 'Claim-Proof.json'), '{}\n', 'utf8');
  await assert.rejects(
    loadArticleManifest(value),
    /filename must use exact lowercase claim-proof\.json/
  );
});

test('recommendation cannot claim direct guidance from a public example alone', () => {
  const value = proof({ en: 'sha256:' + '1'.repeat(64), 'ko-KR': 'sha256:' + '2'.repeat(64) });
  value.claims[0] = {
    id: 'bad-recommendation',
    kind: 'recommendation',
    statement: 'Use this design by default.',
    evidence: [{ role: 'public_example', url: 'https://github.com/example/project/issues/1', relevance: 'Shows one concrete public use of the design.' }],
    counterEvidence: [],
    counterEvidenceStatus: 'REVIEWED_NONE_FOUND',
    counterEvidenceReview: 'Reviewed the bounded example set for conflicting guidance.',
    recommendationBasis: { kind: 'direct_guidance', conditions: ['HTTP request'], alternatives: ['explicit input'] },
    verdict: 'PASS'
  };
  assert.throws(() => normalizeArticleClaimProof(value), /direct_guidance requires architecture_guidance or specification/);
});

test('direct guidance does not require bounded-judgment conditions or alternatives', () => {
  const value = proof({ en: 'sha256:' + '1'.repeat(64), 'ko-KR': 'sha256:' + '2'.repeat(64) });
  value.claims[0] = {
    id: 'direct-guidance',
    kind: 'recommendation',
    statement: 'Follow the protocol requirement.',
    evidence: [{
      role: 'specification',
      url: 'https://example.com/specification',
      relevance: 'Directly specifies the required behavior.'
    }],
    counterEvidence: [],
    counterEvidenceStatus: 'REVIEWED_NONE_FOUND',
    counterEvidenceReview: 'Reviewed the bounded normative source scope; no conflicting specification applies.',
    recommendationBasis: {
      kind: 'direct_guidance',
      conditions: [],
      alternatives: []
    },
    verdict: 'PASS'
  };

  const normalized = normalizeArticleClaimProof(value);
  assert.deepEqual(normalized.claims[0].recommendationBasis, {
    kind: 'direct_guidance',
    conditions: [],
    alternatives: []
  });
});

test('bounded judgment cannot be justified only by multiple public examples', () => {
  const value = proof({ en: 'sha256:' + '1'.repeat(64), 'ko-KR': 'sha256:' + '2'.repeat(64) });
  value.claims[0] = {
    id: 'weak-bounded-judgment',
    kind: 'recommendation',
    statement: 'Prefer this design under these conditions.',
    evidence: [
      { role: 'public_example', url: 'https://github.com/example/project/issues/1', relevance: 'Shows one concrete public use of the design.' },
      { role: 'public_example', url: 'https://github.com/example/project/issues/2', relevance: 'Shows a second concrete public use of the design.' }
    ],
    counterEvidence: [],
    counterEvidenceStatus: 'REVIEWED_NONE_FOUND',
    counterEvidenceReview: 'Reviewed the bounded example set for conflicting guidance.',
    recommendationBasis: {
      kind: 'bounded_judgment',
      conditions: ['request-local lifecycle is required'],
      alternatives: ['explicit input']
    },
    verdict: 'PASS'
  };
  assert.throws(
    () => normalizeArticleClaimProof(value),
    /requires at least one substantive non-example evidence item/
  );
});

test('claim proof is required and exact proof fingerprint is bound to READY', async () => {
  const value = await fixture();
  const initial = await evaluation(value);
  assert.deepEqual(initial.readiness, { state: 'DRAFT' });

  const translation = await acceptArticleTranslationReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: initial.currentTranslationFingerprints
    }
  });
  await writeFile(value.manifestPath, translation.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({ ...value });
  const invalidationId = requested.bundle.readinessInvalidations[0].id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');

  const current = await evaluation(value);
  const currentProof = proof(current.currentTranslationFingerprints);
  await writeFile(path.join(value.articleDir, 'claim-proof.json'), JSON.stringify(currentProof, null, 2) + '\n', 'utf8');

  const withProof = await evaluation(value);
  assert.equal(withProof.claimProof.state, 'PASS');
  const proofFingerprint = articleClaimProofFingerprintV1(currentProof);
  assert.equal(withProof.currentClaimProofFingerprint, proofFingerprint);

  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: withProof.articleSourceFingerprint,
      reviewedClaimProofFingerprint: proofFingerprint,
      reviewedInvalidationIds: [invalidationId]
    }
  });
  assert.equal(accepted.bundle.readinessCheckpoint.version, 2);
  assert.equal(accepted.bundle.readinessCheckpoint.claimProofFingerprint, proofFingerprint);
  await writeFile(value.manifestPath, accepted.manifestText, 'utf8');

  const ready = await evaluation(value);
  assert.deepEqual(ready.readiness, { state: 'READY' });

  const changedProof = proof(ready.currentTranslationFingerprints, 'The wording of this material claim changed.');
  await writeFile(path.join(value.articleDir, 'claim-proof.json'), JSON.stringify(changedProof, null, 2) + '\n', 'utf8');
  const stale = await evaluation(value);
  assert.equal(stale.readiness.state, 'REVIEW_REQUIRED');
  assert.equal(stale.readiness.reason, 'CLAIM_PROOF_CHANGED');
});
