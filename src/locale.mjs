const LOCALE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const MAX_LOCALE_LENGTH = 64;

export function requireLocaleToken(value, name = 'locale') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  const locale = value.trim();
  if (locale.length > MAX_LOCALE_LENGTH || !LOCALE_RE.test(locale)) {
    throw new Error(`${name} must be a compact BCP47-style token`);
  }

  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(locale);
  } catch {
    throw new Error(`${name} must be a structurally valid BCP47 locale token`);
  }
  if (canonical !== locale) {
    throw new Error(`${name} must use canonical BCP47 form: ${canonical}`);
  }
  return locale;
}
