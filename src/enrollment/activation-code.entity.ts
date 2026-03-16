import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('activation_codes')
@Index(['device_id'])
@Index(['code'])
export class ActivationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  device_id: string;

  @Column({ length: 6 })
  code: string;

  @Column({ default: false })
  used: boolean;

  @Column()
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
