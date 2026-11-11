import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_PATH = resolve(process.cwd(), 'data', 'drafts.json');

const VALID_STATUSES = new Set([
  'drafted',
  'approved',
  'queued',
  'sent',
  'failed',
  'rejected',
]);

/* ── helpers ─────────────────────────────────────────────────────── */

const ensureDir = () => {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const load = () => {
  ensureDir();
  if (!existsSync(STORE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return [];
  }
};

const save = (drafts) => {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(drafts, null, 2), 'utf-8');
};

/* ── public API ──────────────────────────────────────────────────── */

export const createDraft = ({
  prospectEmail,
  prospectName = 'unknown',
  prospectRole = '',
  prospectCompany = '',
  subject,
  body,
  rationale = '',
  variant = 'medium',
  cta = 'reply',
  threadUrl = '',
  sourceContext = '',
}) => {
  const drafts = load();
  const draft = {
    id: randomUUID().slice(0, 8),
    prospectEmail,
    prospectName,
    prospectRole,
    prospectCompany,
    subject,
    body,
    rationale,
    variant,
    cta,
    status: 'drafted',
    threadUrl,
    sourceContext,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sentAt: null,
  };
  drafts.push(draft);
  save(drafts);
  return draft;
};

export const getAll = () => load();

export const getById = (id) => load().find((d) => d.id === id) ?? null;

export const getUnsent = () =>
  load().filter((d) => !['sent', 'rejected'].includes(d.status));

export const getByStatus = (status) =>
  load().filter((d) => d.status === status);

export const updateDraft = (id, updates) => {
  const drafts = load();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  drafts[idx] = {
    ...drafts[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  save(drafts);
  return drafts[idx];
};

export const setStatus = (id, status) => {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid status "${status}". Valid: ${[...VALID_STATUSES].join(', ')}`);
  }
  const extras = status === 'sent' ? { sentAt: new Date().toISOString() } : {};
  return updateDraft(id, { status, ...extras });
};

export const deleteDraft = (id) => {
  const drafts = load();
  const filtered = drafts.filter((d) => d.id !== id);
  if (filtered.length === drafts.length) return false;
  save(filtered);
  return true;
};

export const clearAll = () => {
  save([]);
};
