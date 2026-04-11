import { hashSync } from 'bcryptjs';
import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { randomUUID } from 'crypto';
import { env } from '../../env';

@Service()
export class CreateAuthTables1741480000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) {
      await queryRunner.createTable(
        new Table({
          name: 'users',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'email', type: 'varchar', length: '191', isUnique: true },
            { name: 'password_hash', type: 'varchar', length: '255' },
            { name: 'full_name', type: 'varchar', length: '191' },
            { name: 'role', type: 'varchar', length: '64', default: "'Trader'" },
            { name: 'status', type: 'varchar', length: '32', default: "'active'" },
            { name: 'last_login_at', type: 'timestamp', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
          ],
        })
      );
    }

    const hasRefreshTokens = await queryRunner.hasTable('refresh_tokens');
    if (!hasRefreshTokens) {
      await queryRunner.createTable(
        new Table({
          name: 'refresh_tokens',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'token_hash', type: 'char', length: '64', isUnique: true },
            { name: 'user_id', type: 'varchar', length: '36' },
            { name: 'expires_at', type: 'timestamp' },
            { name: 'revoked_at', type: 'timestamp', isNullable: true },
            { name: 'user_agent', type: 'varchar', length: '255', isNullable: true },
            { name: 'ip_address', type: 'varchar', length: '64', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          ],
          foreignKeys: [
            {
              name: 'FK_refresh_tokens_user_id',
              columnNames: ['user_id'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
        })
      );

      await queryRunner.createIndex(
        'refresh_tokens',
        new TableIndex({ name: 'IDX_refresh_tokens_user_id', columnNames: ['user_id'] })
      );
    }

    if (env.auth.seedEnabled) {
      const email = env.auth.seedEmail.toLowerCase();
      const password = env.auth.seedPassword;
      const fullName = env.auth.seedFullName;
      const existingUsers = await queryRunner.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );

      if (!existingUsers.length) {
        const userId = randomUUID();
        await queryRunner.query(
          'INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [userId, email, hashSync(password, 10), fullName, 'Admin', 'active']
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('refresh_tokens')) {
      await queryRunner.dropTable('refresh_tokens', true);
    }
    if (await queryRunner.hasTable('users')) {
      await queryRunner.dropTable('users', true);
    }
  }
}
