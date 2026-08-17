import { join } from "path";
import { writeFile } from "fs/promises";
import {
  checkDockerAvailable,
  buildDockerImage,
  runVerificationInContainer,
  startComposeServices,
  waitForServices,
  cleanupDocker,
  ContainerResult,
} from "./docker-manager.js";
import {
  detectProjectType,
  generateDockerfile,
  generateComposeFile,
} from "./template-generator.js";
import {
  detectRequiredServices,
  getServiceDisplayName,
} from "./service-detector.js";

export interface SandboxOptions {
  enabled: boolean;
  services?: string[];
  keepContainer?: boolean;
  dockerImage?: string;
  timeout?: number;
}

export interface ServiceHealth {
  name: string;
  healthy: boolean;
  displayName: string;
}

export interface SandboxResult {
  passed: boolean;
  buildSuccess: boolean;
  testsPassed: boolean;
  services: ServiceHealth[];
  logs: string;
  exitCode: number;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Run verification in isolated Docker sandbox
 */
export async function runInSandbox(
  cwd: string,
  options: SandboxOptions
): Promise<SandboxResult> {
  // Check if Docker is available
  const dockerInfo = await checkDockerAvailable();

  if (!dockerInfo.available) {
    console.warn("⚠️  Docker not available, skipping sandbox verification");
    console.warn("   Install Docker for isolated testing: https://docs.docker.com/get-docker/");

    return {
      passed: false,
      buildSuccess: false,
      testsPassed: false,
      services: [],
      logs: "",
      exitCode: -1,
      skipped: true,
      skipReason: "docker_unavailable",
    };
  }

  console.log("🐳 Starting sandbox environment...");
  console.log(`   Docker version: ${dockerInfo.version}`);

  // Detect project type
  const projectType = await detectProjectType(cwd);
  console.log(`   Project type: ${projectType}`);

  // Detect or use specified services
  const services = options.services || await detectRequiredServices(cwd);

  if (services.length > 0) {
    console.log(`   Required services: ${services.map(getServiceDisplayName).join(", ")}`);
  }

  const imageName = options.dockerImage || "greenbump-verify";
  const dockerfilePath = join(cwd, ".greenbump-Dockerfile");
  const composeFilePath = join(cwd, ".greenbump-compose.yml");

  let projectName: string | undefined;
  const serviceHealths: ServiceHealth[] = [];

  try {
    // Generate Dockerfile
    const dockerfile = await generateDockerfile(projectType, cwd);
    await writeFile(dockerfilePath, dockerfile);

    // Generate docker-compose.yml if services needed
    let composeFile = "";
    if (services.length > 0) {
      composeFile = await generateComposeFile(services);
      if (composeFile) {
        await writeFile(composeFilePath, composeFile);
      }
    }

    // Build Docker image
    await buildDockerImage(cwd, imageName, dockerfilePath);

    // Start services if needed
    if (services.length > 0 && composeFile && dockerInfo.composeAvailable) {
      projectName = await startComposeServices(cwd, composeFilePath);

      // Wait for services to be healthy
      await waitForServices(projectName, services, options.timeout ? options.timeout / 1000 : 60);

      // Record service health
      for (const service of services) {
        serviceHealths.push({
          name: service,
          healthy: true,
          displayName: getServiceDisplayName(service),
        });
      }
    } else if (services.length > 0 && !dockerInfo.composeAvailable) {
      console.warn("⚠️  docker-compose not available, skipping service startup");
    }

    // Run verification in container
    console.log("🔍 Running verification in container...");

    const networkMode = projectName ? `${projectName}_default` : "bridge";

    const result = await runVerificationInContainer(cwd, {
      image: imageName,
      networkMode,
      timeout: options.timeout,
    });

    // Display results
    if (result.exitCode === 0) {
      console.log("✅ Verification passed in sandbox");
    } else {
      console.error("❌ Verification failed in sandbox");
      console.error(result.stderr);
    }

    return {
      passed: result.exitCode === 0,
      buildSuccess: result.buildSuccess,
      testsPassed: result.testsPassed,
      services: serviceHealths,
      logs: result.stdout + "\n" + result.stderr,
      exitCode: result.exitCode,
    };

  } finally {
    // Cleanup unless keepContainer is true
    if (!options.keepContainer) {
      await cleanupDocker(
        cwd,
        imageName,
        composeFilePath,
        projectName
      );
    } else {
      console.log("🔧 Container kept for debugging (use --keep-container=false to cleanup)");
    }
  }
}
