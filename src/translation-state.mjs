function requireLocaleList(requiredLocales) {
  if (!Array.isArray(requiredLocales) || requiredLocales.length === 0) {
    throw new Error('requiredLocales must be a non-empty array');
  }
  const normalized = requiredLocales.map((locale) => {
    if (typeof locale !== 'string' || locale.trim() === '') {
      throw new Error('requiredLocales must contain non-empty strings');
    }
    return locale.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('requiredLocales must not contain duplicates');
  }
  return normalized;
}

function toFingerprintMap(value, name) {
  if (value == null) return null;
  if (value instanceof Map) return new Map(value);
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a Map or object`);
  }
  return new Map(Object.entries(value));
}

function validFingerprint(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireKnownLocales(map, requiredLocales, name) {
  const required = new Set(requiredLocales);
  for (const [locale, fingerprint] of map) {
    if (!required.has(locale)) {
      throw new Error(`${name} contains unexpected locale: ${locale}`);
    }
    if (!validFingerprint(fingerprint)) {
      throw new Error(`${name} contains invalid fingerprint for locale: ${locale}`);
    }
  }
}

export function deriveTranslationState({
  requiredLocales,
  currentFingerprints,
  acceptedFingerprints = null
}) {
  const required = requireLocaleList(requiredLocales);
  const current = toFingerprintMap(currentFingerprints, 'currentFingerprints') ?? new Map();
  requireKnownLocales(current, required, 'currentFingerprints');

  const missingLocales = required.filter((locale) => !current.has(locale));
  if (missingLocales.length > 0) {
    return { state: 'INCOMPLETE', missingLocales };
  }

  const accepted = toFingerprintMap(acceptedFingerprints, 'acceptedFingerprints');
  if (accepted == null) {
    return { state: 'UNREVIEWED' };
  }
  requireKnownLocales(accepted, required, 'acceptedFingerprints');

  const missingAccepted = required.filter((locale) => !accepted.has(locale));
  if (missingAccepted.length > 0) {
    throw new Error(`acceptedFingerprints is malformed; missing required locales: ${missingAccepted.join(', ')}`);
  }

  const changedLocales = required.filter((locale) => current.get(locale) !== accepted.get(locale));
  if (changedLocales.length === 0) {
    return { state: 'SYNCED' };
  }
  if (changedLocales.length === required.length) {
    return { state: 'REVIEW_REQUIRED', changedLocales };
  }

  const changed = new Set(changedLocales);
  return {
    state: 'STALE',
    changedLocales,
    staleLocales: required.filter((locale) => !changed.has(locale))
  };
}

export function mayAdvanceTranslationCheckpoint({ requiredLocales, currentFingerprints, review }) {
  const required = requireLocaleList(requiredLocales);
  const current = toFingerprintMap(currentFingerprints, 'currentFingerprints') ?? new Map();
  requireKnownLocales(current, required, 'currentFingerprints');
  const missingLocales = required.filter((locale) => !current.has(locale));
  if (missingLocales.length > 0) return false;

  if (!review || review.result !== 'PASS') return false;
  if (review.reviewedFingerprints == null) return false;
  const reviewed = toFingerprintMap(review.reviewedFingerprints, 'review.reviewedFingerprints');
  requireKnownLocales(reviewed, required, 'review.reviewedFingerprints');
  if (required.some((locale) => !reviewed.has(locale))) return false;

  return required.every((locale) => reviewed.get(locale) === current.get(locale));
}
