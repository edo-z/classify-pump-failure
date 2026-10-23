export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolLimit: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryBufferMax: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value.trim(), 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

export function loadDbConfig(): DbConfig {
  return {
    host: requireEnv("DB_HOST"),
    port: parseIntEnv("DB_PORT", 3306),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    database: requireEnv("DB_NAME"),
    poolLimit: parseIntEnv("DB_POOL_LIMIT", 10),
    retryBaseMs: parseIntEnv("REALTIME_RETRY_BASE_MS", 1000),
    retryMaxMs: parseIntEnv("REALTIME_RETRY_MAX_MS", 30000),
    retryBufferMax: parseIntEnv("REALTIME_RETRY_BUFFER_MAX", 2048),
  };
}

export function loadTestDbConfig(): DbConfig {
  const dbName = requireEnv("TEST_DB_NAME");
  if (!dbName.endsWith("_test")) {
    throw new Error(`TEST_DB_NAME must end with "_test", got: ${dbName}`);
  }
  return {
    host: requireEnv("TEST_DB_HOST"),
    port: parseIntEnv("TEST_DB_PORT", 3306),
    user: requireEnv("TEST_DB_USER"),
    password: requireEnv("TEST_DB_PASSWORD"),
    database: dbName,
    poolLimit: parseIntEnv("DB_POOL_LIMIT", 10),
    retryBaseMs: parseIntEnv("REALTIME_RETRY_BASE_MS", 1000),
    retryMaxMs: parseIntEnv("REALTIME_RETRY_MAX_MS", 30000),
    retryBufferMax: parseIntEnv("REALTIME_RETRY_BUFFER_MAX", 2048),
  };
}