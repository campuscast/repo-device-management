import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';
import { JwtAuthGuard, ZoneScopeGuard } from '@campuscast/shared-libs';

@Controller('enrollment')
export class EnrollmentController {
  constructor(private devicesSvc: DevicesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, ZoneScopeGuard)
  async enroll(@Body() body: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    return this.devicesSvc.register(body);
  }
}
