import { exec } from "../git.js";
import { existsSync } from "fs";
import { join } from "path";
import { readFile, writeFile, rm } from "fs/promises";

export interface DockerInfo {
  available: boolean;
  version?: string;
  composeAvailable: boolean;
}

export interface ContainerRunOptions {
  image: string;
  networkMode?: string;
  timeout?: number;
  workdir?: string;
  env?: Record<string, string>;
}

export interface ContainerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  buildSuccess: boolean;
  testsPassed: boolean;
}

/**
 * Check if Docker is available and running
 */
export async function checkDockerAvailable(): Promise<DockerInfo> {
  const info: DockerInfo = {
    available: false,
    composeAvailable: false,
  };

  try {
    const versionResult = await exec("docker", ["--version"], { cwd: process.cwd() });
    info.version = versionResult.stdout.trim();

    // Check if Docker daemon is running
    await exec("docker", ["ps"], { cwd: process.cwd() });
    info.available = true;

    // Check docker-compose availability
    try {
      await exec("docker-compose", ["--version"], { cwd: process.cwd() });
      info.composeAvailable = true;
    } catch {
      // docker-compose not available, but that's okay
    }
  } catch {
    // Docker not available
  }

  return info;
}

/**
 * Build Docker image from Dockerfile
 */
export async function buildDockerImage(
  cwd: string,
  imageName: string,
  dockerfilePath: string
): Promise<void> {
  console.log(`🐳 Building Docker image: ${imageName}...`);

  await exec(
    "docker",
    [
      "build",
      "-t", imageName,
      "-f", dockerfilePath,
      ".",
    ],
    { cwd }
  );
}

/**
 * Run verification in Docker container
 */
export async function runVerificationInContainer(
  cwd: string,
  options: ContainerRunOptions
): Promise<ContainerResult> {
  const args = [
    "run",
    "--rm",
    "-v", `${cwd}:/workspace`,
    "-w", "/workspace",
  ];

  // Add network mode
  if (options.networkMode) {
    args.push("--network", options.networkMode);
  }

  // Add environment variables
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(options.image);

  // Run the container with test command
  args.push("sh", "-c", "npm install && npm run build 2>&1 && npm test 2>&1");

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let buildSuccess = false;
  let testsPassed = false;

  try {
    const result = await exec("docker", args, {
      cwd,
      timeout: options.timeout || 600000, // 10 minutes default
    });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = 0;
    buildSuccess = true;
    testsPassed = true;
  } catch (error: any) {
    exitCode = error.exitCode || 1;
    stdout = error.stdout || "";
    stderr = error.stderr || "";

    // Determine what failed
    buildSuccess = !stderr.includes("npm run build") && !stdout.includes("build failed");
    testsPassed = false;
  }

  return {
    exitCode,
    stdout,
    stderr,
    buildSuccess,
    testsPassed,
  };
}

/**
 * Start docker-compose services
 */
export async function startComposeServices(
  cwd: string,
  composeFile: string
): Promise<string> {
  console.log("🚀 Starting docker-compose services...");

  const projectName = `greenbump-${Date.now()}`;

  await exec(
    "docker-compose",
    [
      "-f", composeFile,
      "-p", projectName,
      "up", "-d",
    ],
    { cwd }
  );

  return projectName;
}

/**
 * Check if a service is healthy
 */
export async function checkServiceHealth(
  projectName: string,
  serviceName: string
): Promise<boolean> {
  try {
    const result = await exec(
      "docker-compose",
      ["-p", projectName, "ps", "--filter", `name=${serviceName}`, "--format", "json"],
      { cwd: process.cwd() }
    );

    const output = result.stdout.trim();
    if (!output) return false;

    // Check if service is running
    return output.includes('"State":"running"') || output.includes('healthy');
  } catch {
    return false;
  }
}

/**
 * Wait for services to become healthy
 */
export async function waitForServices(
  projectName: string,
  services: string[],
  timeout: number = 60
): Promise<void> {
  console.log("⏳ Waiting for services to become healthy...");

  const deadline = Date.now() + timeout * 1000;
  const healthyServices = new Set<string>();

  while (Date.now() < deadline && healthyServices.size < services.length) {
    for (const service of services) {
      if (healthyServices.has(service)) continue;

      const healthy = await checkServiceHealth(projectName, service);
      if (healthy) {
        console.log(`✓ ${service} is healthy`);
        healthyServices.add(service);
      }
    }

    if (healthyServices.size < services.length) {
      await sleep(2000); // Wait 2 seconds before checking again
    }
  }

  if (healthyServices.size < services.length) {
    const unhealthy = services.filter(s => !healthyServices.has(s));
    throw new Error(`Timeout waiting for services to become healthy: ${unhealthy.join(", ")}`);
  }
}

/**
 * Stop and remove docker-compose services
 */
export async function stopComposeServices(
  cwd: string,
  composeFile: string,
  projectName: string
): Promise<void> {
  console.log("🛑 Stopping docker-compose services...");

  try {
    await exec(
      "docker-compose",
      [
        "-f", composeFile,
        "-p", projectName,
        "down", "-v",
      ],
      { cwd }
    );
  } catch (error) {
    console.warn("Warning: Failed to stop compose services:", error);
  }
}

/**
 * Remove Docker image
 */
export async function removeDockerImage(imageName: string): Promise<void> {
  try {
    await exec("docker", ["rmi", imageName], { cwd: process.cwd() });
  } catch {
    // Ignore errors when removing image
  }
}

/**
 * Cleanup Docker resources
 */
export async function cleanupDocker(
  cwd: string,
  imageName: string,
  composeFile?: string,
  projectName?: string
): Promise<void> {
  console.log("🧹 Cleaning up Docker resources...");

  // Stop compose services
  if (composeFile && projectName) {
    await stopComposeServices(cwd, composeFile, projectName);
  }

  // Remove image
  await removeDockerImage(imageName);

  // Remove temporary files
  const tempFiles = [
    join(cwd, ".greenbump-Dockerfile"),
    join(cwd, ".greenbump-compose.yml"),
  ];

  for (const file of tempFiles) {
    try {
      if (existsSync(file)) {
        await rm(file);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Utility: sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
