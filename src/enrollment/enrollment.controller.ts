import { Controller, Post, Get, Body, Query, UseGuards, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { DevicesService } from '../devices/devices.service';
import { ActivationCode } from './activation-code.entity';
import { JwtAuthGuard, ZoneScopeGuard } from '@campuscast/shared-libs';
import { randomInt } from 'crypto';

@Controller('enrollment')
export class EnrollmentController {
  private static readonly CODE_TTL_MINUTES = 15;
  private readonly zonePolicyUrl = process.env.ZONE_POLICY_URL || 'http://localhost:3002';

  constructor(
    private devicesSvc: DevicesService,
    @InjectRepository(ActivationCode) private codeRepo: Repository<ActivationCode>,
  ) {}

  /** Resolve zone and group names from zone-policy service */
  private async resolveZoneGroupNames(zoneId: string, groupId: string): Promise<{ zone_name: string; group_name: string }> {
    let zone_name = '';
    let group_name = '';
    try {
      const zoneRes = await fetch(`${this.zonePolicyUrl}/zones/${zoneId}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (zoneRes.ok) {
        const zone = await zoneRes.json() as { name?: string };
        zone_name = zone.name ?? '';
      }
      const groupsRes = await fetch(`${this.zonePolicyUrl}/zones/${zoneId}/groups`, {
        signal: AbortSignal.timeout(3000),
      });
      if (groupsRes.ok) {
        const groups = await groupsRes.json();
        const group = Array.isArray(groups) ? groups.find((g: any) => g.group_id === groupId) : null;
        group_name = group?.name ?? '';
      }
    } catch {
      // Silent fail — names are optional
    }
    return { zone_name, group_name };
  }

  /* ─── Legacy endpoint (backward compat) ─────────────────────────── */

  @Post()
  @UseGuards(JwtAuthGuard, ZoneScopeGuard)
  async enroll(@Body() body: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    return this.devicesSvc.register(body);
  }

  /* ─── New: create pending device (CMS calls this) ───────────────── */

  @Post('create')
  @UseGuards(JwtAuthGuard, ZoneScopeGuard)
  async createPending(@Body() body: { device_name: string; device_type?: string; hardware_id?: string; zone_id: string; group_id: string }) {
    return this.devicesSvc.createPending(body);
  }

  /* ─── New: device requests activation code (unauthenticated) ────── */

  @Post('request-code')
  async requestCode(@Body() body: { device_id: string }) {
    if (!body.device_id) throw new BadRequestException('device_id is required');

    const device = await this.devicesSvc.findOne(body.device_id);
    const resolvedDeviceId = device.device_id;
    if (device.status !== 'pending') {
      throw new ConflictException('Device is not in pending state');
    }

    // Invalidate any previous unused codes for this device
    await this.codeRepo.update(
      { device_id: resolvedDeviceId, used: false },
      { used: true },
    );

    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + EnrollmentController.CODE_TTL_MINUTES * 60 * 1000);

    await this.codeRepo.save(this.codeRepo.create({
      device_id: resolvedDeviceId,
      code,
      used: false,
      expires_at: expiresAt,
    }));

    return {
      activation_code: code,
      expires_in: EnrollmentController.CODE_TTL_MINUTES * 60,
    };
  }

  /* ─── New: CMS activates device by code ─────────────────────────── */

  @Post('activate-by-code')
  @UseGuards(JwtAuthGuard)
  async activateByCode(@Body() body: { device_id: string; activation_code: string }) {
    if (!body.device_id || !body.activation_code) {
      throw new BadRequestException('device_id and activation_code are required');
    }

    const device = await this.devicesSvc.findOne(body.device_id);
    const resolvedDeviceId = device.device_id;

    const codeRecord = await this.codeRepo.findOne({
      where: {
        device_id: resolvedDeviceId,
        code: body.activation_code,
        used: false,
        expires_at: MoreThan(new Date()),
      },
    });

    if (!codeRecord) {
      throw new BadRequestException('Invalid or expired activation code');
    }

    // Mark code as used
    codeRecord.used = true;
    await this.codeRepo.save(codeRecord);

    // Activate device and issue credentials
    return this.devicesSvc.activateDevice(resolvedDeviceId);
  }

  /* ─── New: CMS activates device by MAC address ──────────────────── */

  @Post('activate-by-mac')
  @UseGuards(JwtAuthGuard)
  async activateByMac(@Body() body: { device_id: string; hardware_id: string }) {
    if (!body.device_id || !body.hardware_id) {
      throw new BadRequestException('device_id and hardware_id are required');
    }

    const device = await this.devicesSvc.findOne(body.device_id);
    const resolvedDeviceId = device.device_id;
    if (device.status !== 'pending') {
      throw new ConflictException('Device is not in pending state');
    }

    // Store/update the hardware_id (MAC address)
    await this.devicesSvc.updateHardwareId(resolvedDeviceId, body.hardware_id);

    // Activate device and issue credentials
    return this.devicesSvc.activateDevice(resolvedDeviceId);
  }

  /* ─── Player-facing device info (zone/group names) ─── */

  @Get('device-info')
  async getDeviceInfo(@Query('device_id') deviceId: string) {
    if (!deviceId) throw new BadRequestException('device_id is required');
    const device = await this.devicesSvc.findOne(deviceId);
    const { zone_name, group_name } = await this.resolveZoneGroupNames(device.zone_id, device.group_id);
    return {
      device_id: device.device_id,
      device_name: device.device_name,
      zone_id: device.zone_id,
      group_id: device.group_id,
      zone_name,
      group_name,
    };
  }

  /* ─── New: device polls for credentials after activation (unauthenticated) ─── */

  @Get('credentials')
  async getCredentials(
    @Query('device_id') deviceId: string,
    @Query('code') code: string,
  ) {
    if (!deviceId || !code) {
      throw new BadRequestException('device_id and code are required');
    }

    const device = await this.devicesSvc.findOne(deviceId);
    const resolvedDeviceId = device.device_id;

    // Verify the code was used for this device (activation completed)
    const codeRecord = await this.codeRepo.findOne({
      where: {
        device_id: resolvedDeviceId,
        code,
        used: true,
      },
    });

    if (!codeRecord) {
      throw new NotFoundException('No completed activation found for this code');
    }

    if (device.status !== 'active') {
      throw new ConflictException('Device is not yet activated');
    }

    // Re-issue credentials for the device to pick up
    const result = await this.devicesSvc.activateDevice(resolvedDeviceId);

    // Resolve zone and group names
    const { zone_name, group_name } = await this.resolveZoneGroupNames(device.zone_id, device.group_id);

    return {
      device_id: result.device_id,
      device_token: result.device_token,
      mqtt_client_id: result.mqtt_client_id,
      mqtt_topic_prefix: result.mqtt_topic_prefix,
      zone_name,
      group_name,
    };
  }
}
