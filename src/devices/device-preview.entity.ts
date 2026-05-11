import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Device } from './device.entity';

@Entity('device_previews')
@Index(['device_id'], { unique: true })
export class DevicePreview {
  @PrimaryGeneratedColumn('uuid')
  preview_id: string;

  @Column({ type: 'uuid' })
  device_id: string;

  @Column({ type: 'text', nullable: true })
  image_base64: string | null;

  @Column({ type: 'text', nullable: true })
  image_url: string | null;

  @Column({ default: 'image/png' })
  mime_type: string;

  @Column({ type: 'varchar', nullable: true })
  status: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  captured_at: Date | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', nullable: true })
  display_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  display_label: string | null;

  @Column({ type: 'varchar', nullable: true })
  request_id: string | null;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Device;
}
