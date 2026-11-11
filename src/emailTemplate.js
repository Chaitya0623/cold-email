const formatContext = (context = '') =>
  context.length > 280 ? `${context.slice(0, 277)}...` : context;

export const buildEmailContent = (prospect, thread) => {
  const subject = `Saw your HN note on "${thread.title}"`;
  const contextLine = formatContext(
    prospect.sourceComment?.text || prospect.context || prospect.reason || '',
  );
  const linkLine = prospect.sourceComment?.permalink
    ? `HN comment: ${prospect.sourceComment.permalink}`
    : '';

  const body = [
    `Hi ${prospect.handle === 'unknown' ? 'there' : prospect.handle},`,
    '',
    `I noticed your comment in the Hacker News thread about "${thread.title}".`,
    contextLine ? `You mentioned: "${contextLine}"` : '',
    linkLine,
    '',
    'I’m working on a solution that aligns with what you described and would love to send over a short overview to see if it resonates.',
    '',
    'Would you be open to a brief intro email or a 10-minute call?',
    '',
    'Thanks,',
    'Your Name',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, body };
};

