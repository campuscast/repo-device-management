import { BadRequestException } from '@nestjs/common';
import { DevicesService } from './devices.service';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('DevicesService preview support', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111';
  let deviceRepo: MockRepo;
  let credentialRepo: MockRepo;
  let previewRepo: MockRepo;
  let service: DevicesService;

  beforeEach(() => {
    deviceRepo = makeRepo();
    credentialRepo = makeRepo();
    previewRepo = makeRepo();
    service = new DevicesService(deviceRepo as any, credentialRepo as any, previewRepo as any);
  });

  it('returns placeholder preview payload when no snapshot exists', async () => {
    deviceRepo.findOne.mockResolvedValue({
      device_id: deviceId,
      device_name: 'Lobby TV',
      zone_id: 'zone-1',
      group_id: 'group-1',
    });
    previewRepo.findOne.mockResolvedValue(null);

    const result = await service.getDevicePreview(deviceId);

    expect(result.preview_available).toBe(false);
    expect(result.device_name).toBe('Lobby TV');
    expect(result.request_id).toBeNull();
    expect(result.display_id).toBeNull();
  });

  it('creates new preview snapshot on first upload', async () => {
    const nowIso = '2026-03-20T12:00:00.000Z';
    deviceRepo.findOne.mockResolvedValue({
      device_id: deviceId,
      device_name: 'Lobby TV',
      zone_id: 'zone-1',
      group_id: 'group-1',
    });
    previewRepo.findOne.mockResolvedValue(null);
    previewRepo.create.mockImplementation((payload: Record<string, unknown>) => payload);
    previewRepo.save.mockResolvedValue({
      preview_id: 'preview-1',
      device_id: deviceId,
      updated_at: new Date(nowIso),
    });

    const result = await service.upsertDevicePreview(deviceId, {
      image_base64: 'data:image/png;base64,abc',
      mime_type: 'image/png',
      captured_at: nowIso,
      width: 640,
      height: 360,
    });

    expect(previewRepo.create).toHaveBeenCalledTimes(1);
    expect(previewRepo.save).toHaveBeenCalledTimes(1);
    expect(result.device_id).toBe(deviceId);
  });

  it('clears pending screenshot request after matching preview upload', async () => {
    const nowIso = '2026-03-20T12:00:00.000Z';
    deviceRepo.findOne.mockResolvedValue({
      device_id: deviceId,
      device_name: 'Lobby TV',
      zone_id: 'zone-1',
      group_id: 'group-1',
      display_metadata: [{ id: 'display-1', label: 'Lobby screen', width: 1920, height: 1080, selected: true }],
      selected_display_ids: ['display-1'],
      pending_screenshot_request_id: 'request-1',
      pending_screenshot_display_id: 'display-1',
      pending_screenshot_requested_at: new Date(nowIso),
    });
    previewRepo.findOne.mockResolvedValue(null);
    previewRepo.create.mockImplementation((payload: Record<string, unknown>) => payload);
    previewRepo.save.mockResolvedValue({
      preview_id: 'preview-1',
      device_id: deviceId,
      updated_at: new Date(nowIso),
    });
    deviceRepo.update.mockResolvedValue({ affected: 1 });

    await service.upsertDevicePreview(deviceId, {
      captured_at: nowIso,
      status: 'ok',
      request_id: 'request-1',
      display_id: 'display-1',
    });

    expect(deviceRepo.update).toHaveBeenCalledWith(
      { device_id: deviceId },
      {
        pending_screenshot_request_id: null,
        pending_screenshot_display_id: null,
        pending_screenshot_requested_at: null,
      },
    );
  });

  it('rejects invalid captured_at value', async () => {
    deviceRepo.findOne.mockResolvedValue({
      device_id: deviceId,
      device_name: 'Lobby TV',
      zone_id: 'zone-1',
      group_id: 'group-1',
    });
    previewRepo.findOne.mockResolvedValue(null);

    await expect(
      service.upsertDevicePreview(deviceId, {
        captured_at: 'invalid-date',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
