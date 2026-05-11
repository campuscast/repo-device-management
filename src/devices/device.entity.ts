import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('devices')
export class Device {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuid_generate_v4()' })
  device_id: string;

  @Column()
  device_name: string;

  @Column({ default: '' })
  device_type: string; // "android_tv", "desktop", "web", "" (not yet determined)

  @Column({ type: 'varchar', nullable: true })
  hardware_id: string;

  @Column()
  zone_id: string;

  @Column({ default: '' })
  group_id: string;

  @Column({ default: 'pending' })
  status: string; // "pending", "active", "revoked", "offline"

  @Column({ type: 'text', nullable: true })
  public_key: string; // PEM-encoded

  @Column({ type: 'varchar', nullable: true })
  key_id: string;

  @Column({ type: 'varchar', nullable: true })
  key_algorithm: string;

  @Column({ type: 'varchar', nullable: true })
  mqtt_client_id: string;

  @Column({ type: 'varchar', nullable: true })
  current_release_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  current_slot_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  current_publication_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  current_publication_title: string | null;

  @Column({ type: 'varchar', nullable: true })
  current_publication_item_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  current_publication_item_title: string | null;

  @Column({ type: 'varchar', nullable: true })
  playback_status: string | null;

  @Column({ type: 'boolean', nullable: true })
  online: boolean | null;

  @Column({ type: 'varchar', nullable: true })
  backend_status: string | null;

  @Column({ type: 'varchar', nullable: true })
  mqtt_status: string | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_telemetry_at: Date | null;

  @Column({ type: 'jsonb', default: () => '\'[]\'::jsonb' })
  display_metadata: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: () => '\'[]\'::jsonb' })
  selected_display_ids: string[];

  @Column({ type: 'varchar', nullable: true })
  pending_screenshot_request_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  pending_screenshot_display_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pending_screenshot_requested_at: Date | null;

  @CreateDateColumn()
  enrolled_at: Date;

  @UpdateDateColumn()
  last_seen: Date;
}
