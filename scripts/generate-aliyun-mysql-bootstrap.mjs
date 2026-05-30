import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_BLOCKED_DATABASES = ['gohomesh', 'mediverseai', 'maxfuture'];
const DEFAULT_DATABASE = 'medical_credit_assessment';
const DEFAULT_USER = 'medical_credit_app';
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

export function evaluateMysqlBootstrapConfig({
  database = DEFAULT_DATABASE,
  user = DEFAULT_USER,
  userHost = '',
  password = '',
  blockedDatabases = DEFAULT_BLOCKED_DATABASES,
  templateOnly = false
} = {}) {
  const blockers = [];
  const warnings = [];
  const normalizedDatabase = normalizeIdentifier(database);
  const normalizedUser = normalizeIdentifier(user);
  const normalizedUserHost = String(userHost || '').trim();
  const normalizedPassword = String(password || '');
  const blocked = new Set(blockedDatabases.map((item) => String(item).trim().toLowerCase()).filter(Boolean));

  if (!normalizedDatabase) blockers.push('Database name is required.');
  else if (!IDENTIFIER_PATTERN.test(normalizedDatabase)) blockers.push(`Database name must contain only letters, numbers, and underscores: ${normalizedDatabase}`);
  if (!normalizedUser) blockers.push('Database user is required.');
  else if (!IDENTIFIER_PATTERN.test(normalizedUser)) blockers.push(`Database user must contain only letters, numbers, and underscores: ${normalizedUser}`);

  if (blocked.has(normalizedDatabase.toLowerCase())) {
    blockers.push(`Refusing to bootstrap existing business database: ${normalizedDatabase}`);
  }
  if (!normalizedDatabase.startsWith('medical_credit')) {
    warnings.push('Database name does not start with medical_credit; confirm it is dedicated to this project.');
  }
  if (!normalizedUser.startsWith('medical_credit')) {
    warnings.push('Database user does not start with medical_credit; confirm it is dedicated to this project.');
  }

  if (!templateOnly && !normalizedUserHost) {
    blockers.push('MySQL user host is required. For Docker + local MySQL, prefer host.docker.internal plus a reviewed MySQL user host policy.');
  }
  if (!templateOnly && !normalizedPassword) {
    blockers.push('MySQL password is required for executable bootstrap SQL.');
  }
  if (normalizedUserHost === 'localhost' || normalizedUserHost === '127.0.0.1') {
    warnings.push('A localhost MySQL user host will not work for Docker containers; use a reviewed Docker bridge host or RDS policy.');
  }
  if (normalizedUserHost === '%') {
    warnings.push('MySQL user host % is broad; prefer a tighter RDS/VPC/Docker bridge host when IT can provide one.');
  }

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    ok: decision === 'go',
    decision,
    database: normalizedDatabase,
    user: normalizedUser,
    userHost: normalizedUserHost || '<mysql-user-host>',
    passwordConfigured: Boolean(normalizedPassword),
    blockers,
    warnings
  };
}

