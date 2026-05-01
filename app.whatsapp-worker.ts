import 'reflect-metadata';
import { coreDataSource } from './src/database/data-source';
import { initializeCoreDataSource } from './src/database/initializeCoreDataSource';
import { env } from './src/env';
import { Logger } from './src/lib/logger';
import { WhatsappDeliveryWorker } from './src/whatsapp/WhatsappDeliveryWorker';
import { winstonLoader } from './src/loaders/WinstonLoader';

winstonLoader();
const log = new Logger('app.whatsapp-worker');
const worker = new WhatsappDeliveryWorker();

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
  log.info(style('Aloha, your WhatsApp worker is ready.', ansi.green, true));
  log.info(style('To shut it down, press <CTRL> + C at any time.', ansi.yellow));
  log.info('');
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info(`${style('Environment   :', ansi.cyan, true)} ${env.node}`);
  log.info(`${style('App Name      :', ansi.cyan, true)} trading-whatsapp-worker`);
  log.info(
    `${style('MySQL DB      :', ansi.cyan, true)} mysql://${env.db.host}:${env.db.port}/${env.db.database}`
  );
  log.info(`${style('WhatsApp Enabled:', ansi.cyan, true)} ${env.whatsapp.enabled}`);
  log.info(`${style('Provider      :', ansi.cyan, true)} ${env.whatsapp.provider}`);
  log.info(
    `${style('Sender        :', ansi.cyan, true)} ${env.whatsapp.twilio.from || 'not configured'}`
  );
  log.info(`${style('Poll Interval :', ansi.cyan, true)} ${env.whatsapp.pollIntervalMs}ms`);
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info('');
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(`${label} exceeded ${env.app.shutdownDrainTimeoutMs}ms during shutdown`)
          );
        }, env.app.shutdownDrainTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

let shutdownPromise: Promise<void> | null = null;

const stop = async (signal: string): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    try {
      log.info(`Received ${signal}, draining WhatsApp worker...`);
      await withTimeout(worker.stop(), 'WhatsApp worker drain');
      if (coreDataSource.isInitialized) {
        await withTimeout(coreDataSource.destroy(), 'MySQL shutdown');
      }
      process.exit(0);
    } catch (error) {
      log.error(
        `WhatsApp worker shutdown failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
      process.exit(1);
    }
  })();

  return shutdownPromise;
};

process.on('SIGINT', () => {
  void stop('SIGINT');
});

process.on('SIGTERM', () => {
  void stop('SIGTERM');
});

const start = async (): Promise<void> => {
  banner();
  if (!env.whatsapp.enabled) {
    log.warn(
      'WhatsApp delivery is disabled. Configure WHATSAPP_DELIVERY_ENABLED=true and Twilio settings to send queued WhatsApp messages.'
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
    `WhatsApp worker failed to start: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exit(1);
});
