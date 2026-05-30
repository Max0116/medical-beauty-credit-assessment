import { describe, expect, it } from 'vitest';
import { DATABASE_DRIVERS, resolveDatabaseDriver } from './databaseFactory.js';

describe('database factory', () => {
  it('keeps PostgreSQL as the default migration target', () => {
    expect(resolveDatabaseDriver('')).toBe(DATABASE_DRIVERS.postgres);
    expect(resolveDatabaseDriver('postgres')).toBe(DATABASE_DRIVERS.postgres);
  });

  it('accepts MySQL-compatible Aliyun RDS as an explicit target', () => {
    expect(resolveDatabaseDriver('mysql')).toBe(DATABASE_DRIVERS.mysql);
    expect(resolveDatabaseDriver('mariadb')).toBe(DATABASE_DRIVERS.mysql);
    expect(resolveDatabaseDriver('MYSQL')).toBe(DATABASE_DRIVERS.mysql);
  });
});
