import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

// Staged baseline migration for the dev-history squash.
// This lives outside the active migrations path until the cutover happens.
@Service()
export class BaselineStrategySchema1800000000000 implements MigrationInterface {
  name = 'BaselineStrategySchema1800000000000';

  private readonly createStatements = [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'aiapproach'
  ) THEN
    CREATE TYPE public.aiapproach AS ENUM ('algorithmic', 'llm_driven', 'hybrid');
  END IF;
END
$$;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'risktolerance'
  ) THEN
    CREATE TYPE public.risktolerance AS ENUM ('conservative', 'moderate', 'aggressive');
  END IF;
END
$$;`,
    `CREATE OR REPLACE FUNCTION public.normalize_strategy_template_config(input jsonb)
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
  );
END;
$function$;`,
    `CREATE OR REPLACE FUNCTION public.enforce_strategy_template_config()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.config := public.normalize_strategy_template_config(NEW.config);
  RETURN NEW;
END;
$function$;`,
    `CREATE TABLE public.backtest_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backtest_id uuid NOT NULL,
    user_id character varying(191) NOT NULL,
    cagr double precision,
    sharpe double precision,
    drawdown double precision,
    win_rate double precision,
    profit_factor double precision,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    progress_state character varying(32),
    progress_processed integer,
    progress_total integer,
    progress_percent double precision,
    resume_checkpoint_state character varying(32),
    trade_event_count integer,
    performance_surface_result_count integer
);`,
    `CREATE TABLE public.backtest_trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backtest_id uuid NOT NULL,
    user_id character varying(191) NOT NULL,
    symbol character varying(64) NOT NULL,
    "interval" character varying(8) NOT NULL,
    side character varying(10) NOT NULL,
    entry_time timestamp with time zone NOT NULL,
    entry_price numeric(30,12) NOT NULL,
    exit_time timestamp with time zone,
    exit_price numeric(30,12),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`,
    `CREATE TABLE public.backtests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(191) NOT NULL,
    name character varying(255) NOT NULL,
    strategy character varying(255) NOT NULL,
    symbol character varying(50) NOT NULL,
    parameter character varying(255) NOT NULL,
    status character varying(30) NOT NULL,
    stability character varying(100),
    trades integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`,
    `CREATE TABLE public.market_candles_1m (
    id bigint NOT NULL,
    source character varying(32) NOT NULL,
    symbol character varying(64) NOT NULL,
    "interval" character varying(8) NOT NULL,
    open_time timestamp with time zone NOT NULL,
    close_time timestamp with time zone,
    open numeric(30,12) NOT NULL,
    high numeric(30,12) NOT NULL,
    low numeric(30,12) NOT NULL,
    close numeric(30,12) NOT NULL,
    volume numeric(30,12) DEFAULT 0 NOT NULL,
    quote_volume numeric(30,12) DEFAULT 0 NOT NULL,
    trades integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`,
    `CREATE SEQUENCE public.market_candles_1m_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`,
    `ALTER SEQUENCE public.market_candles_1m_id_seq OWNED BY public.market_candles_1m.id;`,
    `CREATE TABLE public.strategy_lab_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(36) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(30) DEFAULT 'Draft'::character varying NOT NULL,
    config jsonb,
    objective character varying(100),
    market character varying(100),
    timeframe character varying(50),
    universe character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    authoring_mode character varying(20) DEFAULT 'no_code'::character varying NOT NULL,
    code_target character varying(30),
    visual_definition jsonb,
    code_definition text,
    parameters jsonb,
    risk_config jsonb,
    validation_state character varying(20) DEFAULT 'idle'::character varying,
    validation_errors jsonb,
    last_validated_at timestamp with time zone,
    description text,
    project_version integer DEFAULT 1 NOT NULL,
    source_template_id character varying(100),
    source_template_version integer,
    validation_warnings jsonb
);`,
    `CREATE TABLE public.strategy_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(191) NOT NULL,
    template_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(40) DEFAULT 'Draft'::character varying NOT NULL,
    assets jsonb,
    timeframes jsonb,
    overrides jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_strategy_library_assets_array CHECK (((assets IS NULL) OR (jsonb_typeof(assets) = 'array'::text))),
    CONSTRAINT chk_strategy_library_name_not_blank CHECK ((btrim((COALESCE(name, ''::character varying))::text) <> ''::text)),
    CONSTRAINT chk_strategy_library_overrides_object CHECK (((overrides IS NULL) OR (jsonb_typeof(overrides) = 'object'::text))),
    CONSTRAINT chk_strategy_library_status_valid CHECK (((status)::text = ANY ((ARRAY['Draft'::character varying, 'Active'::character varying, 'Paused'::character varying, 'Archived'::character varying])::text[]))),
    CONSTRAINT chk_strategy_library_timeframes_array CHECK (((timeframes IS NULL) OR (jsonb_typeof(timeframes) = 'array'::text)))
);`,
    `CREATE TABLE public.strategy_template_suggestions (
    id uuid NOT NULL,
    user_id character varying(191) NOT NULL,
    template_id character varying(191) NOT NULL,
    template_name character varying(255) NOT NULL,
    suggested_name character varying(255),
    status character varying(40) NOT NULL,
    suggested_config jsonb,
    diff_summary text,
    reasoning text,
    baseline_metrics jsonb,
    candidate_metrics jsonb,
    coverage jsonb,
    score_delta double precision,
    config_hash character varying(64) NOT NULL,
    imported_template_id character varying(191),
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);`,
    `CREATE TABLE public.strategy_template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    strategy_template_id uuid NOT NULL,
    user_id character varying(191) NOT NULL,
    actor_user_id character varying(191) NOT NULL,
    template_version integer NOT NULL,
    change_type character varying(40) DEFAULT 'updated'::character varying NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    status character varying(40) NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);`,
    `CREATE TABLE public.strategy_templates (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT strategies_id_not_null NOT NULL,
    user_id character varying(191) CONSTRAINT strategies_user_id_not_null NOT NULL,
    name character varying(255) CONSTRAINT strategies_name_not_null NOT NULL,
    description text,
    status character varying(40) DEFAULT 'Draft'::character varying CONSTRAINT strategies_status_not_null NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT strategies_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT strategies_updated_at_not_null NOT NULL,
    template_version integer DEFAULT 1 NOT NULL
);`,
    `CREATE TABLE public.user_preferences (
    id uuid NOT NULL,
    user_id character varying(255) NOT NULL,
    preferred_segments jsonb,
    preferred_assets jsonb,
    preferred_timeframes jsonb,
    preferred_strategy_types jsonb,
    preferred_ai_approach public.aiapproach,
    risk_tolerance public.risktolerance,
    auto_backtest_approved boolean,
    notification_settings jsonb
);`,
    `ALTER TABLE ONLY public.market_candles_1m ALTER COLUMN id SET DEFAULT nextval('public.market_candles_1m_id_seq'::regclass);`,
    `ALTER TABLE ONLY public.backtest_results
    ADD CONSTRAINT backtest_results_backtest_id_key UNIQUE (backtest_id);`,
    `ALTER TABLE ONLY public.backtest_results
    ADD CONSTRAINT backtest_results_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.backtest_trades
    ADD CONSTRAINT backtest_trades_backtest_id_symbol_interval_side_entry_time_key UNIQUE (backtest_id, symbol, "interval", side, entry_time, exit_time);`,
    `ALTER TABLE ONLY public.backtest_trades
    ADD CONSTRAINT backtest_trades_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.backtests
    ADD CONSTRAINT backtests_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.market_candles_1m
    ADD CONSTRAINT market_candles_1m_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.market_candles_1m
    ADD CONSTRAINT market_candles_1m_source_symbol_interval_open_time_key UNIQUE (source, symbol, "interval", open_time);`,
    `ALTER TABLE ONLY public.strategy_templates
    ADD CONSTRAINT strategies_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.strategy_lab_projects
    ADD CONSTRAINT strategy_lab_projects_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.strategy_library
    ADD CONSTRAINT strategy_library_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.strategy_template_suggestions
    ADD CONSTRAINT strategy_template_suggestions_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.strategy_template_versions
    ADD CONSTRAINT strategy_template_versions_pkey PRIMARY KEY (id);`,
    `ALTER TABLE ONLY public.strategy_templates
    ADD CONSTRAINT uidx_strategy_templates_user_id_id UNIQUE (user_id, id);`,
    `ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);`,
    `CREATE INDEX idx_backtest_results_user_backtest_id ON public.backtest_results USING btree (user_id, backtest_id);`,
    `CREATE INDEX idx_backtest_results_user_cagr_desc ON public.backtest_results USING btree (user_id, cagr DESC) WHERE (cagr IS NOT NULL);`,
    `CREATE INDEX idx_backtest_results_user_drawdown_desc ON public.backtest_results USING btree (user_id, drawdown DESC) WHERE (drawdown IS NOT NULL);`,
    `CREATE INDEX idx_backtest_results_user_resume_checkpoint_state ON public.backtest_results USING btree (user_id, resume_checkpoint_state);`,
    `CREATE INDEX idx_backtest_results_user_sharpe_desc ON public.backtest_results USING btree (user_id, sharpe DESC) WHERE (sharpe IS NOT NULL);`,
    `CREATE INDEX idx_backtest_results_user_surface_result_count ON public.backtest_results USING btree (user_id, performance_surface_result_count DESC);`,
    `CREATE INDEX idx_backtest_results_user_updated_at ON public.backtest_results USING btree (user_id, updated_at DESC);`,
    `CREATE INDEX idx_backtest_trades_backtest_symbol_interval ON public.backtest_trades USING btree (backtest_id, symbol, "interval");`,
    `CREATE INDEX idx_backtest_trades_user_backtest_entry_time ON public.backtest_trades USING btree (user_id, backtest_id, entry_time DESC);`,
    `CREATE INDEX idx_backtest_trades_user_entry_time ON public.backtest_trades USING btree (user_id, entry_time DESC);`,
    `CREATE INDEX idx_backtests_search_document_trgm ON public.backtests USING gin (lower((((((((((((COALESCE(name, ''::character varying))::text || ' '::text) || (COALESCE(strategy, ''::character varying))::text) || ' '::text) || (COALESCE(symbol, ''::character varying))::text) || ' '::text) || (COALESCE(parameter, ''::character varying))::text) || ' '::text) || (COALESCE(status, ''::character varying))::text) || ' '::text) || (COALESCE(stability, ''::character varying))::text)) public.gin_trgm_ops);`,
    `CREATE INDEX idx_backtests_status_created_at ON public.backtests USING btree (status, created_at);`,
    `CREATE INDEX idx_backtests_symbol_created_at ON public.backtests USING btree (symbol, created_at);`,
    `CREATE INDEX idx_backtests_user_created_at ON public.backtests USING btree (user_id, created_at DESC);`,
    `CREATE INDEX idx_backtests_user_status_created_at ON public.backtests USING btree (user_id, status, created_at DESC);`,
    `CREATE INDEX idx_backtests_user_status_lower_created_at ON public.backtests USING btree (user_id, lower((status)::text), created_at DESC);`,
    `CREATE INDEX idx_market_candles_1m_symbol_open_time ON public.market_candles_1m USING btree (symbol, open_time DESC);`,
    `CREATE INDEX idx_strategy_lab_projects_user_updated_at ON public.strategy_lab_projects USING btree (user_id, updated_at);`,
    `CREATE INDEX idx_strategy_library_name_trgm ON public.strategy_library USING gin (lower((COALESCE(name, ''::character varying))::text) public.gin_trgm_ops);`,
    `CREATE INDEX idx_strategy_library_user_status ON public.strategy_library USING btree (user_id, status);`,
    `CREATE INDEX idx_strategy_library_user_template ON public.strategy_library USING btree (user_id, template_id);`,
    `CREATE INDEX idx_strategy_library_user_updated_at ON public.strategy_library USING btree (user_id, updated_at);`,
    `CREATE INDEX idx_strategy_template_versions_template_created ON public.strategy_template_versions USING btree (strategy_template_id, created_at);`,
    `CREATE INDEX idx_strategy_template_versions_template_version ON public.strategy_template_versions USING btree (strategy_template_id, template_version);`,
    `CREATE INDEX idx_strategy_template_versions_user_created ON public.strategy_template_versions USING btree (user_id, created_at);`,
    `CREATE INDEX idx_strategy_templates_search_document_trgm ON public.strategy_templates USING gin (lower((((COALESCE(name, ''::character varying))::text || ' '::text) || COALESCE(description, ''::text))) public.gin_trgm_ops);`,
    `CREATE INDEX idx_strategy_templates_user_status ON public.strategy_templates USING btree (user_id, status);`,
    `CREATE INDEX idx_strategy_templates_user_updated_at ON public.strategy_templates USING btree (user_id, updated_at);`,
    `CREATE INDEX ix_strategy_template_suggestions_config_hash ON public.strategy_template_suggestions USING btree (config_hash);`,
    `CREATE INDEX ix_strategy_template_suggestions_template_id ON public.strategy_template_suggestions USING btree (template_id);`,
    `CREATE INDEX ix_strategy_template_suggestions_user_id ON public.strategy_template_suggestions USING btree (user_id);`,
    `CREATE UNIQUE INDEX ix_user_preferences_user_id ON public.user_preferences USING btree (user_id);`,
    `CREATE UNIQUE INDEX uidx_strategy_library_user_template_name_ci ON public.strategy_library USING btree (user_id, template_id, lower(btrim((name)::text)));`,
    `CREATE TRIGGER tr_normalize_strategy_templates BEFORE INSERT OR UPDATE ON public.strategy_templates FOR EACH ROW EXECUTE FUNCTION public.enforce_strategy_template_config();`,
    `ALTER TABLE ONLY public.backtest_results
    ADD CONSTRAINT fk_backtest_results_backtest_id FOREIGN KEY (backtest_id) REFERENCES public.backtests(id) ON DELETE CASCADE;`,
    `ALTER TABLE ONLY public.backtest_trades
    ADD CONSTRAINT fk_backtest_trades_backtest_id FOREIGN KEY (backtest_id) REFERENCES public.backtests(id) ON DELETE CASCADE NOT VALID;`,
    `ALTER TABLE ONLY public.strategy_library
    ADD CONSTRAINT fk_strategy_library_user_template_owner FOREIGN KEY (user_id, template_id) REFERENCES public.strategy_templates(user_id, id) ON DELETE CASCADE;`,
    `ALTER TABLE ONLY public.strategy_template_versions
    ADD CONSTRAINT fk_strategy_template_versions_template_id FOREIGN KEY (strategy_template_id) REFERENCES public.strategy_templates(id) ON DELETE CASCADE;`
  ];

  private readonly dropStatements = [
    `DROP TABLE IF EXISTS public.user_preferences CASCADE;`,
    `DROP TABLE IF EXISTS public.strategy_template_suggestions CASCADE;`,
    `DROP TABLE IF EXISTS public.market_candles_1m CASCADE;`,
    `DROP TABLE IF EXISTS public.backtest_trades CASCADE;`,
    `DROP TABLE IF EXISTS public.backtest_results CASCADE;`,
    `DROP TABLE IF EXISTS public.backtests CASCADE;`,
    `DROP TABLE IF EXISTS public.strategy_lab_projects CASCADE;`,
    `DROP TABLE IF EXISTS public.strategy_library CASCADE;`,
    `DROP TABLE IF EXISTS public.strategy_template_versions CASCADE;`,
    `DROP TABLE IF EXISTS public.strategy_templates CASCADE;`,
    `DROP FUNCTION IF EXISTS public.enforce_strategy_template_config();`,
    `DROP FUNCTION IF EXISTS public.normalize_strategy_template_config(jsonb);`,
    `DROP TYPE IF EXISTS public.aiapproach;`,
    `DROP TYPE IF EXISTS public.risktolerance;`
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.createStatements) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.dropStatements) {
      await queryRunner.query(statement);
    }
  }
}
