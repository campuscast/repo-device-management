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

  it('deleteByGroup removes all devices and credentials in a group', async () => {
    deviceRepo.find.mockResolvedValue([{ device_id: 'd1' }]);
    credentialRepo.delete.mockResolvedValue({ affected: 1 });
    deviceRepo.delete.mockResolvedValue({ affected: 1 });

    const removed = await service.deleteByGroup('group-1');

    expect(removed).toBe(1);
    expect(deviceRepo.find).toHaveBeenCalledWith({
      select: ['device_id'],
      where: { group_id: 'group-1' },
    });
    expect(credentialRepo.delete).toHaveBeenCalledTimes(1);
    expect(deviceRepo.delete).toHaveBeenCalledTimes(1);
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
});
