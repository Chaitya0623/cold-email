import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, requireConfig } from './config.js';
import { createDraft } from './store.js';

const openai = new OpenAI({ apiKey: requireConfig('openAiApiKey') });

/* ── load company context ────────────────────────────────────────── */

const COMPANY_CONTEXT_PATH = resolve(
  process.cwd(),
  config.companyContextPath || 'src/company_context.txt',
);

let _companyContext = null;
const getCompanyContext = () => {
  if (_companyContext) return _companyContext;
  try {
    _companyContext = readFileSync(COMPANY_CONTEXT_PATH, 'utf-8');
  } catch {
    _companyContext = 'Lucia Protocol – Web3 analytics and identity platform.';
  }
  return _companyContext;
};

/* ── variant specs ───────────────────────────────────────────────── */

const VARIANT_SPECS = {
  short: {
    label: 'Short (3-4 sentences)',
    instruction:
      'Write a short, punchy email (3–4 sentences max). Get straight to the point. One clear CTA.',
  },
  medium: {
    label: 'Medium (1 short paragraph + CTA)',
    instruction:
      'Write a medium-length email (~100-150 words). Open with a relevant hook about the prospect, bridge to the product value, close with a CTA.',
  },
  personalized: {
    label: 'Highly personalized (research-driven)',
    instruction:
      'Write a highly personalized email (~150-200 words). Reference specific details about the prospect\'s company, role, and publicly known initiatives. Show deep understanding of their challenges. Connect each point to a specific Lucia capability. Include a strong, specific CTA.',
  },
};

const CTA_MAP = {
  call: 'Ask for a 10-15 minute call to discuss further.',
  demo: 'Offer a live product demo tailored to their use case.',
  reply: 'Ask them to reply if interested, keeping it low-pressure.',
};

/* ── build the generation prompt ─────────────────────────────────── */

const buildPrompt = ({ prospectEmail, prospectName, prospectRole, prospectCompany, sourceContext, variant, cta }) => {
  const variantSpec = VARIANT_SPECS[variant] || VARIANT_SPECS.short;
  const ctaSpec = CTA_MAP[cta] || CTA_MAP.reply;

  return [
    {
      role: 'system',
      content: `You are a world-class cold email copywriter for Lucia Protocol. Your emails are concise, genuine, and never feel like spam. You always explain WHY you're reaching out with a specific, verifiable reason.

COMPANY CONTEXT (your product):
${getCompanyContext()}

RULES:
1. Never lie or fabricate facts about the prospect's company.
2. If you don't know something specific, use what you reasonably can infer from their role/company.
3. Every email MUST include a "why this line exists" rationale — a brief parenthetical or side-note explaining the strategic purpose of each paragraph so the sender understands the intent before approving.
4. Sign off as "${config.senderName}".
5. Keep it professional but human — no corporate jargon.

RESPOND WITH JSON:
{
  "subject": "...",
  "body": "... (the actual email to send)",
  "rationale": "... (paragraph-by-paragraph explanation of WHY each line exists, intended for the sender's eyes only — not included in the email)"
}`,
    },
    {
      role: 'user',
      content: `Generate a cold outreach email with these parameters:

PROSPECT:
- Email: ${prospectEmail}
- Name: ${prospectName || 'unknown'}
- Role: ${prospectRole || 'unknown'}
- Company: ${prospectCompany || 'unknown'}
${sourceContext ? `- Additional context: ${sourceContext}` : ''}

VARIANT: ${variantSpec.label}
${variantSpec.instruction}

CTA STYLE: ${ctaSpec}

Generate the email now.`,
    },
  ];
};

/* ── parse AI response ───────────────────────────────────────────── */

const tryParseJson = (raw) => {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```json\s*/gm, '')
    .replace(/^```\s*/gm, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

/**
 * Sanitize and format email text:
 * - Replace en-dashes (–) and em-dashes (—) with semicolons
 * - Collapse multiple blank lines into one
 * - Trim trailing whitespace per line
 * - Ensure exactly one blank line between paragraphs
 */
export const formatEmailBody = (text = '') =>
  text
    .replace(/[\u2013\u2014]/g, ';')       // en-dash & em-dash → ;
    .replace(/[ \t]+$/gm, '')              // trim trailing spaces per line
    .replace(/\n{3,}/g, '\n\n')            // collapse 3+ newlines → 2
    .trim();

/* ── public: generate drafts ─────────────────────────────────────── */

/**
 * Generate email drafts for a single prospect.
 *
 * @param {Object} prospect
 * @param {string[]} variants  – 'short' | 'medium' | 'personalized'
 * @param {string} cta         – 'call' | 'demo' | 'reply'
 * @param {string} threadUrl   – optional HN thread link
 * @returns {Promise<Object[]>} array of created drafts
 */
export const generateDrafts = async (
  { prospectEmail, prospectName, prospectRole, prospectCompany, sourceContext },
  { variants = ['short'], cta = 'reply', threadUrl = '' } = {},
) => {
  const results = [];

  for (const variant of variants) {
    const messages = buildPrompt({
      prospectEmail,
      prospectName,
      prospectRole,
      prospectCompany,
      sourceContext,
      variant,
      cta,
    });

    const completion = await openai.chat.completions.create({
      model: config.openAiModel,
      temperature: 0.7,
      messages,
      response_format: { type: 'json_object' },
    });

    const parsed = tryParseJson(completion.choices[0]?.message?.content);
    if (!parsed?.subject || !parsed?.body) {
      console.warn(`⚠ Failed to parse ${variant} variant — skipping.`);
      continue;
    }

    const draft = createDraft({
      prospectEmail,
      prospectName: prospectName || 'unknown',
      prospectRole: prospectRole || '',
      prospectCompany: prospectCompany || '',
      subject: formatEmailBody(parsed.subject),
      body: formatEmailBody(parsed.body),
      rationale: parsed.rationale || '',
      variant,
      cta,
      threadUrl,
      sourceContext: sourceContext || '',
    });

    results.push(draft);
  }

  return results;
};

/* ── public: ask about Lucia's value for a specific company ──────── */

export const askLuciaValue = async (query) => {
  const messages = [
    {
      role: 'system',
      content: `You are a sales strategist for Lucia Protocol. Answer questions about how Lucia's products align with a specific company, industry, or use case. Be specific and actionable.

COMPANY CONTEXT:
${getCompanyContext()}

Be concise. Use bullet points. Focus on concrete value props that would matter to the prospect.`,
    },
    {
      role: 'user',
      content: query,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: config.openAiModel,
    temperature: 0.5,
    messages,
  });

  return completion.choices[0]?.message?.content || 'No response generated.';
};
