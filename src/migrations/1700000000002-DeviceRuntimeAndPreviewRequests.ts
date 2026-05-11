import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceRuntimeAndPreviewRequests1700000000002 implements MigrationInterface {
  name = 'DeviceRuntimeAndPreviewRequests1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "devices"
      ADD COLUMN IF NOT EXISTS "current_release_id" character varying,
      ADD COLUMN IF NOT EXISTS "current_slot_id" character varying,
      ADD COLUMN IF NOT EXISTS "current_publication_id" character varying,
      ADD COLUMN IF NOT EXISTS "current_publication_title" character varying,
      ADD COLUMN IF NOT EXISTS "current_publication_item_id" character varying,
      ADD COLUMN IF NOT EXISTS "current_publication_item_title" character varying,
      ADD COLUMN IF NOT EXISTS "playback_status" character varying,
      ADD COLUMN IF NOT EXISTS "online" boolean,
      ADD COLUMN IF NOT EXISTS "backend_status" character varying,
      ADD COLUMN IF NOT EXISTS "mqtt_status" character varying,
      ADD COLUMN IF NOT EXISTS "last_error" text,
      ADD COLUMN IF NOT EXISTS "last_telemetry_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "display_metadata" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "selected_display_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "pending_screenshot_request_id" character varying,
      ADD COLUMN IF NOT EXISTS "pending_screenshot_display_id" character varying,
      ADD COLUMN IF NOT EXISTS "pending_screenshot_requested_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "device_previews"
      ADD COLUMN IF NOT EXISTS "display_id" character varying,
      ADD COLUMN IF NOT EXISTS "display_label" character varying,
      ADD COLUMN IF NOT EXISTS "request_id" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "device_previews"
      DROP COLUMN IF EXISTS "request_id",
      DROP COLUMN IF EXISTS "display_label",
      DROP COLUMN IF EXISTS "display_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "devices"
      DROP COLUMN IF EXISTS "pending_screenshot_requested_at",
      DROP COLUMN IF EXISTS "pending_screenshot_display_id",
      DROP COLUMN IF EXISTS "pending_screenshot_request_id",
      DROP COLUMN IF EXISTS "selected_display_ids",
      DROP COLUMN IF EXISTS "display_metadata",
      DROP COLUMN IF EXISTS "last_telemetry_at",
      DROP COLUMN IF EXISTS "last_error",
      DROP COLUMN IF EXISTS "mqtt_status",
      DROP COLUMN IF EXISTS "backend_status",
      DROP COLUMN IF EXISTS "online",
      DROP COLUMN IF EXISTS "playback_status",
      DROP COLUMN IF EXISTS "current_publication_item_title",
      DROP COLUMN IF EXISTS "current_publication_item_id",
      DROP COLUMN IF EXISTS "current_publication_title",
      DROP COLUMN IF EXISTS "current_publication_id",
      DROP COLUMN IF EXISTS "current_slot_id",
      DROP COLUMN IF EXISTS "current_release_id"
    `);
  }
}
