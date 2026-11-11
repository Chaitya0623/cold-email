import { createInterface } from 'node:readline';
import { config, requireConfig } from './config.js';
import { collectThread } from './hnCollector.js';
import { extractProspects } from './emailExtractor.js';
import { generateDrafts, askLuciaValue, formatEmailBody } from './draftGenerator.js';
import { deliverDraft } from './emailSender.js';
import * as store from './store.js';

/* ── colours (ANSI) ──────────────────────────────────────────────── */
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const STATUS_COLORS = {
  drafted: c.yellow,
  approved: c.green,
  queued: c.cyan,
  sent: c.dim,
  failed: c.red,
  rejected: c.gray,
};

/* ── helpers ──────────────────────────────────────────────────────── */

const print = (msg = '') => console.log(msg);
const hr = () => print(`${c.dim}${'─'.repeat(60)}${c.reset}`);

const formatStatus = (status) =>
  `${STATUS_COLORS[status] || ''}${status.toUpperCase()}${c.reset}`;

const shortBody = (body = '', maxLen = 120) =>
  body.replace(/\n/g, ' ').slice(0, maxLen) + (body.length > maxLen ? '…' : '');

const printDraftRow = (d) => {
  print(
    `  ${c.bold}${d.id}${c.reset}  ${formatStatus(d.status)}  ${c.cyan}${d.prospectEmail}${c.reset}  [${d.variant}/${d.cta}]`,
  );
  print(`    ${c.dim}Subject: ${d.subject}${c.reset}`);
};

const printDraftFull = (d) => {
  hr();
  print(`${c.bold}Draft ${d.id}${c.reset}  ${formatStatus(d.status)}`);
  print(`${c.cyan}To:${c.reset}       ${d.prospectEmail}`);
  print(`${c.cyan}Name:${c.reset}     ${d.prospectName}`);
  print(`${c.cyan}Role:${c.reset}     ${d.prospectRole || '—'}`);
  print(`${c.cyan}Company:${c.reset}  ${d.prospectCompany || '—'}`);
  print(`${c.cyan}Variant:${c.reset}  ${d.variant}  ${c.cyan}CTA:${c.reset} ${d.cta}`);
  print(`${c.cyan}Created:${c.reset}  ${d.createdAt}`);
  if (d.sentAt) print(`${c.cyan}Sent:${c.reset}     ${d.sentAt}`);
  hr();
  print(`${c.bold}Subject:${c.reset} ${d.subject}`);
  print();
  print(d.body);
  hr();
  if (d.rationale) {
    print(`${c.magenta}${c.bold}📋 Why each line exists (sender-only rationale):${c.reset}`);
    print(`${c.magenta}${d.rationale}${c.reset}`);
    hr();
  }
};

/* ── command handlers ────────────────────────────────────────────── */

const cmdHelp = () => {
  print(`
${c.bold}Lucia Outreach CLI — Commands${c.reset}

  ${c.cyan}/help${c.reset}                                Show this help
  ${c.cyan}/list${c.reset}                                List unsent drafts
  ${c.cyan}/list all${c.reset}                            List all drafts
  ${c.cyan}/list <status>${c.reset}                       List by status (drafted/approved/sent/…)
  ${c.cyan}/view <id>${c.reset}                           View full draft + rationale
  ${c.cyan}/draft <email>${c.reset}                       Generate drafts for a prospect
      ${c.dim}--name <name>  --role <role>  --company <company>${c.reset}
      ${c.dim}--context <extra info>  --cta call|demo|reply${c.reset}
      ${c.dim}--variant short|medium|personalized|all${c.reset}
  ${c.cyan}/approve <id>${c.reset}                        Approve a draft for sending
  ${c.cyan}/reject <id>${c.reset}                         Reject a draft
  ${c.cyan}/edit <id>${c.reset}                           Edit subject & body inline
  ${c.cyan}/send <id>${c.reset}                           Send a single approved draft
  ${c.cyan}/send all${c.reset}                            Send all approved drafts
  ${c.cyan}/reformat${c.reset}                            Reformat all draft bodies (fix dashes & spacing)
  ${c.cyan}/ask <question>${c.reset}                      Ask how Lucia fits a company/use-case
  ${c.cyan}/collect <hn-url>${c.reset}                    Collect prospects from HN thread
  ${c.cyan}/quit${c.reset}                                Exit
`);
};

const cmdList = (args) => {
  const filter = args.trim().toLowerCase();
  let drafts;
  if (filter === 'all') {
    drafts = store.getAll();
  } else if (['drafted', 'approved', 'queued', 'sent', 'failed', 'rejected'].includes(filter)) {
    drafts = store.getByStatus(filter);
  } else {
    drafts = store.getUnsent();
  }

  if (!drafts.length) {
    print(`${c.dim}No drafts found.${c.reset}`);
    return;
  }

  print(`\n${c.bold}${drafts.length} draft(s):${c.reset}`);
  drafts.forEach(printDraftRow);
  print();
};

