import 'reflect-metadata';
import { bootstrapMicroframework } from 'microframework-w3tec';
import { validateMudrexStartupConfiguration } from './src/brokers';
import { banner } from './src/lib/banner';
import { activityExportProcessorLoader } from './src/loaders/ActivityExportProcessorLoader';
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

bootstrapMicroframework({
  loaders: [
    winstonLoader,
    iocLoader,
    redisBootstrapLoader,
    typeormLoader,
    activityExportProcessorLoader,
    activityMaintenanceLoader,
    suggestedTradeExecutionSyncLoader,
    paperOrdersExecutionLoader,
    expressLoader,
  ],
})
  .then(() => {
    banner(log);
  })
  .catch((error) => {
    log.error(
      `Application failed to start: ${error instanceof Error ? error.stack || error.message : String(error)}`
    );
    process.exit(1);
  });
