import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from './devices/devices.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { Device } from './devices/device.entity';
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
      entities: [Device],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    DevicesModule, EnrollmentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
