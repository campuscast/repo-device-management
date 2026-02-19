import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { EnrollmentController } from './enrollment.controller';
@Module({
  imports: [DevicesModule],
  controllers: [EnrollmentController],
})
export class EnrollmentModule {}
