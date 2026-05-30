import { describe, expect, it, vi } from 'vitest';
import {
  buildMysqlBootstrapOptionsFromEnv,
  evaluateMysqlBootstrapConfig,
  renderMysqlBootstrapSql,
  runMysqlBootstrapGenerator
} from './generate-aliyun-mysql-bootstrap.mjs';

describe('Aliyun MySQL bootstrap generator', () => {
  it('renders dedicated database and least-privilege user SQL', () => {
    const sql = renderMysqlBootstrapSql({
      database: 'medical_credit_assessment',
      user: 'medical_credit_app',
      userHost: 'host.docker.internal',
      password: "pa'ss\\word",
      generatedAt: '2026-05-30T00:00:00.000Z'
    });

    expect(sql).toContain('create database if not exists `medical_credit_assessment`');
    expect(sql).toContain("create user if not exists 'medical_credit_app'@'host.docker.internal'");
    expect(sql).toContain("identified by 'pa''ss\\\\word'");
    expect(sql).toContain('grant select, insert, update, delete, create, alter, index, references');
    expect(sql).not.toContain('drop database');
  });

  it('blocks existing business databases', () => {
    const report = evaluateMysqlBootstrapConfig({
      database: 'mediverseai',
      user: 'medical_credit_app',
      userHost: 'host.docker.internal',
      password: 'secret'
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers).toContain('Refusing to bootstrap existing business database: mediverseai');
  });

  it('rejects unsafe identifiers', () => {
    expect(() => renderMysqlBootstrapSql({
      database: 'medical-credit',
      user: 'medical_credit_app'
    })).toThrow('Invalid database identifier');
  });

  it('requires an explicit user host and password for executable SQL', () => {
    const report = evaluateMysqlBootstrapConfig({
      database: 'medical_credit_assessment',
      user: 'medical_credit_app'
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers.join('\n')).toContain('MySQL user host is required');
    expect(report.blockers.join('\n')).toContain('MySQL password is required');
  });

  it('allows template mode without real host and password', () => {
    const report = evaluateMysqlBootstrapConfig({
      database: 'medical_credit_assessment',
      user: 'medical_credit_app',
      templateOnly: true
    });

    expect(report.decision).toBe('go');
    expect(report.userHost).toBe('<mysql-user-host>');
  });

  it('refuses to print real-password SQL to stdout by default', async () => {
    const result = await runMysqlBootstrapGenerator({
      options: {
        database: 'medical_credit_assessment',
        user: 'medical_credit_app',
        userHost: 'host.docker.internal',
        password: 'secret'
      }
    });

    expect(result.report.decision).toBe('blocked');
    expect(result.report.blockers.join('\n')).toContain('Refusing to print executable SQL with a real password');
    expect(result.sql).toBe('');
  });

  it('writes executable SQL to a protected output file', async () => {
    const writeFileImpl = vi.fn();
    const result = await runMysqlBootstrapGenerator({
      outputFile: '/tmp/mysql-bootstrap.sql',
      writeFileImpl,
      options: {
        database: 'medical_credit_assessment',
        user: 'medical_credit_app',
        userHost: 'host.docker.internal',
        password: 'secret'
      }
    });

    expect(result.report.decision).toBe('go');
    expect(result.sql).toBe('');
    expect(writeFileImpl).toHaveBeenCalledWith(
      '/tmp/mysql-bootstrap.sql',
      expect.stringContaining('medical_credit_assessment'),
      { mode: 0o600 }
    );
  });

  it('maps environment variables into bootstrap options', () => {
    const options = buildMysqlBootstrapOptionsFromEnv({
      ALIYUN_MYSQL_DATABASE: 'medical_credit_assessment',
      ALIYUN_MYSQL_USER: 'medical_credit_app',
      ALIYUN_MYSQL_BOOTSTRAP_USER_HOST: '172.17.0.%',
      ALIYUN_MYSQL_PASSWORD: 'secret',
      ALIYUN_MYSQL_BOOTSTRAP_TEMPLATE_ONLY: 'yes',
      ALIYUN_MYSQL_BOOTSTRAP_RESET_USER_PASSWORD: 'yes'
    });

    expect(options).toMatchObject({
      database: 'medical_credit_assessment',
      user: 'medical_credit_app',
      userHost: '172.17.0.%',
      password: 'secret',
      templateOnly: true,
      resetExistingUserPassword: true
    });
  });
});
