import { config } from './config.js';

const now = () => Date.now();

export const buildSchedule = (prospects) => {
  const start = now() + config.sendInitialDelayMs;
  return prospects.map((prospect, index) => ({
    prospect,
    sendAt: new Date(start + index * config.sendIntervalMs),
  }));
};

export const runSchedule = async (schedule, sendFn) => {
  for (const job of schedule) {
    const delay = job.sendAt.getTime() - now();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await sendFn(job);
  }
};

