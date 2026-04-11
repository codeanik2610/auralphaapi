import { JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { BrokerAccountHealthCheckResponse } from '../contracts/BrokerAccount';
import { BrokerAccountsService } from '../services/BrokerAccountsService';

@JsonController('/internal/broker-accounts')
@Service()
export class InternalBrokerAccountsController {
  @Inject(() => BrokerAccountsService)
  private brokerAccountsService!: BrokerAccountsService;

  @Post('/health-check')
  async runHealthCheck(): Promise<ApiSuccessResponse<BrokerAccountHealthCheckResponse>> {
    return this.brokerAccountsService.runSystemBrokerConnectionHealthCheck();
  }
}

