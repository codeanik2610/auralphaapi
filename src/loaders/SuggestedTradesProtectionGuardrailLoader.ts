import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { SuggestedTradesProtectionGuardrailService } from '../api/services/SuggestedTradesProtectionGuardrailService';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const suggestedTradesProtectionGuardrailLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(SuggestedTradesProtectionGuardrailService).start();
  } catch (error) {
    log.error(
      `Suggested trades protection guardrail loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
