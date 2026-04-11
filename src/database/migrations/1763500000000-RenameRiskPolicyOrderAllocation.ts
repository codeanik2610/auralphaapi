import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class RenameRiskPolicyOrderAllocation1763500000000 implements MigrationInterface {
  private readonly tableName = 'risk_policies';
  private readonly oldColumn = 'max_order_notional';
  private readonly newColumn = 'max_order_allocation';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    const table = await queryRunner.getTable(this.tableName);
    if (!table) {
      return;
    }

    const hasOld = Boolean(table.findColumnByName(this.oldColumn));
    const hasNew = Boolean(table.findColumnByName(this.newColumn));

    if (hasOld && !hasNew) {
      await queryRunner.renameColumn(this.tableName, this.oldColumn, this.newColumn);
      return;
    }

    if (hasOld && hasNew) {
      await queryRunner.dropColumn(this.tableName, this.oldColumn);
      return;
    }

    if (!hasNew) {
      await queryRunner.addColumn(
        this.tableName,
        new TableColumn({ name: this.newColumn, type: 'double', isNullable: true })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    const table = await queryRunner.getTable(this.tableName);
    if (!table) {
      return;
    }

    const hasOld = Boolean(table.findColumnByName(this.oldColumn));
    const hasNew = Boolean(table.findColumnByName(this.newColumn));

    if (hasNew && !hasOld) {
      await queryRunner.renameColumn(this.tableName, this.newColumn, this.oldColumn);
      return;
    }

    if (hasNew && hasOld) {
      await queryRunner.dropColumn(this.tableName, this.newColumn);
      return;
    }

    if (!hasOld) {
      await queryRunner.addColumn(
        this.tableName,
        new TableColumn({ name: this.oldColumn, type: 'double', isNullable: true })
      );
    }
  }
}
