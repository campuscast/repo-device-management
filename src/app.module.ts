import { Module } from '@nestjs/common';
import { MetricsModule } from '@campuscast/shared-libs';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from './devices/devices.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { Device } from './devices/device.entity';
import { DeviceCredential } from './devices/device-credential.entity';
import { DevicePreview } from './devices/device-preview.entity';
import { ActivationCode } from './enrollment/activation-code.entity';
import { Init1700000000000 } from './migrations/1700000000000-Init';
import { DevicePreviews1700000000001 } from './migrations/1700000000001-DevicePreviews';
import { HealthController } from './common/health.controller';
import { appConfig, dbConfig, redisConfig, validate } from './config';

const dbSynchronize = process.env.DB_SYNCHRONIZE === 'true';
const dbMigrationsRun = process.env.DB_MIGRATIONS_RUN !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, dbConfig, redisConfig],
      validate,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgresql://campuscast:campuscast@localhost:5432/device_db',
      entities: [Device, DeviceCredential, DevicePreview, ActivationCode],
      migrations: [Init1700000000000, DevicePreviews1700000000001],
      migrationsRun: dbMigrationsRun,
      synchronize: dbSynchronize,
      logging: process.env.NODE_ENV === 'development',
    }),
    DevicesModule, EnrollmentModule,
      MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
