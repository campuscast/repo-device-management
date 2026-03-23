import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './device.entity';
import { DeviceCredential } from './device-credential.entity';
import { DevicePreview } from './device-preview.entity';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { InternalOrJwtGuard } from './internal-or-jwt.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Device, DeviceCredential, DevicePreview])],
  providers: [DevicesService, InternalOrJwtGuard],
  controllers: [DevicesController],
  exports: [DevicesService],
})
export class DevicesModule {}
