import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class HardenRiskPolicyTargetIntegrity1770600000000 implements MigrationInterface {
  name = 'HardenRiskPolicyTargetIntegrity1770600000000';

  private readonly tableName = 'risk_policies';
  private readonly normalizedTargetColumn = 'normalized_target_key';
  private readonly duplicateTargetIndex = 'uidx_risk_policies_user_target_key';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    await this.normalizeStoredValues(queryRunner);
    await this.assertValidScopes(queryRunner);
    await this.assertBrokerPoliciesHaveBrokerKey(queryRunner);
    await this.assertNoModeConflicts(queryRunner);
    await this.assertThresholdOrdering(queryRunner);
    await this.ensureNormalizedTargetColumn(queryRunner);
    await this.assertNoDuplicateTargets(queryRunner);

    if (!(await this.hasIndex(queryRunner, this.tableName, this.duplicateTargetIndex))) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX ${this.duplicateTargetIndex}
         ON ${this.tableName} (user_id, ${this.normalizedTargetColumn})`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    if (await this.hasIndex(queryRunner, this.tableName, this.duplicateTargetIndex)) {
      await queryRunner.query(
        `DROP INDEX ${this.duplicateTargetIndex} ON ${this.tableName}`
      );
    }

    if (await queryRunner.hasColumn(this.tableName, this.normalizedTargetColumn)) {
      await queryRunner.query(
        `ALTER TABLE ${this.tableName} DROP COLUMN ${this.normalizedTargetColumn}`
      );
    }
  }

  private async normalizeStoredValues(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE ${this.tableName}
       SET scope = LOWER(TRIM(scope))
       WHERE scope IS NOT NULL AND scope <> LOWER(TRIM(scope))`
    );

    await queryRunner.query(
      `UPDATE ${this.tableName}
       SET broker_key = LOWER(TRIM(broker_key))
       WHERE broker_key IS NOT NULL AND broker_key <> LOWER(TRIM(broker_key))`
    );

    await queryRunner.query(
      `UPDATE ${this.tableName}
       SET broker_key = NULL
       WHERE scope <> 'broker' AND broker_key IS NOT NULL`
    );
  }

  private async assertValidScopes(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id, scope
        FROM ${this.tableName}
        WHERE LOWER(TRIM(COALESCE(scope, ''))) NOT IN ('user', 'broker')
        LIMIT 5
      `
    );

    if (!rows.length) {
      return;
    }

    const ids = rows
      .map((row: { id?: string; scope?: string }) => `${row.id || '<unknown>'}:${row.scope || '<blank>'}`)
      .join(', ');
    throw new Error(
      `Cannot harden risk policy targets because invalid scopes already exist: ${ids}`
    );
  }

  private async assertBrokerPoliciesHaveBrokerKey(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id
        FROM ${this.tableName}
        WHERE scope = 'broker' AND NULLIF(TRIM(COALESCE(broker_key, '')), '') IS NULL
        LIMIT 5
      `
    );

    if (!rows.length) {
      return;
    }

    const ids = rows.map((row: { id?: string }) => row.id || '<unknown>').join(', ');
    throw new Error(
      `Cannot harden risk policy targets because broker-scoped policies are missing broker_key: ${ids}`
    );
  }

  private async assertNoModeConflicts(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id
        FROM ${this.tableName}
        WHERE monitor_only = 1 AND enforce_hard_block = 1
        LIMIT 5
      `
    );

    if (!rows.length) {
      return;
    }

    const ids = rows.map((row: { id?: string }) => row.id || '<unknown>').join(', ');
    throw new Error(
      `Cannot harden risk policy targets because monitor-only policies also have hard-block enabled: ${ids}`
    );
  }

  private async assertThresholdOrdering(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id
        FROM ${this.tableName}
        WHERE margin_usage_warn_pct > margin_usage_critical_pct
           OR concentration_warn_pct > concentration_critical_pct
           OR daily_loss_limit_pct > weekly_loss_limit_pct
           OR weekly_loss_limit_pct > monthly_loss_limit_pct
        LIMIT 5
      `
    );

    if (!rows.length) {
      return;
    }

    const ids = rows.map((row: { id?: string }) => row.id || '<unknown>').join(', ');
    throw new Error(
      `Cannot harden risk policy targets because threshold ordering is invalid for these policies: ${ids}`
    );
  }

  private async ensureNormalizedTargetColumn(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn(this.tableName, this.normalizedTargetColumn)) {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE ${this.tableName}
       ADD COLUMN ${this.normalizedTargetColumn} varchar(255)
       GENERATED ALWAYS AS (
         CASE
           WHEN scope = 'user' THEN '__user__'
           WHEN scope = 'broker' THEN CONCAT('broker::', LOWER(TRIM(COALESCE(broker_key, ''))))
           ELSE CONCAT('__invalid__::', LOWER(TRIM(COALESCE(scope, ''))))
         END
       ) STORED`
    );
  }

  private async assertNoDuplicateTargets(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT user_id, ${this.normalizedTargetColumn}, COUNT(*) AS duplicate_count
        FROM ${this.tableName}
        GROUP BY user_id, ${this.normalizedTargetColumn}
        HAVING ${this.normalizedTargetColumn} IS NOT NULL AND duplicate_count > 1
        LIMIT 5
      `
    );

    if (!rows.length) {
      return;
    }

    const targets = rows
      .map(
        (row: { user_id?: string; normalized_target_key?: string }) =>
          `${row.user_id || '<unknown>'}:${row.normalized_target_key || '<blank>'}`
      )
      .join(', ');
    throw new Error(
      `Cannot harden risk policy targets because duplicate owner-scoped targets already exist: ${targets}`
    );
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const result = await queryRunner.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
      indexName,
    ]);

    return Array.isArray(result) && result.length > 0;
  }
}
