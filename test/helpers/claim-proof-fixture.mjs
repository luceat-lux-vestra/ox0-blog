import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  articleClaimProofFingerprintV1
} from '../../src/article-claim-proof.mjs';
import { evaluateArticleBundle } from '../../src/article-evaluation.mjs';
import { loadArticleManifest } from '../../src/article-manifest.mjs';
import { MarkedCompiler } from '../../src/compiler/marked-compiler.mjs';

export async function writePassingClaimProof({ repoRoot, manifestPath }) {
  const loaded = await loadArticleManifest({ repoRoot, manifestPath });
  const evaluation = await evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
  const proof = {
    version: 1,
    coveredTranslationFingerprints: evaluation.currentTranslationFingerprints,
    claims: [{
      id: 'fixture-proof',
      kind: 'fact',
      statement: 'This test fixture binds claim proof to the exact current Article source.',
      evidence: [{
        role: 'repository_evidence',
        url: 'https://github.com/luceat-lux-vestra/ox0-blog',
        relevance: 'The test fixture is evidence about this repository contract.'
      }],
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
  await writeFile(path.join(loaded.articleDir, 'claim-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  return {
    proof,
    fingerprint: articleClaimProofFingerprintV1(proof),
    translationFingerprints: evaluation.currentTranslationFingerprints,
    articleSourceFingerprint: evaluation.articleSourceFingerprint
  };
}
