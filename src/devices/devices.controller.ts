import { Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private svc: DevicesService) {}

  @Get()
  async list(@Query('zone_id') zoneId: string) {
    return this.svc.findByZone(zoneId);
  }

  @Get(':deviceId')
  async get(@Param('deviceId') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':deviceId/assign')
  async assign(@Param('deviceId') id: string, @Body() body: { group_id: string }) {
    return this.svc.assignToGroup(id, body.group_id);
  }

  @Put(':deviceId/revoke')
  async revoke(@Param('deviceId') id: string) {
    return this.svc.revoke(id);
  }

  @Put(':deviceId/bind-key')
  async bindKey(@Param('deviceId') id: string, @Body() body: { public_key: string; algorithm: string }) {
    return this.svc.bindPublicKey(id, body.public_key, body.algorithm);
  }
}
