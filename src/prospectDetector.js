const DIRECT_EMAIL_REGEX =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_VALIDATION_REGEX =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const COMMON_TLDS = new Set([
  'com',
  'net',
  'org',
  'io',
  'ai',
  'co',
  'co.uk',
  'us',
  'ca',
  'de',
  'fr',
  'it',
  'es',
  'uk',
  'in',
  'tv',
  'me',
  'gg',
  'vc',
  'app',
  'dev',
  'xyz',
  'cloud',
  'digital',
  'studio',
  'solutions',
  'finance',
  'health',
  'bio',
  'shop',
  'space',
  'care',
  'careers',
  'jobs',
  'works',
  'team',
  'agency',
  'company',
  'support',
  'systems',
  'global',
  'world',
  'partners',
  'capital',
  'software',
  'group',
  'today',
  'run',
  'tools',
  'design',
  'data',
  'consulting',
  'solutions',
]);

const OBFS_AT = /\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\)|\{?\s*at\s*\}?|\s+at\s+|\sat\b|\bat\s)/gi;
const OBFS_DOT =
  /\s*(?:\.\s*|\[\s*dot\s*\]|\(\s*dot\s*\)|\{?\s*dot\s*\}?|\s+dot\s+|\s+period\s+|\s*d0t\s+)/gi;

const sanitizeLocal = (local = '') =>
  local.replace(/[^a-z0-9._%+-]/gi, '').toLowerCase();

const normalizeDomain = (domain = '') =>
  domain
    .replace(OBFS_DOT, '.')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9.-]/gi, '')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '')
    .toLowerCase();

const extractAllowedTld = (domain) => {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join('.');
  if (COMMON_TLDS.has(lastTwo)) return lastTwo;
  const lastOne = parts[parts.length - 1];
  return COMMON_TLDS.has(lastOne) ? lastOne : null;
};

const isLikelyEmail = (email = '') => {
  if (!EMAIL_VALIDATION_REGEX.test(email)) return false;
  const [, domain = ''] = email.toLowerCase().split('@');
  return Boolean(extractAllowedTld(domain));
};

const createContextSnippet = (text = '', limit = 280) =>
  text.length > limit ? `${text.slice(0, limit - 3)}...` : text;

const collectDirectMatches = (text, context, bucket, seen) => {
  if (!text) return;
  const matches = text.match(DIRECT_EMAIL_REGEX);
  if (!matches) return;
  matches.forEach((email) => {
    const normalized = email.trim().toLowerCase();
    if (!isLikelyEmail(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    bucket.push({
      email: normalized,
      handle: 'unknown',
      context: createContextSnippet(context),
      confidence: 0.9,
      reason: 'Direct email pattern match',
    });
  });
};

const collectObfuscatedMatches = (text, context, bucket, seen) => {
  if (!text) return;
  const pattern =
    /([a-z0-9._%+-]+)\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\)|\{?\s*at\s*\}?|\s+at\s+)\s*([a-z0-9._%+-\s]+(?:\s*(?:\.\s*|\[\s*dot\s*\]|\(\s*dot\s*\)|\{?\s*dot\s*\}?|\s+dot\s+|\s+period\s+)\s*[a-z0-9._%+-\s]+)+)/gi;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const local = sanitizeLocal(match[1]);
    const domain = normalizeDomain(match[2]);
    if (!local || !domain) continue;
    const candidate = `${local}@${domain}`;
    if (!isLikelyEmail(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    bucket.push({
      email: candidate,
      handle: 'unknown',
      context: createContextSnippet(context),
      confidence: 0.7,
      reason: 'Obfuscated email pattern match',
    });
  }
};

export const detectDeterministicProspects = (comments = []) => {
  const prospects = [];
  const seen = new Set();

  comments.forEach((comment) => {
    collectDirectMatches(comment.text, comment.text, prospects, seen);
    collectObfuscatedMatches(comment.text, comment.text, prospects, seen);
  });

  return prospects;
};

export const filterProspectsByTld = (prospects = []) =>
  prospects.filter((prospect) => isLikelyEmail(prospect?.email ?? ''));

