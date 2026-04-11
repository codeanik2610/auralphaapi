import 'reflect-metadata';
import { coreDataSource } from './src/database/data-source';
import { initializeCoreDataSource } from './src/database/initializeCoreDataSource';
import { env } from './src/env';
import { Logger } from './src/lib/logger';
import { EmailDeliveryWorker } from './src/email/EmailDeliveryWorker';
import { winstonLoader } from './src/loaders/WinstonLoader';

winstonLoader();
const log = new Logger('app.email-worker');
const worker = new EmailDeliveryWorker();

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
};

const style = (value: string, color: string, bold = false): string =>
  `${bold ? ansi.bold : ''}${color}${value}${ansi.reset}`;

const banner = (): void => {
  log.info('');
  log.info(style('Aloha, your email worker is ready.', ansi.green, true));
  log.info(style('To shut it down, press <CTRL> + C at any time.', ansi.yellow));
  log.info('');
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info(`${style('Environment  :', ansi.cyan, true)} ${env.node}`);
  log.info(`${style('App Name     :', ansi.cyan, true)} trading-email-worker`);
  log.info(
    `${style('MySQL DB     :', ansi.cyan, true)} mysql://${env.db.host}:${env.db.port}/${env.db.database}`
  );
  log.info(`${style('Email Enabled:', ansi.cyan, true)} ${env.email.enabled}`);
  log.info(
    `${style('SMTP Host    :', ansi.cyan, true)} ${env.email.smtp.host || 'not configured'}`
  );
  log.info(
    `${style('Poll Interval:', ansi.cyan, true)} ${env.email.pollIntervalMs}ms`
  );
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info('');
};

const stop = async (signal: string): Promise<void> => {
  log.info(`Received ${signal}, stopping email worker...`);
  await worker.stop();
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  process.exit(0);
};

process.on('SIGINT', () => {
  void stop('SIGINT');
});

process.on('SIGTERM', () => {
  void stop('SIGTERM');
});

const start = async (): Promise<void> => {
  banner();
  if (!env.email.enabled) {
    log.warn(
      'Email delivery is disabled. Configure EMAIL_DELIVERY_ENABLED=true and SMTP settings to send queued emails.'
    );
    return;
  }
  if (!coreDataSource.isInitialized) {
    await initializeCoreDataSource();
  }
  await worker.start();
};

void start().catch((error) => {
  log.error(
    `Email worker failed to start: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exit(1);
});
