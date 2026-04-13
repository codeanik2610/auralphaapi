import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { AutomationsService } from '../api/services/AutomationsService';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const automationRecoveryLoader: MicroframeworkLoader = async () => {
  try {
    const summary = await Container.get(AutomationsService).reconcileStaleRunsOnStartup();
    log.info(
      `Automation startup recovery scanned ${summary.scanned} active run${
        summary.scanned === 1 ? '' : 's'
      } and recovered ${summary.recovered}; synced ${summary.synced}; skipped ${summary.skipped}; failed ${summary.failed}`
    );
  } catch (error) {
    log.error(
      `Automation recovery loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