export function renderMysqlBootstrapSql({
  database = DEFAULT_DATABASE,
  user = DEFAULT_USER,
  userHost = '<mysql-user-host>',
  password = '<mysql-password>',
  resetExistingUserPassword = false,
  generatedAt = new Date().toISOString()
} = {}) {
  const normalizedDatabase = normalizeIdentifier(database);
  const normalizedUser = normalizeIdentifier(user);
  if (!IDENTIFIER_PATTERN.test(normalizedDatabase)) throw new Error(`Invalid database identifier: ${database}`);
  if (!IDENTIFIER_PATTERN.test(normalizedUser)) throw new Error(`Invalid user identifier: ${user}`);
  const safeHost = escapeSqlString(userHost);
  const safePassword = escapeSqlString(password);
  const resetLine = resetExistingUserPassword
    ? `alter user '${normalizedUser}'@'${safeHost}' identified by '${safePassword}';`
    : `-- If this dedicated user already exists and IT wants to rotate its password, run:\n-- alter user '${normalizedUser}'@'${safeHost}' identified by '<new-password>';`;

  return [
    '-- PR23 medical-credit-assessment MySQL bootstrap SQL',
    `-- Generated at: ${generatedAt}`,
    '-- Scope: create one dedicated database and one dedicated least-privilege application user.',
    '-- Review before execution. Do not run against existing business databases.',
    '',
    `create database if not exists \`${normalizedDatabase}\``,
    '  character set utf8mb4',
    '  collate utf8mb4_unicode_ci;',
    '',
    `create user if not exists '${normalizedUser}'@'${safeHost}' identified by '${safePassword}';`,
    resetLine,
    '',
    `grant select, insert, update, delete, create, alter, index, references`,
    `  on \`${normalizedDatabase}\`.* to '${normalizedUser}'@'${safeHost}';`,
    '',
    'flush privileges;',
    ''
  ].join('\n');
}

export async function runMysqlBootstrapGenerator({
  outputFile,
  stdoutAllowed = false,
  writeFileImpl = writeFile,
  options = {}
} = {}) {
  const report = evaluateMysqlBootstrapConfig(options);
  if (report.decision === 'blocked') return { report, sql: '' };
  const sql = renderMysqlBootstrapSql(options);
  const containsRealPassword = options.password && !String(options.password).includes('<');

  if (!outputFile && containsRealPassword && !stdoutAllowed) {
    return {
      report: {
        ...report,
        ok: false,
        decision: 'blocked',
        blockers: [
          ...report.blockers,
          'Refusing to print executable SQL with a real password to stdout. Set ALIYUN_MYSQL_BOOTSTRAP_OUTPUT_FILE.'
        ]
      },
      sql: ''
    };
  }

  if (outputFile) {
    await writeFileImpl(outputFile, sql, { mode: 0o600 });
  }
  return { report, sql: outputFile ? '' : sql };
}

export function buildMysqlBootstrapOptionsFromEnv(env = process.env) {
  return {
    database: env.ALIYUN_MYSQL_BOOTSTRAP_DATABASE || env.ALIYUN_MYSQL_DATABASE || DEFAULT_DATABASE,
    user: env.ALIYUN_MYSQL_BOOTSTRAP_USER || env.ALIYUN_MYSQL_USER || DEFAULT_USER,
    userHost: env.ALIYUN_MYSQL_BOOTSTRAP_USER_HOST || '',
    password: env.ALIYUN_MYSQL_BOOTSTRAP_PASSWORD || env.ALIYUN_MYSQL_PASSWORD || '',
    blockedDatabases: splitCsv(env.ALIYUN_MYSQL_BOOTSTRAP_BLOCKED_DATABASES || DEFAULT_BLOCKED_DATABASES.join(',')),
    templateOnly: env.ALIYUN_MYSQL_BOOTSTRAP_TEMPLATE_ONLY === 'yes',
    resetExistingUserPassword: env.ALIYUN_MYSQL_BOOTSTRAP_RESET_USER_PASSWORD === 'yes'
  };
}

function normalizeIdentifier(value) {
  return String(value || '').trim();
}

function escapeSqlString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function splitCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const outputFile = process.env.ALIYUN_MYSQL_BOOTSTRAP_OUTPUT_FILE || '';
  const options = buildMysqlBootstrapOptionsFromEnv(process.env);
  const result = await runMysqlBootstrapGenerator({
    outputFile,
    stdoutAllowed: process.env.ALIYUN_MYSQL_BOOTSTRAP_ALLOW_STDOUT === 'yes',
    options
  });

  if (result.sql) {
    process.stdout.write(result.sql);
  }
  console.log(JSON.stringify({
    ...result.report,
    outputFile: outputFile || '',
    passwordPrinted: false
  }, null, 2));
  if (result.report.decision === 'blocked') process.exit(1);
}