const cmdView = (id) => {
  if (!id) { print(`${c.red}Usage: /view <id>${c.reset}`); return; }
  const d = store.getById(id.trim());
  if (!d) { print(`${c.red}Draft "${id}" not found.${c.reset}`); return; }
  printDraftFull(d);
};

const cmdApprove = (id) => {
  if (!id) { print(`${c.red}Usage: /approve <id>${c.reset}`); return; }
  const d = store.setStatus(id.trim(), 'approved');
  if (!d) { print(`${c.red}Draft "${id}" not found.${c.reset}`); return; }
  print(`${c.green}✔ Draft ${d.id} approved.${c.reset}`);
};

const cmdReject = (id) => {
  if (!id) { print(`${c.red}Usage: /reject <id>${c.reset}`); return; }
  const d = store.setStatus(id.trim(), 'rejected');
  if (!d) { print(`${c.red}Draft "${id}" not found.${c.reset}`); return; }
  print(`${c.yellow}✘ Draft ${d.id} rejected.${c.reset}`);
};

const cmdEdit = async (id, rl) => {
  if (!id) { print(`${c.red}Usage: /edit <id>${c.reset}`); return; }
  const d = store.getById(id.trim());
  if (!d) { print(`${c.red}Draft "${id}" not found.${c.reset}`); return; }

  printDraftFull(d);

  const ask = (q) => new Promise((res) => rl.question(`${c.cyan}${q}${c.reset}`, res));

  const newSubject = await ask(`New subject (Enter to keep): `);
  if (newSubject.trim()) {
    store.updateDraft(d.id, { subject: newSubject.trim() });
  }

  print(`${c.dim}Enter new body (type END on a line by itself to finish, or just press Enter to keep):${c.reset}`);
  const bodyLines = [];
  let firstLine = true;
  const collectBody = () =>
    new Promise((res) => {
      const onLine = (line) => {
        if (firstLine && line.trim() === '') {
          rl.removeListener('line', onLine);
          return res(null);
        }
        firstLine = false;
        if (line.trim() === 'END') {
          rl.removeListener('line', onLine);
          return res(bodyLines.join('\n'));
        }
        bodyLines.push(line);
      };
      rl.on('line', onLine);
    });

  const newBody = await collectBody();
  if (newBody) {
    store.updateDraft(d.id, { body: newBody });
  }

  const updated = store.getById(d.id);
  print(`${c.green}✔ Draft ${d.id} updated.${c.reset}`);
  printDraftFull(updated);
};

const cmdDraft = async (argsRaw) => {
  const args = argsRaw.trim();
  if (!args) {
    print(`${c.red}Usage: /draft <email> [--name X] [--role X] [--company X] [--context X] [--cta call|demo|reply] [--variant short|medium|personalized|all]${c.reset}`);
    return;
  }

  // Parse flags
  const tokens = args.match(/"[^"]*"|\S+/g) || [];
  const email = tokens[0];
  const flags = {};
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].startsWith('--') && i + 1 < tokens.length) {
      const key = tokens[i].slice(2);
      const val = tokens[i + 1].replace(/^"|"$/g, '');
      flags[key] = val;
      i++;
    }
  }

  const prospect = {
    prospectEmail: email,
    prospectName: flags.name || '',
    prospectRole: flags.role || '',
    prospectCompany: flags.company || '',
    sourceContext: flags.context || '',
  };

  const cta = flags.cta || 'reply';
  const variantArg = flags.variant || 'short';
  const variants =
    variantArg === 'all'
      ? ['short', 'medium', 'personalized']
      : [variantArg];

  print(`\n${c.cyan}⏳ Generating ${variants.length} draft(s) for ${email}...${c.reset}\n`);

  try {
    const drafts = await generateDrafts(prospect, { variants, cta });
    if (!drafts.length) {
      print(`${c.red}No drafts generated.${c.reset}`);
      return;
    }
    print(`${c.green}✔ Created ${drafts.length} draft(s):${c.reset}\n`);
    drafts.forEach(printDraftFull);
  } catch (err) {
    print(`${c.red}Error generating drafts: ${err.message}${c.reset}`);
  }
};

const cmdSend = async (idArg) => {
  const id = idArg.trim();
  if (!id) {
    print(`${c.red}Usage: /send <id> or /send all${c.reset}`);
    return;
  }

  const toSend =
    id === 'all'
      ? store.getByStatus('approved')
      : [store.getById(id)].filter(Boolean);

  if (!toSend.length) {
    print(`${c.red}No approved draft(s) found.${c.reset}`);
    return;
  }

  for (const draft of toSend) {
    if (draft.status !== 'approved') {
      print(`${c.yellow}⚠ Draft ${draft.id} is "${draft.status}" — approve it first.${c.reset}`);
      continue;
    }
    try {
      print(`${c.cyan}Sending ${draft.id} → ${draft.prospectEmail}...${c.reset}`);
      await deliverDraft(draft);
      store.setStatus(draft.id, 'sent');
      print(`${c.green}✔ Sent ${draft.id}.${c.reset}`);
    } catch (err) {
      store.setStatus(draft.id, 'failed');
      print(`${c.red}✘ Failed ${draft.id}: ${err.message}${c.reset}`);
    }
  }
};

