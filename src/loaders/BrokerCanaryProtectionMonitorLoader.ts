import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { BrokerCanaryProtectionMonitorService } from '../api/services/BrokerCanaryProtectionMonitorService';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const brokerCanaryProtectionMonitorLoader: MicroframeworkLoader = async () => {
  try {
    await Container.get(BrokerCanaryProtectionMonitorService).start();
  } catch (error) {
    log.error(
      `Broker canary protection monitor loader failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    );
    throw error;
  }
};
