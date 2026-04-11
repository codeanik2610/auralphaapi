import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { Logger } from '../lib/logger';
import { PaperOrdersSchedulerService } from '../api/services/PaperOrdersSchedulerService';

const log = new Logger(__filename);

export const paperOrdersExecutionLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(PaperOrdersSchedulerService).start();
  } catch (error) {
    log.error(
      `Paper order execution loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