const cmdReformat = () => {
  const drafts = store.getAll();
  if (!drafts.length) {
    print(`${c.dim}No drafts to reformat.${c.reset}`);
    return;
  }
  let count = 0;
  for (const d of drafts) {
    const newSubject = formatEmailBody(d.subject);
    const newBody = formatEmailBody(d.body);
    const newRationale = formatEmailBody(d.rationale);
    if (newSubject !== d.subject || newBody !== d.body || newRationale !== d.rationale) {
      store.updateDraft(d.id, { subject: newSubject, body: newBody, rationale: newRationale });
      count++;
    }
  }
  print(`${c.green}✔ Reformatted ${count}/${drafts.length} draft(s).${c.reset}`);
};

const cmdAsk = async (query) => {
  if (!query.trim()) {
    print(`${c.red}Usage: /ask <question about a company or use case>${c.reset}`);
    return;
  }
  print(`\n${c.cyan}⏳ Thinking...${c.reset}\n`);
  try {
    const answer = await askLuciaValue(query.trim());
    print(answer);
    print();
  } catch (err) {
    print(`${c.red}Error: ${err.message}${c.reset}`);
  }
};

const cmdCollect = async (url) => {
  if (!url.trim()) {
    print(`${c.red}Usage: /collect <hn-thread-url>${c.reset}`);
    return;
  }

  print(`\n${c.cyan}🔍 Collecting thread data...${c.reset}`);
  try {
    const thread = await collectThread(url.trim(), {
      maxComments: config.maxComments,
      maxPages: config.maxPages,
    });
    print(`Found ${thread.comments.length} comments.`);

    print(`${c.cyan}🤖 Extracting prospects...${c.reset}`);
    const prospects = await extractProspects(thread);
    if (!prospects.length) {
      print(`${c.yellow}No prospects found.${c.reset}`);
      return;
    }

    print(`\n${c.green}Found ${prospects.length} prospect(s). Generating drafts...${c.reset}\n`);

    const existingEmails = new Set(
      store.getAll().map((d) => d.prospectEmail.toLowerCase()),
    );

    let totalDrafts = 0;
    let skipped = 0;
    for (const p of prospects) {
      if (existingEmails.has(p.email.toLowerCase())) {
        skipped++;
        print(`  ${c.dim}⏭ ${p.email} — already in drafts, skipping${c.reset}`);
        continue;
      }
      try {
        const contextSnippet = p.sourceComment?.text || p.context || p.reason || '';
        const drafts = await generateDrafts(
          {
            prospectEmail: p.email,
            prospectName: p.handle || '',
            prospectRole: '',
            prospectCompany: '',
            sourceContext: contextSnippet.slice(0, 500),
          },
          { variants: ['short'], cta: 'reply', threadUrl: url.trim() },
        );
        totalDrafts += drafts.length;
        print(`  ${c.green}✔${c.reset} ${c.cyan}${p.email}${c.reset} — ${drafts.length} draft(s) created`);
      } catch (err) {
        print(`  ${c.red}⚠${c.reset} ${p.email} — ${err.message}`);
      }
    }

    if (skipped) print(`\n${c.dim}⏭ Skipped ${skipped} prospect(s) already in drafts.${c.reset}`);
    print(`\n${c.bold}${totalDrafts} new draft(s) ready.${c.reset} Use ${c.cyan}/list${c.reset} to review, ${c.cyan}/approve <id>${c.reset} then ${c.cyan}/send <id>${c.reset}.\n`);
  } catch (err) {
    print(`${c.red}Error: ${err.message}${c.reset}`);
  }
};

/* ── REPL loop ───────────────────────────────────────────────────── */

export const startCli = () => {
  requireConfig('openAiApiKey');
  requireConfig('sourceEmail');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.bold}lucia>${c.reset} `,
  });

  print(`
${c.bold}${c.cyan}╔═══════════════════════════════════════════════════╗
║       Lucia Protocol — Outreach Drafting CLI      ║
╚═══════════════════════════════════════════════════╝${c.reset}

Type ${c.cyan}/help${c.reset} for available commands.
`);

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    const [cmd, ...rest] = trimmed.split(/\s+/);
    const args = rest.join(' ');

    switch (cmd.toLowerCase()) {
      case '/help':
        cmdHelp();
        break;
      case '/list':
        cmdList(args);
        break;
      case '/view':
        cmdView(args);
        break;
      case '/draft':
        await cmdDraft(args);
        break;
      case '/approve':
        cmdApprove(args);
        break;
      case '/reject':
        cmdReject(args);
        break;
      case '/edit':
        await cmdEdit(args, rl);
        break;
      case '/send':
        await cmdSend(args);
        break;
      case '/reformat':
        cmdReformat();
        break;
      case '/ask':
        await cmdAsk(args);
        break;
      case '/collect':
        await cmdCollect(args);
        break;
      case '/quit':
      case '/exit':
        print(`${c.dim}Goodbye.${c.reset}`);
        rl.close();
        process.exit(0);
        break;
      default:
        print(`${c.red}Unknown command "${cmd}". Type /help for options.${c.reset}`);
    }

    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
};
