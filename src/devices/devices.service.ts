import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Device } from './device.entity';
import { DeviceCredential } from './device-credential.entity';
import { DevicePreview } from './device-preview.entity';
import { createHash, createHmac, randomUUID, randomInt } from 'crypto';
import { AuditClient, type AuditEventPayload } from '@campuscast/shared-libs';

/** Generate UUID device ID */
function generatePlayerId(): string {
  return randomUUID();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNGROUPED_TOPIC_SEGMENT = 'devices';
const DEFAULT_RUNTIME_ONLINE_TTL_MS = 45_000;

type RuntimeDisplay = {
  id: string;
  label: string;
  width: number;
  height: number;
  selected: boolean;
};

type RuntimeTelemetryPayload = {
  current_release_id?: string | null;
  current_slot_id?: string | null;
  current_publication_id?: string | null;
  current_publication_title?: string | null;
  current_publication_item_id?: string | null;
  current_publication_item_title?: string | null;
  playback_status?: string | null;
  errors?: string[];
  displays?: unknown;
  selected_displays?: unknown;
  timestamp?: string | null;
  online?: boolean | null;
  backend_status?: string | null;
  mqtt_status?: string | null;
  last_error?: string | null;
};

type RuntimeScreenshotRequest = {
  request_id: string;
  display_id: string;
  requested_at: string;
};

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  private readonly tokenTtlSeconds = parseInt(process.env.DEVICE_TOKEN_TTL_SECONDS || '2592000', 10); // 30 days
  private readonly runtimeOnlineTtlMs = parseInt(
    process.env.DEVICE_RUNTIME_ONLINE_TTL_MS || `${DEFAULT_RUNTIME_ONLINE_TTL_MS}`,
    10,
  );
  private readonly auditClient = new AuditClient();
  private readonly zonePolicyUrl = process.env.ZONE_POLICY_URL || 'http://localhost:3002';
  private readonly internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || '';

  constructor(
    @InjectRepository(Device) private repo: Repository<Device>,
    @InjectRepository(DeviceCredential) private credentialRepo: Repository<DeviceCredential>,
    @InjectRepository(DevicePreview) private previewRepo: Repository<DevicePreview>,
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

  private normalizeGroupId(groupId?: string | null): string {
    return typeof groupId === 'string' ? groupId.trim() : '';
  }

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const next = value.trim();
    return next ? next : null;
  }

  private normalizeTimestamp(value: unknown, fieldName: string): Date | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a valid ISO timestamp`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO timestamp`);
    }
    return parsed;
  }

  private normalizeDisplays(
    displays: unknown,
    selectedDisplayIds: string[],
  ): Array<Record<string, unknown>> {
    if (!Array.isArray(displays)) return [];

    return displays
      .map((display) => {
        if (!display || typeof display !== 'object') return null;
        const shape = display as Record<string, unknown>;
        const id = this.normalizeString(shape.id);
        const width = typeof shape.width === 'number' && Number.isFinite(shape.width)
          ? Math.max(0, Math.round(shape.width))
          : null;
        const height = typeof shape.height === 'number' && Number.isFinite(shape.height)
          ? Math.max(0, Math.round(shape.height))
          : null;

        if (!id || width == null || height == null) return null;

        const label = this.normalizeString(shape.label) ?? id;
        return {
          id,
          label,
          width,
          height,
          selected: selectedDisplayIds.includes(id),
        } as Record<string, unknown>;
      })
      .filter((display): display is Record<string, unknown> => Boolean(display));
  }

  private normalizeSelectedDisplayIds(selectedDisplays: unknown, displays: Array<Record<string, unknown>>): string[] {
    if (!Array.isArray(selectedDisplays)) return [];
    const knownDisplayIds = new Set(
      displays
        .map((display) => (typeof display.id === 'string' ? display.id : ''))
        .filter(Boolean),
    );

    return selectedDisplays
      .map((displayId) => (typeof displayId === 'string' ? displayId.trim() : ''))
      .filter((displayId) => Boolean(displayId) && (knownDisplayIds.size === 0 || knownDisplayIds.has(displayId)));
  }

  private getStoredDisplays(device: Device): RuntimeDisplay[] {
    const rawDisplays = Array.isArray(device.display_metadata) ? device.display_metadata : [];
    return rawDisplays
      .map((display) => {
        if (!display || typeof display !== 'object') return null;
        const shape = display as Record<string, unknown>;
        const id = typeof shape.id === 'string' ? shape.id : '';
        const label = typeof shape.label === 'string' ? shape.label : id;
        const width = typeof shape.width === 'number' ? shape.width : null;
        const height = typeof shape.height === 'number' ? shape.height : null;
        if (!id || width == null || height == null) return null;

        return {
          id,
          label,
          width,
          height,
          selected: typeof shape.selected === 'boolean'
            ? shape.selected
            : Array.isArray(device.selected_display_ids) && device.selected_display_ids.includes(id),
        };
      })
      .filter((display): display is RuntimeDisplay => Boolean(display));
  }

  private buildPendingScreenshotRequest(device: Device): RuntimeScreenshotRequest | null {
    if (!device.pending_screenshot_request_id || !device.pending_screenshot_display_id || !device.pending_screenshot_requested_at) {
      return null;
    }

    return {
      request_id: device.pending_screenshot_request_id,
      display_id: device.pending_screenshot_display_id,
      requested_at: device.pending_screenshot_requested_at.toISOString(),
    };
  }

  private isRuntimeTelemetryFresh(lastTelemetryAt: Date | null): boolean {
    if (!(lastTelemetryAt instanceof Date) || Number.isNaN(lastTelemetryAt.getTime())) {
      return false;
    }
    return Date.now() - lastTelemetryAt.getTime() <= this.runtimeOnlineTtlMs;
  }

  private isDeviceOnline(device: Pick<Device, 'online' | 'last_telemetry_at'>): boolean {
    return device.online === true && this.isRuntimeTelemetryFresh(device.last_telemetry_at);
  }

  private buildRuntimeSnapshot(device: Device) {
    const online = this.isDeviceOnline(device);
    return {
      device_id: device.device_id,
      device_name: device.device_name,
      zone_id: device.zone_id,
      group_id: device.group_id,
      status: device.status,
      current_release_id: device.current_release_id ?? null,
      current_slot_id: device.current_slot_id ?? null,
      current_publication_id: device.current_publication_id ?? null,
      current_publication_title: device.current_publication_title ?? null,
      current_publication_item_id: device.current_publication_item_id ?? null,
      current_publication_item_title: device.current_publication_item_title ?? null,
      playback_status: device.playback_status ?? null,
      online,
      backend_status: device.backend_status ?? null,
      mqtt_status: device.mqtt_status ?? null,
      last_error: device.last_error ?? null,
      last_telemetry_at: device.last_telemetry_at?.toISOString?.() || null,
      displays: this.getStoredDisplays(device),
      selected_display_ids: Array.isArray(device.selected_display_ids) ? device.selected_display_ids : [],
      screenshot_request: this.buildPendingScreenshotRequest(device),
    };
  }

  private buildMqttTopicPrefix(device: Pick<Device, 'device_id' | 'zone_id' | 'group_id'>): string {
    const groupId = this.normalizeGroupId(device.group_id);
    return groupId
      ? `zones/${device.zone_id}/groups/${groupId}`
      : `zones/${device.zone_id}/${UNGROUPED_TOPIC_SEGMENT}/${device.device_id}`;
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
    const devices = await this.repo.find({ where: { zone_id: zoneId } });
    return devices.map((device) => ({
      ...device,
      online: this.isDeviceOnline(device),
    }));
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

  async getDevicePreview(deviceId: string) {
    const device = await this.findOne(deviceId);
    const preview = await this.previewRepo.findOne({ where: { device_id: device.device_id } });
    if (!preview) {
      return {
        device_id: device.device_id,
        device_name: device.device_name,
        zone_id: device.zone_id,
        group_id: device.group_id,
        preview_available: false,
        display_id: null,
        display_label: null,
        request_id: null,
        updated_at: null,
      };
    }

    return {
      device_id: device.device_id,
      device_name: device.device_name,
      zone_id: device.zone_id,
      group_id: device.group_id,
      preview_available: Boolean(preview.image_base64 || preview.image_url),
      image_base64: preview.image_base64,
      image_url: preview.image_url,
      mime_type: preview.mime_type,
      status: preview.status,
      captured_at: preview.captured_at?.toISOString?.() || null,
      width: preview.width,
      height: preview.height,
      display_id: preview.display_id,
      display_label: preview.display_label,
      request_id: preview.request_id,
      updated_at: preview.updated_at?.toISOString?.() || null,
    };
  }

  async getDeviceRuntimeSnapshot(deviceId: string) {
    const device = await this.findOne(deviceId);
    return this.buildRuntimeSnapshot(device);
  }

  async upsertDevicePreview(deviceId: string, payload: {
    image_base64?: string;
    image_url?: string;
    mime_type?: string;
    status?: string;
    captured_at?: string;
    width?: number;
    height?: number;
    display_id?: string;
    display_label?: string;
    request_id?: string;
  }) {
    const device = await this.findOne(deviceId);
    const current = await this.previewRepo.findOne({ where: { device_id: device.device_id } });
    const capturedAt = this.normalizeTimestamp(payload.captured_at, 'captured_at');
    const requestedDisplayId = this.normalizeString(payload.display_id);
    const displayLabelFromInventory = requestedDisplayId
      ? this.getStoredDisplays(device).find((display) => display.id === requestedDisplayId)?.label ?? null
      : null;
    const requestedDisplayLabel = this.normalizeString(payload.display_label) ?? displayLabelFromInventory;
    const requestId = this.normalizeString(payload.request_id);

    const next = current
      ? { ...current }
      : this.previewRepo.create({
          device_id: device.device_id,
          image_base64: null,
          image_url: null,
          mime_type: 'image/png',
          status: 'ok',
          captured_at: null,
          width: null,
          height: null,
          display_id: null,
          display_label: null,
          request_id: null,
        });

    if (payload.image_base64 !== undefined) next.image_base64 = payload.image_base64 || null;
    if (payload.image_url !== undefined) next.image_url = payload.image_url || null;
    if (payload.mime_type !== undefined) next.mime_type = payload.mime_type || 'image/png';
    if (payload.status !== undefined) next.status = payload.status || null;
    if (payload.width !== undefined) next.width = Number.isFinite(payload.width) ? payload.width : null;
    if (payload.height !== undefined) next.height = Number.isFinite(payload.height) ? payload.height : null;
    if (payload.display_id !== undefined) next.display_id = requestedDisplayId;
    if (payload.display_label !== undefined || payload.display_id !== undefined) next.display_label = requestedDisplayLabel;
    if (payload.request_id !== undefined) next.request_id = requestId;
    if (payload.captured_at !== undefined) next.captured_at = capturedAt;

    const saved = await this.previewRepo.save(next);
    if (requestId && device.pending_screenshot_request_id === requestId) {
      await this.repo.update(
        { device_id: device.device_id },
        {
          pending_screenshot_request_id: null,
          pending_screenshot_display_id: null,
          pending_screenshot_requested_at: null,
        },
      );
    }

    return {
      preview_id: saved.preview_id,
      device_id: saved.device_id,
      updated_at: saved.updated_at?.toISOString?.() || null,
    };
  }

  async updateRuntimeTelemetry(deviceId: string, payload: RuntimeTelemetryPayload) {
    const device = await this.getRuntimeDevice(deviceId);
    const selectedDisplayIds = this.normalizeSelectedDisplayIds(payload.selected_displays, this.normalizeDisplays(payload.displays, []));
    const displays = this.normalizeDisplays(payload.displays, selectedDisplayIds);
    const lastTelemetryAt = this.normalizeTimestamp(payload.timestamp, 'timestamp') ?? new Date();

    device.current_release_id = this.normalizeString(payload.current_release_id);
    device.current_slot_id = this.normalizeString(payload.current_slot_id);
    device.current_publication_id = this.normalizeString(payload.current_publication_id);
    device.current_publication_title = this.normalizeString(payload.current_publication_title);
    device.current_publication_item_id = this.normalizeString(payload.current_publication_item_id);
    device.current_publication_item_title = this.normalizeString(payload.current_publication_item_title);
    device.playback_status = this.normalizeString(payload.playback_status);
    device.online = typeof payload.online === 'boolean' ? payload.online : null;
    device.backend_status = this.normalizeString(payload.backend_status);
    device.mqtt_status = this.normalizeString(payload.mqtt_status);
    device.last_error = this.normalizeString(payload.last_error)
      ?? (Array.isArray(payload.errors) ? this.normalizeString(payload.errors.at(-1)) : null);
    device.last_telemetry_at = lastTelemetryAt;
    device.display_metadata = displays;
    device.selected_display_ids = selectedDisplayIds;
    device.last_seen = new Date();

    const saved = await this.repo.save(device);
    return {
      screenshot_request: this.buildPendingScreenshotRequest(saved),
    };
  }

  async requestScreenshot(deviceId: string, displayId?: string | null) {
    const device = await this.getRuntimeDevice(deviceId);
    const displays = this.getStoredDisplays(device);
    if (displays.length === 0) {
      throw new BadRequestException('No display telemetry available for this device yet');
    }

    const selectedDisplayId = this.normalizeString(displayId);
    const requestedDisplay = selectedDisplayId
      ? displays.find((display) => display.id === selectedDisplayId)
      : displays.find((display) => display.selected) ?? displays[0];

    if (!requestedDisplay) {
      throw new BadRequestException('Display not found for this device');
    }

    const requestId = randomUUID();
    const requestedAt = new Date();

    await this.repo.update(
      { device_id: device.device_id },
      {
        pending_screenshot_request_id: requestId,
        pending_screenshot_display_id: requestedDisplay.id,
        pending_screenshot_requested_at: requestedAt,
      },
    );

    return {
      device_id: device.device_id,
      request_id: requestId,
      display_id: requestedDisplay.id,
      requested_at: requestedAt.toISOString(),
    };
  }

  private async createDevice(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id?: string }) {
    const device = this.repo.create({
      ...data,
      group_id: this.normalizeGroupId(data.group_id),
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

  /**
   * Audit trail must not block core enrollment operations.
   * Append asynchronously and log unexpected runtime failures.
   */
  private appendAudit(event: AuditEventPayload): void {
    void this.auditClient.append(event).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Audit append task crashed for event=${event.event_type} reason=${message}`);
    });
  }

  async register(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id?: string }) {
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
      mqtt_topic_prefix: this.buildMqttTopicPrefix(device),
      token_expires_at: expiresAt.toISOString(),
    };

    this.appendAudit({
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

  async enroll(data: { device_name: string; device_type: string; hardware_id?: string; zone_id: string; group_id?: string }) {
    return this.register(data);
  }

  /** Create device with status='pending' — no token issued yet. */
  async createPending(data: { device_name: string; device_type?: string; hardware_id?: string; zone_id: string; group_id?: string }) {
    const device = this.repo.create({
      ...data,
      group_id: this.normalizeGroupId(data.group_id),
      device_id: generatePlayerId(),
      device_type: data.device_type || '',
      status: 'pending',
      mqtt_client_id: `dev-${randomUUID().slice(0, 8)}`,
    });
    const saved = await this.repo.save(device);

    this.appendAudit({
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
      this.appendAudit({
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
      mqtt_topic_prefix: this.buildMqttTopicPrefix(device),
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

    this.appendAudit({
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

    this.appendAudit({
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

  async assignToGroup(deviceId: string, groupId?: string) {
    const device = await this.findOne(deviceId);
    const normalizedGroupId = this.normalizeGroupId(groupId);
    await this.repo.update({ device_id: device.device_id }, { group_id: normalizedGroupId });
    const updated = await this.findOne(device.device_id);

    this.appendAudit({
      event_type: normalizedGroupId ? 'device.assigned' : 'device.unassigned',
      actor_type: 'system',
      actor_id: 'device-management',
      zone_id: updated.zone_id,
      resource_type: 'device',
      resource_id: updated.device_id,
      action: normalizedGroupId ? 'assigned' : 'unassigned',
      detail: { group_id: normalizedGroupId },
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

  private async validateRuntimeAssignment(zoneId: string, groupId?: string): Promise<'valid' | 'invalid' | 'unknown'> {
    try {
      const headers = this.internalServiceToken
        ? { 'x-internal-token': this.internalServiceToken }
        : undefined;
      const normalizedGroupId = this.normalizeGroupId(groupId);

      const zoneRes = await fetch(`${this.zonePolicyUrl}/zones/${encodeURIComponent(zoneId)}`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });

      if (zoneRes.status === 404) return 'invalid';
      if (!zoneRes.ok) return 'unknown';
      if (!normalizedGroupId) return 'valid';

      const groupsRes = await fetch(`${this.zonePolicyUrl}/zones/${encodeURIComponent(zoneId)}/groups`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });

      if (groupsRes.status === 404) return 'invalid';
      if (!groupsRes.ok) return 'unknown';

      const groups = await groupsRes.json() as Array<{ group_id?: string }>;
      if (!Array.isArray(groups)) return 'unknown';

      const hasGroup = groups.some((group) => group?.group_id === normalizedGroupId);
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
    if (device.status !== 'active' || !device.zone_id) {
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

  async unassignByGroup(groupId: string): Promise<number> {
    const normalizedGroupId = this.normalizeGroupId(groupId);
    if (!normalizedGroupId) return 0;

    const result = await this.repo.update({ group_id: normalizedGroupId }, { group_id: '' });
    return result.affected ?? 0;
  }

}
