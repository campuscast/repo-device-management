import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class DevicesService {
  constructor(@InjectRepository(Device) private repo: Repository<Device>) {}

  async findByZone(zoneId: string) {
    return this.repo.find({ where: { zone_id: zoneId } });
  }

  async findOne(deviceId: string) {
    const d = await this.repo.findOne({ where: { device_id: deviceId } });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  async enroll(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id: string }) {
    const device = this.repo.create({
      ...data,
      status: 'pending',
      mqtt_client_id: `dev-${randomUUID().slice(0, 8)}`,
    });
    return this.repo.save(device);
  }

  async assignToGroup(deviceId: string, groupId: string) {
    await this.repo.update({ device_id: deviceId }, { group_id: groupId });
    return this.findOne(deviceId);
  }

  async revoke(deviceId: string) {
    await this.repo.update({ device_id: deviceId }, { status: 'revoked' });
    return { success: true };
  }

  async bindPublicKey(deviceId: string, publicKey: string, algorithm: string) {
    const keyId = `key-${randomUUID().slice(0, 8)}`;
    await this.repo.update({ device_id: deviceId }, { public_key: publicKey, key_algorithm: algorithm, key_id: keyId, status: 'active' });
    return { key_id: keyId, success: true };
  }
}
