import { config, requireConfig } from './config.js';
import { collectThread } from './hnCollector.js';
import { extractProspects } from './emailExtractor.js';
import { generateDrafts } from './draftGenerator.js';
import { startCli } from './cli.js';
import * as store from './store.js';

const assertEnv = () => {
  requireConfig('openAiApiKey');
  requireConfig('sourceEmail');
};

const formatProspect = (prospect) =>
  `${prospect.email} (confidence: ${prospect.confidence ?? 'n/a'})`;

const main = async () => {
  const threadUrl = process.argv[2];
  if (!threadUrl) {
    // No URL — launch CLI directly
    startCli();
    return;
  }

  assertEnv();

  console.info('🔍 Collecting thread data...');
  const thread = await collectThread(threadUrl, {
    maxComments: config.maxComments,
    maxPages: config.maxPages,
  });
  console.info(`Found ${thread.comments.length} comments to analyze.`);

  console.info('🤖 Extracting prospects with OpenAI...');
  const prospects = await extractProspects(thread);
  if (!prospects.length) {
    console.warn('No prospects discovered. Launching CLI anyway...');
    startCli();
    return;
  }

  console.info(`\n✅ Found ${prospects.length} prospect(s):\n`);
  prospects.forEach((prospect, idx) => {
    console.info(`  #${idx + 1}: ${formatProspect(prospect)}`);
    if (prospect.sourceComment) {
      const { author, timeLabel, permalink } = prospect.sourceComment;
      const meta = [author && `author: ${author}`, timeLabel && `age: ${timeLabel}`]
        .filter(Boolean)
        .join(' | ');
      if (meta) console.info(`    ↳ ${meta}`);
      if (permalink) console.info(`    ↳ ${permalink}`);
    }
  });

  console.info('\n📝 Generating personalized drafts for each prospect...\n');

  const existingEmails = new Set(
    store.getAll().map((d) => d.prospectEmail.toLowerCase()),
  );

  let totalDrafts = 0;
  let skipped = 0;
  for (const prospect of prospects) {
    if (existingEmails.has(prospect.email.toLowerCase())) {
      skipped++;
      console.info(`  ⏭ ${prospect.email} — already in drafts, skipping`);
      continue;
    }
    try {
      const contextSnippet = prospect.sourceComment?.text || prospect.context || prospect.reason || '';
      const drafts = await generateDrafts(
        {
          prospectEmail: prospect.email,
          prospectName: prospect.handle || '',
          prospectRole: '',
          prospectCompany: '',
          sourceContext: contextSnippet.slice(0, 500),
        },
        { variants: ['short'], cta: 'reply', threadUrl },
      );
      totalDrafts += drafts.length;
      console.info(`  ✔ ${prospect.email} — ${drafts.length} draft(s) created`);
    } catch (err) {
      console.warn(`  ⚠ ${prospect.email} — draft failed: ${err.message}`);
    }
  }

  if (skipped) console.info(`\n⏭ Skipped ${skipped} prospect(s) already in drafts.`);
  console.info(`\n📬 ${totalDrafts} new draft(s) ready for review.`);
  console.info('Launching CLI — use /list to see drafts, /view <id> to review, /approve <id> then /send <id>\n');

  startCli();
};

main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exitCode = 1;
});

