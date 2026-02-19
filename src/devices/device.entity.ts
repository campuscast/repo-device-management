import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  device_id: string;

  @Column()
  device_name: string;

  @Column()
  device_type: string; // "android_tv", "desktop", "web"

  @Column({ nullable: true })
  hardware_id: string;

  @Column()
  zone_id: string;

  @Column()
  group_id: string;

  @Column({ default: 'pending' })
  status: string; // "pending", "active", "revoked", "offline"

  @Column({ nullable: true })
  public_key: string; // PEM-encoded

  @Column({ nullable: true })
  key_id: string;

  @Column({ nullable: true })
  key_algorithm: string;

  @Column({ nullable: true })
  mqtt_client_id: string;

  @CreateDateColumn()
  enrolled_at: Date;

  @UpdateDateColumn()
  last_seen: Date;
}
