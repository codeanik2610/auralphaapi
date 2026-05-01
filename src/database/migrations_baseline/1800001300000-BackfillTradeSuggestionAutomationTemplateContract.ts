import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';
import { Automation } from '../entities/Automation';
import { deriveAutomationPersistenceFields } from '../utils/automationPersistence';

@Service()
export class BackfillTradeSuggestionAutomationTemplateContract1800001300000
  implements MigrationInterface
{
  name = 'BackfillTradeSuggestionAutomationTemplateContract1800001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('automations'))) {
      return;
    }

    const repository = queryRunner.manager.getRepository(Automation);
    const automations = await repository.find();

    for (const automation of automations) {
      const persistence = deriveAutomationPersistenceFields(automation);
      if (persistence.automationType !== 'trade-suggestion') {
        continue;
      }

      const nextConfig = persistence.normalizedConfig ?? null;
      const changed =
        automation.automationType !== persistence.automationType ||
        JSON.stringify(automation.config ?? null) !== JSON.stringify(nextConfig) ||
        automation.searchText !== persistence.searchText ||
        automation.sourceBacktestId !== persistence.sourceBacktestId ||
        automation.scopeSymbol !== persistence.scopeSymbol ||
        automation.scopeTimeframe !== persistence.scopeTimeframe ||
        automation.sourceTemplateId !== persistence.sourceTemplateId;

      if (!changed) {
        continue;
      }

      automation.automationType = persistence.automationType;
      automation.config = nextConfig;
      automation.searchText = persistence.searchText;
      automation.sourceBacktestId = persistence.sourceBacktestId;
      automation.scopeSymbol = persistence.scopeSymbol;
      automation.scopeTimeframe = persistence.scopeTimeframe;
      automation.sourceTemplateId = persistence.sourceTemplateId;
      await repository.save(automation);
    }
  }

  public async down(): Promise<void> {
    // Data normalization repair only. No rollback.
    return;
  }
}
