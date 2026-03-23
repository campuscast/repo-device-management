import { DataSource } from 'typeorm';
import { Device } from './src/devices/device.entity';
import { DeviceCredential } from './src/devices/device-credential.entity';
import { DevicePreview } from './src/devices/device-preview.entity';
import { ActivationCode } from './src/enrollment/activation-code.entity';
import { Init1700000000000 } from './src/migrations/1700000000000-Init';
import { DevicePreviews1700000000001 } from './src/migrations/1700000000001-DevicePreviews';

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://campuscast:campuscast@localhost:5432/device_db',
  entities: [Device, DeviceCredential, DevicePreview, ActivationCode],
  migrations: [Init1700000000000, DevicePreviews1700000000001],
});
