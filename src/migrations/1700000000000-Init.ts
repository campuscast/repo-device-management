import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real initial migration for device_db.
 * Tables: devices, device_credentials, activation_codes
 */
export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "devices" (
        "device_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "device_name" character varying NOT NULL,
        "device_type" character varying NOT NULL DEFAULT '',
        "hardware_id" character varying,
        "zone_id" character varying NOT NULL,
        "group_id" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "public_key" character varying,
        "key_id" character varying,
        "key_algorithm" character varying,
        "mqtt_client_id" character varying,
        "enrolled_at" TIMESTAMP NOT NULL DEFAULT now(),
        "last_seen" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_devices" PRIMARY KEY ("device_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_credentials" (
        "credential_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "device_id" character varying NOT NULL,
        "token_jti" character varying NOT NULL,
        "token_hash" character varying NOT NULL,
        "algorithm" character varying NOT NULL DEFAULT 'HS256',
        "revoked" boolean NOT NULL DEFAULT false,
        "revoked_reason" character varying,
        "revoked_at" TIMESTAMP,
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_credentials" PRIMARY KEY ("credential_id"),
        CONSTRAINT "UQ_device_credentials_jti" UNIQUE ("token_jti")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_device_credentials_device"
        ON "device_credentials" ("device_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "activation_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "device_id" character varying NOT NULL,
        "code" character varying(6) NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_activation_codes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activation_codes_device"
        ON "activation_codes" ("device_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activation_codes_code"
        ON "activation_codes" ("code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "activation_codes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "devices"`);
  }
}
