import { existsSync } from "fs";
import { join } from "path";
import { readFile } from "fs/promises";

/**
 * Detect required database/cache services for the project
 */
export async function detectRequiredServices(cwd: string): Promise<string[]> {
  const services = new Set<string>();

  // Check package.json dependencies
  await detectFromPackageJson(cwd, services);

  // Check docker-compose files
  await detectFromDockerCompose(cwd, services);

  // Check environment files
  await detectFromEnvFiles(cwd, services);

  return Array.from(services);
}

/**
 * Detect services from package.json dependencies
 */
async function detectFromPackageJson(
  cwd: string,
  services: Set<string>
): Promise<void> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return;

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // PostgreSQL
    if (allDeps.pg || allDeps["pg-promise"] || allDeps.postgres || allDeps.sequelize) {
      services.add("postgres");
    }

    // MySQL
    if (allDeps.mysql || allDeps.mysql2) {
      services.add("mysql");
    }

    // Redis
    if (allDeps.redis || allDeps.ioredis) {
      services.add("redis");
    }

    // MongoDB
    if (allDeps.mongodb || allDeps.mongoose) {
      services.add("mongodb");
    }
  } catch {
    // Ignore errors reading package.json
  }
}

/**
 * Detect services from docker-compose files
 */
async function detectFromDockerCompose(
  cwd: string,
  services: Set<string>
): Promise<void> {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "docker-compose.test.yml",
    "docker-compose.test.yaml",
  ];

  for (const file of composeFiles) {
    const composePath = join(cwd, file);
    if (!existsSync(composePath)) continue;

    try {
      const content = await readFile(composePath, "utf-8");

      // Simple text search for service images
      if (/image:\s*postgres/i.test(content)) {
        services.add("postgres");
      }
      if (/image:\s*mysql/i.test(content)) {
        services.add("mysql");
      }
      if (/image:\s*redis/i.test(content)) {
        services.add("redis");
      }
      if (/image:\s*mongo/i.test(content)) {
        services.add("mongodb");
      }
    } catch {
      // Ignore errors reading compose files
    }
  }
}

/**
 * Detect services from .env files
 */
async function detectFromEnvFiles(
  cwd: string,
  services: Set<string>
): Promise<void> {
  const envFiles = [
    ".env",
    ".env.test",
    ".env.local",
    ".env.development",
  ];

  for (const file of envFiles) {
    const envPath = join(cwd, file);
    if (!existsSync(envPath)) continue;

    try {
      const content = await readFile(envPath, "utf-8");

      // Check for database connection strings
      if (/postgres:\/\//i.test(content) || /postgresql:\/\//i.test(content)) {
        services.add("postgres");
      }
      if (/mysql:\/\//i.test(content)) {
        services.add("mysql");
      }
      if (/redis:\/\//i.test(content)) {
        services.add("redis");
      }
      if (/mongodb:\/\//i.test(content)) {
        services.add("mongodb");
      }

      // Check for database host environment variables
      if (/POSTGRES_HOST|PGHOST|DATABASE_URL.*postgres/i.test(content)) {
        services.add("postgres");
      }
      if (/MYSQL_HOST|DATABASE_URL.*mysql/i.test(content)) {
        services.add("mysql");
      }
      if (/REDIS_HOST|REDIS_URL/i.test(content)) {
        services.add("redis");
      }
      if (/MONGO_HOST|MONGODB_URL|MONGO_URL/i.test(content)) {
        services.add("mongodb");
      }
    } catch {
      // Ignore errors reading env files
    }
  }
}

/**
 * Get display name for service
 */
export function getServiceDisplayName(service: string): string {
  const names: Record<string, string> = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    redis: "Redis",
    mongodb: "MongoDB",
  };

  return names[service] || service;
}
