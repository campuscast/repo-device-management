import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import type { Device } from './device.entity';

type MockRepo<T> = {
  find: jest.Mock;
  findOne: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('DevicesService', () => {
  const originalFetch = global.fetch;
  const deviceId = '11111111-1111-4111-8111-111111111111';

  let deviceRepo: MockRepo<Device>;
  let credentialRepo: MockRepo<any>;
  let previewRepo: MockRepo<any>;
  let service: DevicesService;

  beforeEach(() => {
    deviceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    credentialRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    previewRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    service = new DevicesService(deviceRepo as any, credentialRepo as any, previewRepo as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('findByZone marks stale runtime telemetry as offline', async () => {
    const now = new Date('2026-03-30T17:30:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    deviceRepo.find.mockResolvedValue([
      {
        device_id: deviceId,
        device_name: 'Lobby',
        zone_id: 'zone-1',
        status: 'active',
        online: true,
        last_telemetry_at: new Date('2026-03-30T17:29:20.000Z'),
      },
      {
        device_id: '22222222-2222-4222-8222-222222222222',
        device_name: 'Wall',
        zone_id: 'zone-1',
        status: 'active',
        online: true,
        last_telemetry_at: new Date('2026-03-30T17:28:50.000Z'),
      },
    ]);

    const devices = await service.findByZone('zone-1');

    expect(deviceRepo.find).toHaveBeenCalledWith({ where: { zone_id: 'zone-1' } });
    expect(devices).toEqual([
      expect.objectContaining({ device_id: deviceId, online: true }),
      expect.objectContaining({ device_id: '22222222-2222-4222-8222-222222222222', online: false }),
    ]);
    dateNowSpy.mockRestore();
  });

  it('getDeviceRuntimeSnapshot reports offline when telemetry is stale', async () => {
    const now = new Date('2026-03-30T17:30:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    deviceRepo.findOne.mockResolvedValue({
      device_id: deviceId,
      device_name: 'Lobby',
      zone_id: 'zone-1',
      group_id: '',
      status: 'active',
      online: true,
      last_telemetry_at: new Date('2026-03-30T17:28:30.000Z'),
      selected_display_ids: [],
      display_metadata: [],
    });

    const snapshot = await service.getDeviceRuntimeSnapshot(deviceId);

    expect(snapshot.online).toBe(false);
    expect(snapshot.last_telemetry_at).toBe('2026-03-30T17:28:30.000Z');
    dateNowSpy.mockRestore();
  });

  it('deleteByZone removes all devices and credentials in a zone', async () => {
    deviceRepo.find.mockResolvedValue([{ device_id: 'd1' }, { device_id: 'd2' }]);
    credentialRepo.delete.mockResolvedValue({ affected: 2 });
    deviceRepo.delete.mockResolvedValue({ affected: 2 });

    const removed = await service.deleteByZone('zone-1');

    expect(removed).toBe(2);
    expect(deviceRepo.find).toHaveBeenCalledWith({
      select: ['device_id'],
      where: { zone_id: 'zone-1' },
    });
    expect(credentialRepo.delete).toHaveBeenCalledTimes(1);
    expect(deviceRepo.delete).toHaveBeenCalledTimes(1);
  });

  it('unassignByGroup clears group membership without deleting devices', async () => {
    deviceRepo.update.mockResolvedValue({ affected: 1 });

    const updated = await service.unassignByGroup('group-1');

    expect(updated).toBe(1);
    expect(deviceRepo.update).toHaveBeenCalledWith({ group_id: 'group-1' }, { group_id: '' });
    expect(credentialRepo.delete).not.toHaveBeenCalled();
    expect(deviceRepo.delete).not.toHaveBeenCalled();
  });

  it('getRuntimeDevice rejects invalid assignment when group is missing', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: 'group-1',
      status: 'active',
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { zone_id: 'zone-1' }))
      .mockResolvedValueOnce(makeResponse(200, []));

    await expect(service.getRuntimeDevice(deviceId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getRuntimeDevice rejects when assignment validation is unavailable', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: 'group-1',
      status: 'active',
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(service.getRuntimeDevice(deviceId)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('getRuntimeDevice accepts active device with valid zone/group assignment', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: 'group-1',
      status: 'active',
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { zone_id: 'zone-1' }))
      .mockResolvedValueOnce(makeResponse(200, [{ group_id: 'group-1' }]));

    await expect(service.getRuntimeDevice(deviceId)).resolves.toEqual(activeDevice);
  });

  it('getRuntimeDevice accepts active device without group when zone exists', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: '',
      status: 'active',
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { zone_id: 'zone-1' }));

    await expect(service.getRuntimeDevice(deviceId)).resolves.toEqual(activeDevice);
  });

  it('stores runtime telemetry with display metadata and pending screenshot response', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: '',
      status: 'active',
      pending_screenshot_request_id: 'request-1',
      pending_screenshot_display_id: 'display-1',
      pending_screenshot_requested_at: new Date('2026-03-20T12:00:00.000Z'),
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    deviceRepo.save.mockImplementation(async (payload: Record<string, unknown>) => payload);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { zone_id: 'zone-1' }));

    const result = await service.updateRuntimeTelemetry(deviceId, {
      current_release_id: 'release-1',
      current_slot_id: 'slot-1',
      current_publication_id: 'publication-1',
      current_publication_title: 'Lobby playlist',
      playback_status: 'playing',
      displays: [{ id: 'display-1', label: 'Lobby screen', width: 1920, height: 1080 }],
      selected_displays: ['display-1'],
      timestamp: '2026-03-20T12:01:00.000Z',
      online: true,
      backend_status: 'connected',
      mqtt_status: 'connected',
    });

    expect(deviceRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      current_release_id: 'release-1',
      current_slot_id: 'slot-1',
      current_publication_id: 'publication-1',
      current_publication_title: 'Lobby playlist',
      playback_status: 'playing',
      backend_status: 'connected',
      mqtt_status: 'connected',
      selected_display_ids: ['display-1'],
      display_metadata: [
        { id: 'display-1', label: 'Lobby screen', width: 1920, height: 1080, selected: true },
      ],
    }));
    expect(result.screenshot_request).toEqual({
      request_id: 'request-1',
      display_id: 'display-1',
      requested_at: '2026-03-20T12:00:00.000Z',
    });
  });

  it('creates screenshot request for selected runtime display', async () => {
    const activeDevice = {
      device_id: deviceId,
      zone_id: 'zone-1',
      group_id: '',
      status: 'active',
      display_metadata: [
        { id: 'display-1', label: 'Lobby screen', width: 1920, height: 1080, selected: true },
        { id: 'display-2', label: 'Wall', width: 1280, height: 720, selected: false },
      ],
      selected_display_ids: ['display-1'],
    };
    deviceRepo.findOne.mockResolvedValue(activeDevice);
    deviceRepo.update.mockResolvedValue({ affected: 1 });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { zone_id: 'zone-1' }));

    const result = await service.requestScreenshot(deviceId, 'display-2');

    expect(deviceRepo.update).toHaveBeenCalledWith(
      { device_id: deviceId },
      expect.objectContaining({
        pending_screenshot_display_id: 'display-2',
      }),
    );
    expect(result.device_id).toBe(deviceId);
    expect(result.display_id).toBe('display-2');
    expect(result.request_id).toBeTruthy();
  });
});
