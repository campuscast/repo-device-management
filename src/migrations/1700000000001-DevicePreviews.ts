import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevicePreviews1700000000001 implements MigrationInterface {
  name = 'DevicePreviews1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_previews" (
        "preview_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "device_id" uuid NOT NULL,
        "image_base64" text,
        "image_url" text,
        "mime_type" character varying NOT NULL DEFAULT 'image/png',
        "status" character varying,
        "captured_at" TIMESTAMP WITH TIME ZONE,
        "width" integer,
        "height" integer,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_previews" PRIMARY KEY ("preview_id")
      )
    `);

    // Compatibility fix: older draft migration created device_id as varchar.
    // Ensure it matches devices.device_id (uuid) before adding FK.
    await queryRunner.query(`
      ALTER TABLE "device_previews"
      ALTER COLUMN "device_id" TYPE uuid USING "device_id"::uuid
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_previews_device"
        ON "device_previews" ("device_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_device_previews_device'
        ) THEN
          ALTER TABLE "device_previews"
          ADD CONSTRAINT "FK_device_previews_device"
          FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "device_previews"
      DROP CONSTRAINT IF EXISTS "FK_device_previews_device"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_previews"`);
  }
}
