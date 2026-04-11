import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateSignalAlertLinksTable1765307000000 implements MigrationInterface {
  name = 'CreateSignalAlertLinksTable1765307000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS signal_alert_links (
        id char(36) NOT NULL,
        signal_id char(36) NOT NULL,
        alert_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        relation_type varchar(30) NOT NULL DEFAULT 'related',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY ux_signal_alert_links_signal_alert_relation (signal_id, alert_id, relation_type),
        KEY idx_signal_alert_links_signal_created_at (signal_id, created_at),
        KEY idx_signal_alert_links_alert_created_at (alert_id, created_at),
        KEY idx_signal_alert_links_user_signal_created_at (user_id, signal_id, created_at),
        CONSTRAINT fk_signal_alert_links_signal_id FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
        CONSTRAINT fk_signal_alert_links_alert_id FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS signal_alert_links');
  }
}
