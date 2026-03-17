import { DataSource } from 'typeorm';
import { Device } from './src/devices/device.entity';
import { DeviceCredential } from './src/devices/device-credential.entity';
import { ActivationCode } from './src/enrollment/activation-code.entity';
import { Init1700000000000 } from './src/migrations/1700000000000-Init';

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://campuscast:campuscast@localhost:5432/device_db',
  entities: [Device, DeviceCredential, ActivationCode],
  migrations: [Init1700000000000],
});
