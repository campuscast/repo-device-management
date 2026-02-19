import { Controller, Post, Body } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';

@Controller('enrollment')
export class EnrollmentController {
  constructor(private devicesSvc: DevicesService) {}

  @Post()
  async enroll(@Body() body: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = await this.devicesSvc.enroll(body);
    return {
      device_id: device.device_id,
      mqtt_client_id: device.mqtt_client_id,
      mqtt_topic_prefix: `zones/${device.zone_id}/groups/${device.group_id}`,
      status: device.status,
    };
  }
}
