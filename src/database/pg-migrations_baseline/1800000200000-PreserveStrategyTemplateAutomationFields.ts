import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class PreserveStrategyTemplateAutomationFields1800000200000 implements MigrationInterface {
  name = 'PreserveStrategyTemplateAutomationFields1800000200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.normalize_strategy_template_config(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  cfg jsonb := COALESCE(input, '{}'::jsonb);
  risk jsonb := COALESCE(cfg->'risk', '{}'::jsonb);
  parameters jsonb := COALESCE(cfg->'parameters', '{}'::jsonb);
  filters jsonb := COALESCE(cfg->'filters', '{}'::jsonb);
BEGIN
  RETURN jsonb_build_object(
    'codeTarget', 'python',
    'codeDefinition', COALESCE(cfg->>'codeDefinition', ''),
    'authoredCodeTarget', COALESCE(cfg->>'authoredCodeTarget', cfg->>'codeTarget', 'python'),
    'authoredCodeDefinition', COALESCE(cfg->>'authoredCodeDefinition', cfg->>'codeDefinition', ''),
    'compiledCodeTarget', COALESCE(cfg->>'compiledCodeTarget', 'python'),
    'compiledCodeDefinition', COALESCE(cfg->>'compiledCodeDefinition', cfg->>'codeDefinition', ''),
    'market', COALESCE(cfg->>'market', ''),
    'entryLogic', COALESCE(cfg->>'entryLogic', ''),
    'exitLogic', COALESCE(cfg->>'exitLogic', ''),
    'entryShortLogic', COALESCE(cfg->>'entryShortLogic', cfg->>'entry_short_logic', ''),
    'exitShortLogic', COALESCE(cfg->>'exitShortLogic', cfg->>'exit_short_logic', ''),
    'shortEnabled', CASE
      WHEN jsonb_typeof(cfg->'shortEnabled') = 'boolean' THEN cfg->'shortEnabled'
      ELSE to_jsonb(
        COALESCE(cfg->>'entryShortLogic', cfg->>'entry_short_logic', '') <> ''
        OR COALESCE(cfg->>'exitShortLogic', cfg->>'exit_short_logic', '') <> ''
      )
    END,
    'risk', risk || jsonb_build_object(
      'maxRisk', COALESCE(risk->>'maxRisk', risk->>'max_per_trade', ''),
      'sizingNotes', COALESCE(risk->>'sizingNotes', '')
    ),
    'parameters', parameters || jsonb_build_object(
      'signalThreshold', COALESCE(parameters->>'signalThreshold', parameters->>'signal_threshold', '')
    ),
    'notes', COALESCE(cfg->>'notes', ''),
    'filters', jsonb_build_object(
      'useAiFilter', CASE
        WHEN filters ? 'useAiFilter' AND (filters->>'useAiFilter') IN ('true','false') THEN (filters->>'useAiFilter')::boolean
        ELSE false
      END,
      'useRegimeFilter', CASE
        WHEN filters ? 'useRegimeFilter' AND (filters->>'useRegimeFilter') IN ('true','false') THEN (filters->>'useRegimeFilter')::boolean
        ELSE false
      END,
      'paperTradeFirst', CASE
        WHEN filters ? 'paperTradeFirst' AND (filters->>'paperTradeFirst') IN ('true','false') THEN (filters->>'paperTradeFirst')::boolean
        ELSE false
      END
    ),
    'description', COALESCE(cfg->>'description', '')
  ) || CASE
    WHEN jsonb_typeof(cfg->'tradeManagement') = 'object'
      THEN jsonb_build_object('tradeManagement', cfg->'tradeManagement')
    ELSE '{}'::jsonb
  END || CASE
    WHEN jsonb_typeof(cfg->'automation') = 'object'
      THEN jsonb_build_object('automation', cfg->'automation')
    ELSE '{}'::jsonb
  END || CASE
    WHEN jsonb_typeof(cfg->'automationProfile') = 'object'
      THEN jsonb_build_object('automationProfile', cfg->'automationProfile')
    ELSE '{}'::jsonb
  END;
END;
$function$;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.normalize_strategy_template_config(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  cfg jsonb := COALESCE(input, '{}'::jsonb);
  risk jsonb := COALESCE(cfg->'risk', '{}'::jsonb);
  parameters jsonb := COALESCE(cfg->'parameters', '{}'::jsonb);
  filters jsonb := COALESCE(cfg->'filters', '{}'::jsonb);
BEGIN
  RETURN jsonb_build_object(
    'codeTarget', 'python',
    'codeDefinition', COALESCE(cfg->>'codeDefinition', ''),
    'market', COALESCE(cfg->>'market', ''),
    'entryLogic', COALESCE(cfg->>'entryLogic', ''),
    'exitLogic', COALESCE(cfg->>'exitLogic', ''),
    'entryShortLogic', COALESCE(cfg->>'entryShortLogic', cfg->>'entry_short_logic', ''),
    'exitShortLogic', COALESCE(cfg->>'exitShortLogic', cfg->>'exit_short_logic', ''),
    'risk', jsonb_build_object(
      'maxRisk', COALESCE(risk->>'maxRisk', risk->>'max_per_trade', ''),
      'sizingNotes', COALESCE(risk->>'sizingNotes', '')
    ),
    'parameters', jsonb_build_object(
      'signalThreshold', COALESCE(parameters->>'signalThreshold', parameters->>'signal_threshold', '')
    ),
    'notes', COALESCE(cfg->>'notes', ''),
    'filters', jsonb_build_object(
      'useAiFilter', CASE
        WHEN filters ? 'useAiFilter' AND (filters->>'useAiFilter') IN ('true','false') THEN (filters->>'useAiFilter')::boolean
        ELSE false
      END,
      'useRegimeFilter', CASE
        WHEN filters ? 'useRegimeFilter' AND (filters->>'useRegimeFilter') IN ('true','false') THEN (filters->>'useRegimeFilter')::boolean
        ELSE false
      END,
      'paperTradeFirst', CASE
        WHEN filters ? 'paperTradeFirst' AND (filters->>'paperTradeFirst') IN ('true','false') THEN (filters->>'paperTradeFirst')::boolean
        ELSE false
      END
    ),
    'description', COALESCE(cfg->>'description', '')
  ) || CASE
    WHEN jsonb_typeof(cfg->'tradeManagement') = 'object'
      THEN jsonb_build_object('tradeManagement', cfg->'tradeManagement')
    ELSE '{}'::jsonb
  END;
END;
$function$;
`);
  }
}
