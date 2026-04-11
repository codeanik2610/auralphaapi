import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { ApiSuccessResponse } from '../contracts/ApiResponse';
import type {
  ImportStrategyTemplateSuggestionBody,
  StrategyTemplateItem,
} from '../contracts/StrategyTemplate';
import { StrategyTemplatesService } from '../services/StrategyTemplatesService';

@JsonController('/internal/strategy-templates')
@Service()
export class InternalStrategyTemplatesController {
  @Inject(() => StrategyTemplatesService)
  private strategyTemplatesService!: StrategyTemplatesService;

  @Post('/import-suggestion')
  async importSuggestion(
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.importStrategyTemplateSuggestion(
      body as ImportStrategyTemplateSuggestionBody
    );
  }
}
