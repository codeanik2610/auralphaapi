import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { ActivityExportProcessorService } from '../api/services/ActivityExportProcessorService';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const activityExportProcessorLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(ActivityExportProcessorService).start();
  } catch (error) {
    log.error(
      `Activity export processor loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
