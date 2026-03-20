import { Controller, Get, Put, Patch, Post, Delete, Param, Body, Query, Logger, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard, ZoneScopeGuard } from '@campuscast/shared-libs';
import { InternalOrJwtGuard } from './internal-or-jwt.guard';

@Controller('devices')
export class DevicesController {
  private readonly logger = new Logger(DevicesController.name);
  constructor(private svc: DevicesService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard, ZoneScopeGuard)
  async register(@Body() body: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    return this.svc.register(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard, ZoneScopeGuard)
  async list(@Query('zone_id') zoneId: string) {
    const data = await this.svc.findByZone(zoneId);
    return { data };
  }

  @Get(':deviceId')
  @UseGuards(InternalOrJwtGuard)
  async get(@Param('deviceId') id: string) {
    return this.svc.findOne(id);
  }

  @Get(':deviceId/runtime')
  @UseGuards(InternalOrJwtGuard)
  async getRuntime(@Param('deviceId') id: string) {
    return this.svc.getRuntimeDevice(id);
  }

  @Put(':deviceId/assign')
  @UseGuards(JwtAuthGuard)
  async assign(@Param('deviceId') id: string, @Body() body: { group_id: string }) {
    return this.svc.assignToGroup(id, body.group_id);
  }

  @Patch(':deviceId')
  @UseGuards(JwtAuthGuard)
  async update(@Param('deviceId') id: string, @Body() body: { device_name?: string; device_type?: string }) {
    return this.svc.updateDevice(id, body);
  }

  @Delete(':deviceId')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('deviceId') id: string) {
    return this.svc.deleteDevice(id);
  }

  @Put(':deviceId/revoke')
  @UseGuards(JwtAuthGuard)
  async revoke(@Param('deviceId') id: string) {
    return this.svc.revoke(id);
  }

  @Put(':deviceId/bind-key')
  @UseGuards(JwtAuthGuard)
  async bindKey(@Param('deviceId') id: string, @Body() body: { public_key: string; algorithm: string }) {
    return this.svc.bindPublicKey(id, body.public_key, body.algorithm);
  }

  @Post('sync-group')
  async syncGroup(@Body() body: { zone_id: string; group_id: string; action: string }) {
    this.logger.log(`Group sync: zone=${body.zone_id} group=${body.group_id} action=${body.action}`);
    // When a group is deleted, devices in that group must be deprovisioned.
    if (body.action === 'deleted') {
      const removed = await this.svc.deleteByGroup(body.group_id);
      this.logger.log(`Group sync deleted ${removed} device(s) for group=${body.group_id}`);
    }
    return { synced: true };
  }

  @Post('sync-zone')
  async syncZone(@Body() body: { zone_id: string; action: string }) {
    this.logger.log(`Zone sync: zone=${body.zone_id} action=${body.action}`);
    if (body.action === 'deleted') {
      const removed = await this.svc.deleteByZone(body.zone_id);
      this.logger.log(`Zone sync deleted ${removed} device(s) for zone=${body.zone_id}`);
    }
    return { synced: true };
  }
}
