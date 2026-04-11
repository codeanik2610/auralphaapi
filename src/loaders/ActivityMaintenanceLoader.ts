import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { ActivityMaintenanceService } from '../api/services/ActivityMaintenanceService';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const activityMaintenanceLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(ActivityMaintenanceService).start();
  } catch (error) {
    log.error(
      `Activity maintenance loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
