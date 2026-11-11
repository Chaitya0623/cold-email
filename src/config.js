import dotenv from 'dotenv';

dotenv.config();

const coerceBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const coerceNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openAiTemperature: coerceNumber(process.env.OPENAI_TEMPERATURE, 0),

  senderName: process.env.SENDER_NAME || 'Ling Qing Meng',
  linkedinUrl: process.env.LINKEDIN_URL || 'https://www.linkedin.com/in/ling-qing-meng-6a2803214/',
  githubUrl: process.env.GITHUB_URL || 'https://github.com/lingqingmeng',
  githubRepoUrl: process.env.GITHUB_REPO_URL || 'https://github.com/ondecentral/Lucia-Browser-SDK',
  portfolioUrl: process.env.PORTFOLIO_URL || 'https://jasonmeng.com',
  devResumeUrl: process.env.DEV_RESUME_URL || 'https://1drv.ms/b/c/b3281f039c55e2b5/IQCLu-7v3QxEQ6DMZA-jGIjXAYjQWWxTX1149tuqmeXb5uc?e=CHmFsx',
  salesResumeUrl: process.env.SALES_RESUME_URL || 'https://1drv.ms/b/c/b3281f039c55e2b5/IQBnwnVdrBxuQK0Ml-M5CTsNAT4NXtEkKs9ByxhYfHyLka0?e=frgzBd',


  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sesConfigurationSet: process.env.SES_CONFIGURATION_SET || undefined,

  sourceEmail: process.env.SOURCE_EMAIL || '',
  replyToEmail: process.env.DEFAULT_REPLY_TO || process.env.SOURCE_EMAIL || '',

  dryRun: coerceBoolean(process.env.DRY_RUN, true),
  sendIntervalMs: coerceNumber(process.env.SEND_INTERVAL_SECONDS, 30) * 1000,
  sendInitialDelayMs:
    coerceNumber(process.env.SCHEDULE_INITIAL_DELAY_SECONDS, 5) * 1000,

  maxComments: coerceNumber(process.env.MAX_COMMENTS, 120),
  maxProspects: coerceNumber(process.env.MAX_PROSPECTS, 25),
  minConfidence: coerceNumber(process.env.MIN_CONFIDENCE, 0.5),
  maxPages: coerceNumber(process.env.MAX_PAGES, 3),

  companyContextPath: process.env.COMPANY_CONTEXT_PATH || 'src/company_context.txt',
};

export const requireConfig = (key) => {
  const value = config[key];
  if (!value) {
    throw new Error(
      `Configuration value "${key}" is required but not provided. Check your environment variables.`,
    );
  }
  return value;
};

