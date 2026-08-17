import { existsSync } from "fs";
import { join } from "path";
import { readFile } from "fs/promises";

export type ProjectType = "nodejs" | "python" | "unknown";

export interface ServiceConfig {
  name: string;
  image: string;
  ports: string[];
  environment?: Record<string, string>;
  healthcheck: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

/**
 * Detect project type based on files present
 */
export async function detectProjectType(cwd: string): Promise<ProjectType> {
  if (existsSync(join(cwd, "package.json"))) {
    return "nodejs";
  }

  if (
    existsSync(join(cwd, "requirements.txt")) ||
    existsSync(join(cwd, "pyproject.toml")) ||
    existsSync(join(cwd, "setup.py"))
  ) {
    return "python";
  }

  return "unknown";
}

/**
 * Generate Dockerfile for project
 */
export async function generateDockerfile(
  projectType: ProjectType,
  cwd: string
): Promise<string> {
  if (projectType === "nodejs") {
    return await generateNodeJsDockerfile(cwd);
  }

  if (projectType === "python") {
    return await generatePythonDockerfile(cwd);
  }

  // Fallback to Node.js
  return await generateNodeJsDockerfile(cwd);
}

/**
 * Generate Node.js Dockerfile
 */
async function generateNodeJsDockerfile(cwd: string): Promise<string> {
  const hasPnpm = existsSync(join(cwd, "pnpm-lock.yaml"));
  const hasYarn = existsSync(join(cwd, "yarn.lock"));

  let installCmd = "npm ci";
  let copyLockFile = "COPY package*.json ./";

  if (hasPnpm) {
    installCmd = "corepack enable && pnpm install --frozen-lockfile";
    copyLockFile = "COPY package*.json pnpm-lock.yaml ./";
  } else if (hasYarn) {
    installCmd = "yarn install --frozen-lockfile";
    copyLockFile = "COPY package*.json yarn.lock ./";
  }

  return `FROM node:20-slim

WORKDIR /workspace

# Copy package files
${copyLockFile}

# Install dependencies
RUN ${installCmd}

# Copy source code
COPY . .

# Build if build script exists
RUN if grep -q '"build":' package.json; then npm run build || true; fi

# Default command: run tests
CMD ["npm", "test"]
`;
}

/**
 * Generate Python Dockerfile
 */
async function generatePythonDockerfile(cwd: string): Promise<string> {
  const hasRequirements = existsSync(join(cwd, "requirements.txt"));
  const hasPyproject = existsSync(join(cwd, "pyproject.toml"));

  let installCmd = "";
  let copyFiles = "";

  if (hasRequirements) {
    copyFiles = "COPY requirements*.txt ./";
    installCmd = "pip install --no-cache-dir -r requirements.txt";
  } else if (hasPyproject) {
    copyFiles = "COPY pyproject.toml setup.py* ./";
    installCmd = "pip install --no-cache-dir -e .";
  }

  return `FROM python:3.11-slim

WORKDIR /workspace

# Copy dependency files
${copyFiles}

# Install dependencies
RUN ${installCmd}

# Copy source code
COPY . .

# Default command: run tests
CMD ["pytest"]
`;
}

/**
 * Generate docker-compose.yml for services
 */
export async function generateComposeFile(
  services: string[]
): Promise<string> {
  const serviceConfigs = services.map(getServiceConfig).filter((config): config is ServiceConfig => config !== null);

  if (serviceConfigs.length === 0) {
    return "";
  }

  const servicesYaml = serviceConfigs.map(formatServiceConfig).join("\n");

  return `version: '3.8'

services:
${servicesYaml}

networks:
  default:
    name: greenbump_network
`;
}

/**
 * Get service configuration
 */
function getServiceConfig(serviceName: string): ServiceConfig | null {
  const configs: Record<string, ServiceConfig> = {
    postgres: {
      name: "postgres",
      image: "postgres:16-alpine",
      ports: ["5432:5432"],
      environment: {
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
        POSTGRES_DB: "test",
      },
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U test"],
        interval: "5s",
        timeout: "5s",
        retries: 5,
      },
    },
    mysql: {
      name: "mysql",
      image: "mysql:8",
      ports: ["3306:3306"],
      environment: {
        MYSQL_ROOT_PASSWORD: "test",
        MYSQL_DATABASE: "test",
      },
      healthcheck: {
        test: ["CMD", "mysqladmin", "ping", "-h", "localhost"],
        interval: "5s",
        timeout: "5s",
        retries: 5,
      },
    },
    redis: {
      name: "redis",
      image: "redis:7-alpine",
      ports: ["6379:6379"],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "5s",
        retries: 5,
      },
    },
    mongodb: {
      name: "mongodb",
      image: "mongo:7",
      ports: ["27017:27017"],
      environment: {
        MONGO_INITDB_ROOT_USERNAME: "test",
        MONGO_INITDB_ROOT_PASSWORD: "test",
      },
      healthcheck: {
        test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"],
        interval: "5s",
        timeout: "5s",
        retries: 5,
      },
    },
  };

  return configs[serviceName] || null;
}

/**
 * Format service config as YAML
 */
function formatServiceConfig(config: ServiceConfig): string {
  const lines = [`  ${config.name}:`];
  lines.push(`    image: ${config.image}`);

  if (config.environment) {
    lines.push("    environment:");
    for (const [key, value] of Object.entries(config.environment)) {
      lines.push(`      ${key}: ${value}`);
    }
  }

  if (config.ports.length > 0) {
    lines.push("    ports:");
    for (const port of config.ports) {
      lines.push(`      - "${port}"`);
    }
  }

  lines.push("    healthcheck:");
  lines.push(`      test: ${JSON.stringify(config.healthcheck.test)}`);
  lines.push(`      interval: ${config.healthcheck.interval}`);
  lines.push(`      timeout: ${config.healthcheck.timeout}`);
  lines.push(`      retries: ${config.healthcheck.retries}`);

  return lines.join("\n");
}

/**
 * Check if project has build script
 */
export async function hasBuildScript(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return pkg.scripts?.build !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if project has test script
 */
export async function hasTestScript(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return pkg.scripts?.test !== undefined;
  } catch {
    return false;
  }
}
