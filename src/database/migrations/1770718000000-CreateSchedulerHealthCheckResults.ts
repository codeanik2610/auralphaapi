import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateSchedulerHealthCheckResults1770718000000
  implements MigrationInterface
{
  name = 'CreateSchedulerHealthCheckResults1770718000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_health_check_results (
        id char(36) NOT NULL,
        run_log_id char(36) NOT NULL,
        check_id varchar(100) NOT NULL,
        check_label varchar(191) NOT NULL,
        status varchar(32) NOT NULL,
        detail text DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_scheduler_health_check_results_run_created (run_log_id, created_at),
        KEY idx_scheduler_health_check_results_status_created (status, created_at),
        CONSTRAINT fk_scheduler_health_check_results_run_log
          FOREIGN KEY (run_log_id) REFERENCES scheduler_run_logs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS scheduler_health_check_results');
  }
}
