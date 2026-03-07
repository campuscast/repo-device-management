import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { DeviceCredential } from './device-credential.entity';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AuditClient } from '@campuscast/shared-libs';

@Injectable()
export class DevicesService {
  private readonly jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  private readonly tokenTtlSeconds = parseInt(process.env.DEVICE_TOKEN_TTL_SECONDS || '2592000', 10); // 30 days
  private readonly auditClient = new AuditClient();

  constructor(
    @InjectRepository(Device) private repo: Repository<Device>,
    @InjectRepository(DeviceCredential) private credentialRepo: Repository<DeviceCredential>,
  ) {}

  async findByZone(zoneId: string) {
    return this.repo.find({ where: { zone_id: zoneId } });
  }

  async findOne(deviceId: string) {
    const d = await this.repo.findOne({ where: { device_id: deviceId } });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  private async createDevice(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = this.repo.create({
      ...data,
      status: 'active',
      mqtt_client_id: `dev-${randomUUID().slice(0, 8)}`,
    });
    return this.repo.save(device);
  }

  private issueDeviceToken(device: Device): { token: string; jti: string; expiresAt: Date } {
    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.tokenTtlSeconds;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: device.device_id,
      device_id: device.device_id,
      zone_id: device.zone_id,
      group_id: device.group_id,
      type: 'device',
      scopes: ['player:read', 'sync:write'],
      jti,
      iat,
      exp,
    })).toString('base64url');
    const input = `${header}.${payload}`;
    const signature = createHmac('sha256', this.jwtSecret).update(input).digest('base64url');
    const token = `${input}.${signature}`;
    return { token, jti, expiresAt: new Date(exp * 1000) };
  }

  async register(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = await this.createDevice(data);
    const { token, jti, expiresAt } = this.issueDeviceToken(device);

    await this.credentialRepo.save(this.credentialRepo.create({
      device_id: device.device_id,
      token_jti: jti,
      token_hash: createHash('sha256').update(token).digest('hex'),
      algorithm: 'HS256',
      expires_at: expiresAt,
      revoked: false,
    }));

    const response = {
      device_id: device.device_id,
      device_token: token,
      mqtt_client_id: device.mqtt_client_id,
      mqtt_topic_prefix: `zones/${device.zone_id}/groups/${device.group_id}`,
      token_expires_at: expiresAt.toISOString(),
    };

    await this.auditClient.append({
      event_type: 'device.enrolled',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: device.zone_id,
      resource_type: 'device',
      resource_id: device.device_id,
      action: 'enrolled',
      detail: {
        device_type: device.device_type,
        group_id: device.group_id,
      },
    });

    return response;
  }

  async enroll(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    return this.register(data);
  }

  async assignToGroup(deviceId: string, groupId: string) {
    await this.repo.update({ device_id: deviceId }, { group_id: groupId });
    const device = await this.findOne(deviceId);

    await this.auditClient.append({
      event_type: 'device.assigned',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: device.zone_id,
      resource_type: 'device',
      resource_id: device.device_id,
      action: 'assigned',
      detail: { group_id: groupId },
    });

    return device;
  }

  async revoke(deviceId: string) {
    await this.repo.update({ device_id: deviceId }, { status: 'revoked' });
    await this.credentialRepo.update(
      { device_id: deviceId, revoked: false },
      { revoked: true, revoked_reason: 'device_revoked', revoked_at: new Date() },
    );
    return { success: true };
  }

  async bindPublicKey(deviceId: string, publicKey: string, algorithm: string) {
    const keyId = `key-${randomUUID().slice(0, 8)}`;
    await this.repo.update({ device_id: deviceId }, { public_key: publicKey, key_algorithm: algorithm, key_id: keyId, status: 'active' });
    return { key_id: keyId, success: true };
  }

  async unassignGroup(groupId: string) {
    await this.repo.update({ group_id: groupId }, { group_id: '' });
  }
}
