import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Device } from './device.entity';
import { DeviceCredential } from './device-credential.entity';
import { createHash, createHmac, randomUUID, randomInt } from 'crypto';
import { AuditClient } from '@campuscast/shared-libs';

/** Generate UUID device ID */
function generatePlayerId(): string {
  return randomUUID();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class DevicesService {
  private readonly jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  private readonly tokenTtlSeconds = parseInt(process.env.DEVICE_TOKEN_TTL_SECONDS || '2592000', 10); // 30 days
  private readonly auditClient = new AuditClient();
  private readonly zonePolicyUrl = process.env.ZONE_POLICY_URL || 'http://localhost:3002';
  private readonly internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || '';

  constructor(
    @InjectRepository(Device) private repo: Repository<Device>,
    @InjectRepository(DeviceCredential) private credentialRepo: Repository<DeviceCredential>,
  ) {}

  /** Convert canonical UUID to short player-facing ID: XXXX-XXXX-XXXX-XXXX */
  formatPlayerId(deviceId: string): string {
    const compact = deviceId.replace(/[^0-9a-f]/gi, '').slice(0, 16).toUpperCase();
    if (compact.length !== 16) return deviceId.toUpperCase();
    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`;
  }

  private normalizeShortPlayerId(raw: string): string | null {
    const compact = raw.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (compact.length !== 16) return null;
    return /^[0-9a-f]{16}$/.test(compact) ? compact : null;
  }

  private async findByShortPlayerId(shortId: string): Promise<Device> {
    const matches = await this.repo
      .createQueryBuilder('device')
      .where(
        "left(replace(lower(cast(device.device_id as text)), '-', ''), 16) = :shortId",
        { shortId }
      )
      .getMany();

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new BadRequestException('Player ID is ambiguous. Use full Device ID.');
    }
    throw new NotFoundException('Device not found');
  }

  async findByZone(zoneId: string) {
    return this.repo.find({ where: { zone_id: zoneId } });
  }

  async findOne(deviceId: string) {
    const input = deviceId.trim();
    if (!input) throw new NotFoundException('Device not found');

    if (UUID_REGEX.test(input)) {
      const d = await this.repo.findOne({ where: { device_id: input } });
      if (!d) throw new NotFoundException('Device not found');
      return d;
    }

    const shortId = this.normalizeShortPlayerId(input);
    if (shortId) {
      return this.findByShortPlayerId(shortId);
    }

    throw new NotFoundException('Device not found');
  }

  private async createDevice(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = this.repo.create({
      ...data,
      device_id: generatePlayerId(),
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

  /** Create device with status='pending' — no token issued yet. */
  async createPending(data: { device_name: string; device_type?: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = this.repo.create({
      ...data,
      device_id: generatePlayerId(),
      device_type: data.device_type || '',
      status: 'pending',
      mqtt_client_id: `dev-${randomUUID().slice(0, 8)}`,
    });
    const saved = await this.repo.save(device);

    await this.auditClient.append({
      event_type: 'device.enrolled',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: saved.zone_id,
      resource_type: 'device',
      resource_id: saved.device_id,
      action: 'created_pending',
      detail: {
        device_type: saved.device_type,
        group_id: saved.group_id,
      },
    });

    return {
      device_id: saved.device_id,
      player_id: this.formatPlayerId(saved.device_id),
    };
  }

  /** Activate a pending device: set status='active', issue token, return credentials. */
  async activateDevice(deviceId: string) {
    const device = await this.findOne(deviceId);
    const alreadyActive = device.status !== 'pending';

    if (!alreadyActive) {
      await this.repo.update({ device_id: device.device_id }, { status: 'active' });
      device.status = 'active';
    }

    const { token, jti, expiresAt } = this.issueDeviceToken(device);

    await this.credentialRepo.save(this.credentialRepo.create({
      device_id: device.device_id,
      token_jti: jti,
      token_hash: createHash('sha256').update(token).digest('hex'),
      algorithm: 'HS256',
      expires_at: expiresAt,
      revoked: false,
    }));

    if (!alreadyActive) {
      await this.auditClient.append({
        event_type: 'device.enrolled',
        actor_type: 'system',
        actor_id: 'device-management',
        zone_id: device.zone_id,
        resource_type: 'device',
        resource_id: device.device_id,
        action: 'activated',
        detail: {
          device_type: device.device_type,
          group_id: device.group_id,
        },
      });
    }

    return {
      device_id: device.device_id,
      device_token: token,
      mqtt_client_id: device.mqtt_client_id,
      mqtt_topic_prefix: `zones/${device.zone_id}/groups/${device.group_id}`,
      token_expires_at: expiresAt.toISOString(),
      already_active: alreadyActive,
    };
  }

  /** Update hardware_id on a device. */
  async updateHardwareId(deviceId: string, hardwareId: string) {
    const device = await this.findOne(deviceId);
    await this.repo.update({ device_id: device.device_id }, { hardware_id: hardwareId });
  }

  /** Permanently delete a device and its credentials. */
  async deleteDevice(deviceId: string) {
    const device = await this.findOne(deviceId);

    // Remove credentials first (FK-like cleanup)
    await this.credentialRepo.delete({ device_id: device.device_id });
    await this.repo.delete({ device_id: device.device_id });

    await this.auditClient.append({
      event_type: 'device.deleted',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: device.zone_id,
      resource_type: 'device',
      resource_id: device.device_id,
      action: 'deleted',
      detail: {
        device_name: device.device_name,
        device_type: device.device_type,
      },
    });

    return { success: true };
  }

  /** Update device fields (name, type, etc.). */
  async updateDevice(deviceId: string, updates: { device_name?: string; device_type?: string }) {
    const device = await this.findOne(deviceId);
    if (updates.device_name !== undefined) device.device_name = updates.device_name;
    if (updates.device_type !== undefined) device.device_type = updates.device_type;
    const saved = await this.repo.save(device);

    await this.auditClient.append({
      event_type: 'device.updated',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: saved.zone_id,
      resource_type: 'device',
      resource_id: saved.device_id,
      action: 'updated',
      detail: updates,
    });

    return saved;
  }

  async assignToGroup(deviceId: string, groupId: string) {
    const device = await this.findOne(deviceId);
    await this.repo.update({ device_id: device.device_id }, { group_id: groupId });
    const updated = await this.findOne(device.device_id);

    await this.auditClient.append({
      event_type: 'device.assigned',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: updated.zone_id,
      resource_type: 'device',
      resource_id: updated.device_id,
      action: 'assigned',
      detail: { group_id: groupId },
    });

    return updated;
  }

  async revoke(deviceId: string) {
    const device = await this.findOne(deviceId);
    await this.repo.update({ device_id: device.device_id }, { status: 'revoked' });
    await this.credentialRepo.update(
      { device_id: device.device_id, revoked: false },
      { revoked: true, revoked_reason: 'device_revoked', revoked_at: new Date() },
    );
    return { success: true };
  }

  async bindPublicKey(deviceId: string, publicKey: string, algorithm: string) {
    const device = await this.findOne(deviceId);
    const keyId = `key-${randomUUID().slice(0, 8)}`;
    await this.repo.update(
      { device_id: device.device_id },
      { public_key: publicKey, key_algorithm: algorithm, key_id: keyId, status: 'active' }
    );
    return { key_id: keyId, success: true };
  }

  private async validateRuntimeAssignment(zoneId: string, groupId: string): Promise<'valid' | 'invalid' | 'unknown'> {
    try {
      const headers = this.internalServiceToken
        ? { 'x-internal-token': this.internalServiceToken }
        : undefined;

      const zoneRes = await fetch(`${this.zonePolicyUrl}/zones/${encodeURIComponent(zoneId)}`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });

      if (zoneRes.status === 404) return 'invalid';
      if (!zoneRes.ok) return 'unknown';

      const groupsRes = await fetch(`${this.zonePolicyUrl}/zones/${encodeURIComponent(zoneId)}/groups`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });

      if (groupsRes.status === 404) return 'invalid';
      if (!groupsRes.ok) return 'unknown';

      const groups = await groupsRes.json() as Array<{ group_id?: string }>;
      if (!Array.isArray(groups)) return 'unknown';

      const hasGroup = groups.some((group) => group?.group_id === groupId);
      return hasGroup ? 'valid' : 'invalid';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Runtime validation for player-facing auth:
   * - device exists
   * - status is active
   * - zone/group assignment still exists in zone-policy
   */
  async getRuntimeDevice(deviceId: string): Promise<Device> {
    const device = await this.findOne(deviceId);
    if (device.status !== 'active' || !device.zone_id || !device.group_id) {
      throw new NotFoundException('Device not found');
    }

    const assignmentStatus = await this.validateRuntimeAssignment(device.zone_id, device.group_id);
    if (assignmentStatus === 'invalid') {
      throw new NotFoundException('Device not found');
    }
    if (assignmentStatus === 'unknown') {
      throw new ServiceUnavailableException('Device assignment validation unavailable');
    }

    return device;
  }

  async deleteByZone(zoneId: string): Promise<number> {
    const devices = await this.repo.find({ select: ['device_id'], where: { zone_id: zoneId } });
    const deviceIds = devices.map((device) => device.device_id);
    if (deviceIds.length === 0) return 0;

    await this.credentialRepo.delete({ device_id: In(deviceIds) });
    await this.repo.delete({ device_id: In(deviceIds) });

    return deviceIds.length;
  }

  async deleteByGroup(groupId: string): Promise<number> {
    const devices = await this.repo.find({ select: ['device_id'], where: { group_id: groupId } });
    const deviceIds = devices.map((device) => device.device_id);
    if (deviceIds.length === 0) return 0;

    await this.credentialRepo.delete({ device_id: In(deviceIds) });
    await this.repo.delete({ device_id: In(deviceIds) });

    return deviceIds.length;
  }

}
