import { EmailDelivery } from '../database/entities/EmailDelivery';

export interface EmailTransport {
  validateConfiguration(): void;
  verify(): Promise<void>;
  send(delivery: EmailDelivery): Promise<void>;
}
