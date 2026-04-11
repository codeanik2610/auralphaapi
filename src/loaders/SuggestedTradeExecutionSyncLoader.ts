import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { Logger } from '../lib/logger';
import { SuggestedTradeExecutionSyncService } from '../api/services/SuggestedTradeExecutionSyncService';

const log = new Logger(__filename);

export const suggestedTradeExecutionSyncLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(SuggestedTradeExecutionSyncService).start();
  } catch (error) {
    log.error(
      `Suggested trade execution sync loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
