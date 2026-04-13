import 'reflect-metadata';
import type { Server } from 'node:http';
import { bootstrapMicroframework } from 'microframework-w3tec';
import { Container } from 'typedi';
import { validateMudrexStartupConfiguration } from './src/brokers';
import { coreDataSource } from './src/database/data-source';
import { strategyDataSource } from './src/database/pg-data-source';
import { ActivityExportProcessorService } from './src/api/services/ActivityExportProcessorService';
import { ActivityMaintenanceService } from './src/api/services/ActivityMaintenanceService';
import { PaperOrdersSchedulerService } from './src/api/services/PaperOrdersSchedulerService';
import { SuggestedTradeExecutionSyncService } from './src/api/services/SuggestedTradeExecutionSyncService';
import { env } from './src/env';
import { banner } from './src/lib/banner';
import { activityExportProcessorLoader } from './src/loaders/ActivityExportProcessorLoader';
import { automationRecoveryLoader } from './src/loaders/AutomationRecoveryLoader';
import { Logger } from './src/lib/logger';
import { activityMaintenanceLoader } from './src/loaders/ActivityMaintenanceLoader';
import { expressLoader } from './src/loaders/ExpressLoader';
import { iocLoader } from './src/loaders/IocLoader';
import { paperOrdersExecutionLoader } from './src/loaders/PaperOrdersExecutionLoader';
import { redisBootstrapLoader } from './src/loaders/RedisBootstrapLoader';
import { suggestedTradeExecutionSyncLoader } from './src/loaders/SuggestedTradeExecutionSyncLoader';
import { typeormLoader } from './src/loaders/TypeormLoader';
import { winstonLoader } from './src/loaders/WinstonLoader';

const log = new Logger(__filename);

const mudrexConfigurationWarning = validateMudrexStartupConfiguration();
if (mudrexConfigurationWarning) {
  log.warn(mudrexConfigurationWarning);
}

const closeHttpServer = async (server?: Server | null): Promise<void> => {
  if (!server || typeof server.close !== 'function' || !server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `${label} exceeded ${env.app.shutdownDrainTimeoutMs}ms during shutdown`
            )
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

const stopBackgroundServices = async (): Promise<void> => {
  await Container.get(ActivityExportProcessorService).stop();
  await Container.get(ActivityMaintenanceService).stop();
  await Container.get(SuggestedTradeExecutionSyncService).stop();
  await Container.get(PaperOrdersSchedulerService).stop();
};

let shutdownPromise: Promise<void> | null = null;

bootstrapMicroframework({
  loaders: [
    winstonLoader,
    iocLoader,
    redisBootstrapLoader,
    typeormLoader,
    automationRecoveryLoader,
    activityExportProcessorLoader,
    activityMaintenanceLoader,
    suggestedTradeExecutionSyncLoader,
    paperOrdersExecutionLoader,
    expressLoader,
  ],
})
  .then((framework) => {
    const shutdown = async (signal: string): Promise<void> => {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = (async () => {
        try {
          log.info(`Received ${signal}, draining API runtime...`);
          const server = framework.settings.getData('express_server') as Server | undefined;
          await withTimeout(closeHttpServer(server), 'HTTP server shutdown');
          await withTimeout(stopBackgroundServices(), 'background service drain');

          if (strategyDataSource.isInitialized) {
            await withTimeout(strategyDataSource.destroy(), 'Postgres shutdown');
          }
          if (coreDataSource.isInitialized) {
            await withTimeout(coreDataSource.destroy(), 'MySQL shutdown');
          }

          log.info('API runtime shutdown completed successfully');
          process.exit(0);
        } catch (error) {
          log.error(
            `API runtime shutdown failed: ${
              error instanceof Error ? error.stack || error.message : String(error)
            }`
          );
          process.exit(1);
        }
      })();

      return shutdownPromise;
    };

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    banner(log);
  })
  .catch((error) => {
    log.error(
      `Application failed to start: ${error instanceof Error ? error.stack || error.message : String(error)}`
    );
    process.exit(1);
  });
