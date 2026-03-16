import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices/devices.module';
import { ActivationCode } from './activation-code.entity';
import { EnrollmentController } from './enrollment.controller';

@Module({
  imports: [DevicesModule, TypeOrmModule.forFeature([ActivationCode])],
  controllers: [EnrollmentController],
})
export class EnrollmentModule {}
