import OpenAI from 'openai';
import { config, requireConfig } from './config.js';
import {
  detectDeterministicProspects,
  filterProspectsByTld,
} from './prospectDetector.js';

const openai = new OpenAI({
  apiKey: requireConfig('openAiApiKey'),
});

const chunkComments = (comments, maxChars = 16000) => {
  const selected = [];
  let running = 0;

  for (const comment of comments) {
    const snippet = `[${comment.author ?? 'anonymous'}] ${comment.text}`;
    if (!snippet.trim()) continue;
    if (running + snippet.length > maxChars) break;
    selected.push(snippet);
    running += snippet.length;
  }
  return selected.join('\n\n');
};

const tryParseJson = (raw) => {
  if (!raw) return [];
  const sanitized = raw
    .replace(/^```json/gm, '')
    .replace(/^```/gm, '')
    .trim();
  try {
    const parsed = JSON.parse(sanitized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const fallbackRegexExtract = (text) => {
  const matches = text.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  );
  if (!matches) return [];
  const unique = [...new Set(matches)];
  return unique.map((email) => ({
    email,
    handle: 'unknown',
    context: 'Regex fallback',
    confidence: 0.4,
  }));
};

const dedupeProspects = (lists) => {
  const merged = new Map();
  lists
    .flat()
    .filter(Boolean)
    .forEach((prospect) => {
      if (!prospect?.email) return;
      const email = prospect.email.toLowerCase();
      const incoming = { ...prospect, email };
      const existing = merged.get(email);
      if (!existing || (incoming.confidence ?? 0) > (existing.confidence ?? 0)) {
        merged.set(email, incoming);
      }
    });

  return [...merged.values()].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  );
};

const normalize = (value = '') => value.toLowerCase();

const buildSourceComment = (comment) => ({
  id: comment.id,
  author: comment.author,
  timeLabel: comment.timeLabel,
  permalink: comment.permalink,
  text: comment.text,
  html: comment.html,
});

const findCommentByEmail = (email, comments = []) => {
  if (!email) return null;
  const target = normalize(email);
  return (
    comments.find(
      (comment) => comment.text?.toLowerCase().includes(target),
    ) || null
  );
};

const findCommentBySnippet = (snippet, comments = []) => {
  if (!snippet) return null;
  const target = normalize(snippet).slice(0, 200);
  if (!target.trim()) return null;
  return (
    comments.find((comment) =>
      comment.text?.toLowerCase().includes(target),
    ) || null
  );
};

const attachSourceContext = (prospects, comments = []) =>
  prospects.map((prospect) => {
    const byEmail = findCommentByEmail(prospect.email, comments);
    const byContext =
      byEmail ||
      findCommentBySnippet(prospect.context, comments) ||
      findCommentBySnippet(prospect.reason, comments);
    if (!byContext) return prospect;
    return {
      ...prospect,
      sourceComment: buildSourceComment(byContext),
    };
  });

export const extractProspects = async (thread) => {
  const deterministicProspects = detectDeterministicProspects(thread.comments);
  const promptBody = chunkComments(thread.comments);

  const messages = [
    {
      role: 'system',
      content:
        'You are an expert at reading Hacker News comments and uncovering obfuscated contact info. Emails might be written like "john [at] gmail [dot] com", "me (at) startup dot io", or split across words. Normalize to RFC 5322 compliant lowercase emails and explain the relevance. Respond with JSON: { "prospects": [ { "email": "...", "handle": "...", "context": "...", "confidence": 0-1, "reason": "..." } ] }.',
    },
    {
      role: 'user',
      content: `Thread title: ${thread.title}\nHN link: ${thread.link}\n\nScan the following comment excerpts. Surface up to ${config.maxProspects} prospects who clearly shared or implied an email address (even if obfuscated). Normalize any disguised forms into a proper email before returning.\n\n${promptBody}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: config.openAiModel,
    temperature: config.openAiTemperature,
    messages,
    response_format: { type: 'json_object' },
  });

  const assistantMessage = completion.choices[0]?.message?.content;
  const parsed =
    tryParseJson(assistantMessage)?.prospects ||
    tryParseJson(assistantMessage) ||
    [];

  let prospects = parsed
    .filter((entry) => entry?.email)
    .map((entry) => ({
      email: String(entry.email).trim(),
      handle: entry.handle || entry.author || 'unknown',
      context: entry.context || entry.comment || '',
      confidence: Number(entry.confidence ?? 0.5),
      reason: entry.reason || entry.justification || '',
    }))
    .filter(
      (prospect) =>
        prospect.confidence >= config.minConfidence &&
        /@/.test(prospect.email),
    );

  const fallbackProspects =
    prospects.length || deterministicProspects.length
      ? []
      : fallbackRegexExtract(promptBody);

  const filtered = filterProspectsByTld(
    dedupeProspects([
      deterministicProspects,
      prospects,
      fallbackProspects,
    ]),
  );

  const limited = filtered.slice(0, config.maxProspects);
  return attachSourceContext(limited, thread.comments);
};

