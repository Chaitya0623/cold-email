import { parse } from 'node-html-parser';

const BASE_URL = 'https://news.ycombinator.com';

const decodeHtmlEntities = (input = '') =>
  input
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#x60;/g, '`');

const formatWhitespace = (text = '') =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();

const parseThreadId = (link) => {
  if (!link) return null;
  const url = new URL(link);
  if (url.searchParams.has('id')) {
    return Number(url.searchParams.get('id'));
  }

  const lastSegment = url.pathname.split('/').filter(Boolean).pop();
  if (lastSegment && /^\d+$/.test(lastSegment)) {
    return Number(lastSegment);
  }
  return null;
};

const fetchPageHtml = async (threadId, page = 1) => {
  const suffix = page > 1 ? `&p=${page}` : '';
  const url = `${BASE_URL}/item?id=${threadId}${suffix}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'cold-email-bot/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Failed to load thread HTML (status ${response.status}).`);
  }
  return response.text();
};

const extractThreadMeta = (root) => {
  const titleAnchor = root.querySelector('span.titleline a');
  const metaRow = root.querySelector('.subtext') || root.querySelector('.subline');
  const submitter = metaRow?.querySelector('.hnuser')?.text || 'unknown';
  const originalLink = titleAnchor?.getAttribute('href');

  return {
    title: titleAnchor?.text || 'Hacker News discussion',
    submitter,
    originalUrl: originalLink?.startsWith('item?id=')
      ? `${BASE_URL}/${originalLink}`
      : originalLink,
  };
};

const extractCommentsFromPage = (root, limit, bucket) => {
  const rows = root.querySelectorAll('tr.athing');
  for (const row of rows) {
    if (!(row.classList?.contains?.('comtr') || row.classNames?.includes?.('comtr'))) continue;
    if (bucket.length >= limit) break;
    const commentId = row.getAttribute('id');
    const author = row.querySelector('.hnuser')?.text || 'anonymous';
    const commText = row.querySelector('.commtext');
    if (!commText) continue;
    const html = commText.innerHTML;
    const text = formatWhitespace(decodeHtmlEntities(commText.text));
    if (!text) continue;
    const ageAnchor = row.querySelector('.age a');

    bucket.push({
      id: Number(commentId),
      author,
      html,
      text,
      timeLabel: ageAnchor?.text || '',
      permalink: ageAnchor
        ? `${BASE_URL}/${ageAnchor.getAttribute('href')}`
        : undefined,
    });
  }
};

const hasMoreLink = (root) => Boolean(root.querySelector('a.morelink'));

export const collectThread = async (threadUrl, options = {}) => {
  const threadId = parseThreadId(threadUrl);
  if (!threadId) {
    throw new Error(
      `Unable to derive a Hacker News item ID from URL: ${threadUrl}`,
    );
  }

  const maxComments = options.maxComments ?? Infinity;
  const maxPages = options.maxPages ?? 3;

  const comments = [];
  let threadMeta = null;

  for (let page = 1; page <= maxPages; page += 1) {
    if (comments.length >= maxComments) break;
    const html = await fetchPageHtml(threadId, page);
    const root = parse(html);
    if (!threadMeta) {
      threadMeta = extractThreadMeta(root);
    }

    extractCommentsFromPage(root, maxComments, comments);

    if (!hasMoreLink(root)) {
      break;
    }
  }

  if (!comments.length) {
    throw new Error('No comments could be extracted from the thread HTML.');
  }

  return {
    threadId,
    link: `${BASE_URL}/item?id=${threadId}`,
    title: threadMeta?.title || 'Hacker News discussion',
    submitter: threadMeta?.submitter || 'unknown',
    originalUrl: threadMeta?.originalUrl,
    totalComments: comments.length,
    comments,
  };
};

