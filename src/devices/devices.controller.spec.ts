import { DevicesController } from './devices.controller';

describe('DevicesController', () => {
  const service = {
    unassignByGroup: jest.fn(),
    deleteByZone: jest.fn(),
  };
  const controller = new DevicesController(service as any);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('syncGroup unassigns devices when group is deleted', async () => {
    service.unassignByGroup.mockResolvedValue(3);

    const result = await controller.syncGroup({
      zone_id: 'zone-1',
      group_id: 'group-1',
      action: 'deleted',
    });

    expect(result).toEqual({ synced: true });
    expect(service.unassignByGroup).toHaveBeenCalledWith('group-1');
  });

  it('syncZone deletes devices when zone is deleted', async () => {
    service.deleteByZone.mockResolvedValue(5);

    const result = await controller.syncZone({
      zone_id: 'zone-1',
      action: 'deleted',
    });

    expect(result).toEqual({ synced: true });
    expect(service.deleteByZone).toHaveBeenCalledWith('zone-1');
  });
});
