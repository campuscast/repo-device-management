import { Module } from '@nestjs/common';
import { MetricsModule } from '@campuscast/shared-libs';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from './devices/devices.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { Device } from './devices/device.entity';
import { DeviceCredential } from './devices/device-credential.entity';
import { HealthController } from './common/health.controller';
import { appConfig, dbConfig, redisConfig, validate } from './config';

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
      entities: [Device, DeviceCredential],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    DevicesModule, EnrollmentModule,
      MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
