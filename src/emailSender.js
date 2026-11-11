import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config, requireConfig } from './config.js';
import { buildEmailContent } from './emailTemplate.js';

const buildClient = () => {
  if (config.dryRun) return null;
  requireConfig('awsAccessKeyId');
  requireConfig('awsSecretAccessKey');
  return new SESv2Client({
    region: config.awsRegion,
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
  });
};

const sesClient = buildClient();

export const deliverDraft = async (draft) => {
  const payload = {
    FromEmailAddress: config.sourceEmail,
    Destination: { ToAddresses: [draft.prospectEmail] },
    Content: {
      Simple: {
        Subject: { Data: draft.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: draft.body, Charset: 'UTF-8' } },
      },
    },
    ReplyToAddresses: config.replyToEmail ? [config.replyToEmail] : undefined,
    ConfigurationSetName: config.sesConfigurationSet,
  };

  if (config.dryRun) {
    console.info('[DRY RUN] Would send draft:', {
      to: draft.prospectEmail,
      subject: draft.subject,
      body: draft.body,
    });
    return { dryRun: true, payload };
  }

  const command = new SendEmailCommand(payload);
  return sesClient.send(command);
};

export const deliverEmail = async ({ prospect, thread }) => {
  const { subject, body } = buildEmailContent(prospect, thread);
  const payload = {
    FromEmailAddress: config.sourceEmail,
    Destination: { ToAddresses: [prospect.email] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: body, Charset: 'UTF-8' } },
      },
    },
    ReplyToAddresses: config.replyToEmail ? [config.replyToEmail] : undefined,
    ConfigurationSetName: config.sesConfigurationSet,
  };

  if (config.dryRun) {
    console.info('[DRY RUN] Would send email:', {
      to: prospect.email,
      subject,
      body,
    });
    return { dryRun: true, payload };
  }

  const command = new SendEmailCommand(payload);
  const response = await sesClient.send(command);
  return response;
};

