import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('device_credentials')
@Index(['device_id'])
@Index(['token_jti'], { unique: true })
export class DeviceCredential {
  @PrimaryGeneratedColumn('uuid')
  credential_id: string;

  @Column()
  device_id: string;

  @Column()
  token_jti: string;

  @Column()
  token_hash: string;

  @Column({ default: 'HS256' })
  algorithm: string;

  @Column({ default: false })
  revoked: boolean;

  @Column({ nullable: true })
  revoked_reason: string;

  @Column({ nullable: true })
  revoked_at: Date;

  @Column()
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
