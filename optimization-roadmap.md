# greenbump 优化迭代方案 v0.3.x

## 问题诊断

基于竞品分析，greenbump 的三大痛点：

1. **验证可靠性不足**（依赖用户测试覆盖率）
   - 现状：只能运行用户提供的 `npm test`，无法保证真实环境正确性
   - 后果：10-20% 误修复率（测试通过但生产环境炸）

2. **复杂升级成功率低**（20-40%）
   - 现状：LLM 一次性处理所有改动，上下文不足，大型重构会遗漏文件
   - 后果：浪费 token，用户还得手动修

3. **引入新 bug 的风险**（10-20% 误修复率）
   - 现状：LLM 可能偷偷注释测试、删代码来让 CI 通过
   - 后果：用户不 review 就 merge，生产环境炸

---

## 迭代方案总览

### Phase 1: 提升验证可靠性 (v0.3.0) — 2 周
**目标**：降低误修复率从 10-20% → 5-10%  
**核心功能**：
- P0.1: 静态分析验证（TypeScript type check, ESLint）
- P0.2: 变更检测警告（测试文件修改、大量删除代码）
- P1.1: 快照对比（API 调用前后对比）

### Phase 2: 多阶段升级策略 (v0.4.0) — 3 周
**目标**：复杂升级成功率从 20-40% → 50-70%  
**核心功能**：
- P0.1: 依赖图分析（识别影响范围）
- P0.2: 分阶段修复（配置 → 类型定义 → 业务代码）
- P1.1: 增量提交（每阶段单独 commit，失败可回滚）

### Phase 3: 沙盒隔离验证 (v0.5.0) — 4 周
**目标**：高风险场景可用性提升  
**核心功能**：
- P0.1: Docker 沙盒模式（`--sandbox`）
- P1.1: 数据库集成测试支持
- P1.2: 性能回归检测（响应时间对比）

---

## Phase 1 详细设计：提升验证可靠性 (v0.3.0)

### P0.1: 静态分析验证层

#### 问题
现在只运行 `npm test`，但很多问题测试覆盖不到：
- TypeScript 类型错误（测试可能是 JS，不检查类型）
- ESLint 规则违反（代码风格问题）
- 导入路径错误（IDE 会报错，但测试可能跳过）

#### 解决方案
在 `run_check` 阶段增加静态分析：

```typescript
// src/engine/verify.ts (新文件)

export interface VerificationResult {
  passed: boolean;
  stage: 'build' | 'types' | 'lint' | 'test';
  output: string;
  warnings?: string[];
}

export async function runStaticAnalysis(
  cwd: string,
  ecosystem: string
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  // 1. TypeScript type check (如果是 TS 项目)
  if (await pathExists(join(cwd, 'tsconfig.json'))) {
    const tscResult = await exec('npx tsc --noEmit', { cwd });
    results.push({
      passed: tscResult.code === 0,
      stage: 'types',
      output: tscResult.stderr,
      warnings: parseTypeErrors(tscResult.stderr),
    });
  }
  
  // 2. ESLint (如果配置了)
  if (await pathExists(join(cwd, '.eslintrc.js')) || 
      await pathExists(join(cwd, '.eslintrc.json'))) {
    const lintResult = await exec('npx eslint . --ext .ts,.tsx,.js,.jsx', { cwd });
    results.push({
      passed: lintResult.code === 0,
      stage: 'lint',
      output: lintResult.stdout,
    });
  }
  
  return results;
}
```

#### 集成到 fix loop

```typescript
// src/engine/run.ts

async function verifyFix(cwd: string, ecosystem: string): Promise<boolean> {
  // 现有逻辑：build + test
  const buildPassed = await runBuild(cwd);
  if (!buildPassed) return false;
  
  const testPassed = await runTest(cwd);
  if (!testPassed) return false;
  
  // 新增：静态分析（可选，但推荐）
  const staticResults = await runStaticAnalysis(cwd, ecosystem);
  const criticalFailed = staticResults.some(r => 
    !r.passed && r.stage === 'types' // 类型错误是硬阻断
  );
  
  if (criticalFailed) {
    log('⚠️  Static analysis failed (type errors). Asking LLM to fix...');
    return false;
  }
  
  // Lint 错误只警告，不阻断
  const lintWarnings = staticResults.filter(r => !r.passed && r.stage === 'lint');
  if (lintWarnings.length > 0) {
    summary.needsReview = true;
    summary.reviewReason = 'Lint warnings introduced';
  }
  
  return true;
}
```

#### 预期效果
- **类型错误捕获率**：从 0% → 95%（TypeScript 项目）
- **误修复率降低**：10-20% → 5-10%（类型系统兜底）
- **额外时间**：+10-30 秒（tsc 编译时间）

---

### P0.2: 变更检测警告

#### 问题
LLM 可能做这些"坏事"来让测试通过：
- 注释掉失败的测试
- 删除大段代码（"反正测试过了"）
- 修改测试文件来适配错误的实现

#### 解决方案
Git diff 分析 + 启发式规则：

```typescript
// src/engine/change-detector.ts (新文件)

export interface SuspiciousChange {
  type: 'test-modified' | 'large-deletion' | 'test-commented';
  file: string;
  description: string;
  severity: 'warning' | 'critical';
}

export async function detectSuspiciousChanges(
  cwd: string
): Promise<SuspiciousChange[]> {
  const diff = await exec('git diff HEAD', { cwd });
  const changes: SuspiciousChange[] = [];
  
  // 1. 测试文件被修改
  const testFilePattern = /\.(test|spec)\.(ts|js|tsx|jsx)$/;
  const modifiedFiles = parseDiffFiles(diff.stdout);
  
  for (const file of modifiedFiles) {
    if (testFilePattern.test(file)) {
      changes.push({
        type: 'test-modified',
        file,
        description: 'Test file was modified during fix loop',
        severity: 'critical',
      });
    }
  }
  
  // 2. 大量删除代码（>50 行）
  const deletionStats = parseDeletionStats(diff.stdout);
  for (const [file, deletions] of Object.entries(deletionStats)) {
    if (deletions > 50) {
      changes.push({
        type: 'large-deletion',
        file,
        description: `${deletions} lines deleted (possible over-aggressive fix)`,
        severity: 'warning',
      });
    }
  }
  
  // 3. 测试代码被注释（启发式检测）
  const commentedTests = detectCommentedTests(diff.stdout);
  changes.push(...commentedTests);
  
  return changes;
}
```

#### 集成到 summary

```typescript
// src/engine/run.ts

async function finalize(summary: RunSummary): Promise<void> {
  const suspiciousChanges = await detectSuspiciousChanges(cwd);
  
  if (suspiciousChanges.some(c => c.severity === 'critical')) {
    summary.needsReview = true;
    summary.reviewReason = 'Critical suspicious changes detected';
    summary.warnings = suspiciousChanges.map(c => 
      `${c.type}: ${c.file} - ${c.description}`
    );
  }
  
  // 打印警告
  if (suspiciousChanges.length > 0) {
    console.error(pc.yellow('\n⚠️  Suspicious changes detected:'));
    for (const change of suspiciousChanges) {
      console.error(`  - ${change.file}: ${change.description}`);
    }
    console.error(pc.yellow('  → Please review the PR carefully before merging.\n'));
  }
}
```

#### 预期效果
- **测试文件修改捕获率**：100%（现在是 50%，容易漏）
- **恶意删除代码检测**：>80%（启发式规则）
- **用户信任度提升**：明确警告 → 强制 review

---

### P1.1: 快照对比（API 调用前后对比）

#### 问题
即使测试通过，实际 API 行为可能变了：
- 函数返回值格式变化（测试只检查了部分字段）
- 副作用变化（数据库写入逻辑改了）

#### 解决方案
在升级前后运行一次真实请求，对比响应：

```typescript
// src/engine/snapshot.ts (新文件)

export interface ApiSnapshot {
  endpoint: string;
  method: string;
  response: any;
  statusCode: number;
}

export async function captureApiSnapshot(
  cwd: string,
  ecosystem: string
): Promise<ApiSnapshot[]> {
  // 从测试文件推断 API endpoints（启发式）
  const testFiles = await glob('**/*.test.{ts,js}', { cwd });
  const endpoints = extractApiCalls(testFiles);
  
  const snapshots: ApiSnapshot[] = [];
  
  // 启动 dev server
  const server = await startDevServer(cwd);
  
  for (const endpoint of endpoints) {
    const response = await fetch(`http://localhost:${server.port}${endpoint}`);
    snapshots.push({
      endpoint,
      method: 'GET',
      response: await response.json(),
      statusCode: response.status,
    });
  }
  
  await server.stop();
  return snapshots;
}

export function compareSnapshots(
  before: ApiSnapshot[],
  after: ApiSnapshot[]
): { changed: boolean; diff: string } {
  // 深度对比 JSON 结构
  const diffs = deepDiff(before, after);
  return {
    changed: diffs.length > 0,
    diff: formatDiff(diffs),
  };
}
```

#### 使用场景（可选功能，默认关闭）

```bash
# 用户显式启用
greenbump react --snapshot
```

#### 限制
- 只适用于有 dev server 的项目（API 项目、Web 应用）
- 需要能快速启动（<30 秒）
- 增加时间：+1-2 分钟

#### 预期效果
- **Runtime 行为回归检测**：0% → 60%（启发式，不是 100%）
- **适用场景**：API 升级（Express, Fastify, Django）

---

## Phase 2 详细设计：多阶段升级策略 (v0.4.0)

### P0.1: 依赖图分析

#### 问题
现在 LLM 一次性看到所有错误，不知道从哪下手：
- 升级 `react` 可能影响 50 个组件
- LLM 上下文不够，会遗漏文件

#### 解决方案
构建依赖图，按影响范围排序修复：

```typescript
// src/engine/dep-graph.ts (新文件)

export interface DependencyNode {
  file: string;
  imports: string[]; // 导入的其他文件
  usesUpgradedPkg: boolean; // 是否直接使用升级的包
}

export async function buildDependencyGraph(
  cwd: string,
  upgradedPkg: string
): Promise<DependencyNode[]> {
  // 使用 madge 或 dependency-cruiser
  const graph = await analyzeDependencies(cwd);
  
  // 找出直接使用升级包的文件
  const directUsers = graph.filter(node => 
    node.imports.includes(upgradedPkg)
  );
  
  // 找出间接依赖的文件（通过导入链）
  const indirectUsers = findTransitiveDeps(graph, directUsers);
  
  return [...directUsers, ...indirectUsers];
}

export function prioritizeFiles(nodes: DependencyNode[]): string[][] {
  // 按层级分组（L0: 直接依赖，L1: 间接依赖，...）
  const layers: string[][] = [];
  let currentLayer = nodes.filter(n => n.usesUpgradedPkg).map(n => n.file);
  
  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer = findNextLayer(nodes, currentLayer);
  }
  
  return layers;
}
```

#### 集成到 fix loop

```typescript
// src/engine/run.ts

async function fixWithStaging(
  cwd: string,
  dep: string,
  testCmd: string
): Promise<RunSummary> {
  const depGraph = await buildDependencyGraph(cwd, dep);
  const layers = prioritizeFiles(depGraph);
  
  console.log(`📊 Dependency graph: ${layers.length} layers, ${depGraph.length} files`);
  
  for (let i = 0; i < layers.length; i++) {
    console.log(`\n🔧 Stage ${i + 1}/${layers.length}: Fixing ${layers[i].length} files`);
    
    // 只让 LLM 看这一层的文件
    const stageResult = await fixLayer(cwd, layers[i], testCmd);
    
    if (!stageResult.success) {
      console.error(`❌ Stage ${i + 1} failed. Stopping.`);
      return { status: 'unfixed', stage: i + 1 };
    }
    
    // 每阶段单独 commit
    await exec(`git add -A && git commit -m "Stage ${i + 1}: fix ${layers[i].length} files"`, { cwd });
  }
  
  return { status: 'fixed', stages: layers.length };
}
```

#### 预期效果
- **复杂升级成功率**：20-40% → 50-70%
- **Token 使用效率**：+30%（LLM 每次只看相关文件）
- **可回滚性**：每阶段失败可独立回滚

---

### P0.2: 分阶段修复策略

#### 问题
某些升级需要先改配置，再改代码：
- Webpack 5: 先改 `webpack.config.js`，再改代码
- TypeScript 5: 先改 `tsconfig.json`，再修类型错误

#### 解决方案
预定义修复顺序：

```typescript
// src/engine/stages.ts (新文件)

export interface FixStage {
  name: string;
  filePatterns: string[]; // 这个阶段修复哪些文件
  validator: (cwd: string) => Promise<boolean>; // 这个阶段是否成功
}

export const COMMON_STAGES: FixStage[] = [
  {
    name: 'Configuration',
    filePatterns: [
      '**/package.json',
      '**/tsconfig.json',
      '**/webpack.config.js',
      '**/.eslintrc.*',
    ],
    validator: async (cwd) => {
      // 配置文件语法是否正确
      return await validateJsonFiles(cwd);
    },
  },
  {
    name: 'Type Definitions',
    filePatterns: ['**/*.d.ts', '**/types/**'],
    validator: async (cwd) => {
      // 类型是否通过
      const result = await exec('npx tsc --noEmit', { cwd });
      return result.code === 0;
    },
  },
  {
    name: 'Source Code',
    filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    validator: async (cwd) => {
      // 业务代码是否通过测试
      return await runTest(cwd);
    },
  },
];

export async function runStagedFix(
  cwd: string,
  dep: string
): Promise<RunSummary> {
  for (const stage of COMMON_STAGES) {
    console.log(`\n🔧 Stage: ${stage.name}`);
    
    const filesToFix = await matchFiles(cwd, stage.filePatterns);
    if (filesToFix.length === 0) {
      console.log(`  (no files matched, skipping)`);
      continue;
    }
    
    const result = await fixFiles(cwd, filesToFix);
    const passed = await stage.validator(cwd);
    
    if (!passed) {
      console.error(`❌ ${stage.name} stage failed`);
      return { status: 'unfixed', failedStage: stage.name };
    }
    
    await exec(`git add -A && git commit -m "Fix ${stage.name}"`, { cwd });
  }
  
  return { status: 'fixed' };
}
```

#### 预期效果
- **Webpack/Babel 升级成功率**：30% → 70%（配置先行）
- **TypeScript 升级成功率**：40% → 80%（类型定义先修）

---

### P1.1: 增量提交（每阶段单独 commit）

#### 现有问题
Fix loop 结束后只有一个大 commit，失败了全部回滚

#### 改进
每个阶段独立 commit：

```bash
greenbump/react-19.0.0
├── Stage 1: Fix configuration (webpack.config.js)
├── Stage 2: Fix type definitions (types/*.d.ts)
└── Stage 3: Fix source code (src/**/*.tsx)
```

#### 用户体验
```bash
$ greenbump react --staged

🌱 greenbump
  · target: react 18.3.1 → 19.0.0
  · dependency graph: 3 layers, 47 files

🔧 Stage 1/3: Configuration (2 files)
  ✓ Fixed webpack.config.js
  ✓ Committed: Stage 1/3

🔧 Stage 2/3: Type definitions (5 files)
  ✓ Fixed types/react.d.ts
  ✓ Committed: Stage 2/3

🔧 Stage 3/3: Source code (40 files)
  ❌ Failed after 10 rounds

💡 Tip: Stage 1-2 succeeded. You can:
  - Review the commits and continue manually from Stage 3
  - Or run: git reset HEAD~2 to rollback everything
```

---

## Phase 3 详细设计：沙盒隔离验证 (v0.5.0)

### P0.1: Docker 沙盒模式

#### 问题
Fix loop 在本地运行，可能污染环境：
- 全局安装的包冲突
- 数据库状态被修改
- 无法并行运行多个升级

#### 解决方案
Docker 隔离：

```typescript
// src/engine/sandbox.ts (新文件)

export interface SandboxConfig {
  image: string; // 基础镜像（node:20, python:3.11）
  volumes: string[]; // 挂载的目录
  env: Record<string, string>; // 环境变量
}

export async function runInSandbox(
  cwd: string,
  cmd: string,
  config: SandboxConfig
): Promise<{ code: number; stdout: string; stderr: string }> {
  const containerId = generateId();
  
  // 1. 启动容器
  await exec(`docker run -d --name ${containerId} \
    -v ${cwd}:/workspace \
    -w /workspace \
    ${config.image} \
    sleep infinity
  `);
  
  // 2. 执行命令
  const result = await exec(`docker exec ${containerId} ${cmd}`);
  
  // 3. 清理
  await exec(`docker rm -f ${containerId}`);
  
  return result;
}
```

#### 使用方式

```bash
greenbump react --sandbox
```

#### 限制
- 需要本地安装 Docker
- 启动时间：+10-30 秒
- 不支持 macOS 特有的工具（如 Xcode）

#### 预期效果
- **环境隔离**：100%（不污染本地）
- **并行升级**：可以同时跑 5 个 greenbump（不同容器）
- **可重现性**：+95%（Docker 镜像固定）

---

### P1.1: 数据库集成测试支持

#### 问题
很多项目的测试需要真实数据库（PostgreSQL, MySQL）

#### 解决方案
Docker Compose 支持：

```yaml
# greenbump.sandbox.yml (用户自定义)
version: '3'
services:
  app:
    image: node:20
    volumes:
      - .:/workspace
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: test
```

```bash
greenbump react --sandbox --compose greenbump.sandbox.yml
```

#### 预期效果
- **集成测试成功率**：30% → 90%（数据库可用）

---

## 优先级排序 & 时间规划

### v0.3.0 (2 周) - 必做
- ✅ P0.1: 静态分析验证（TypeScript + ESLint）— 3 天
- ✅ P0.2: 变更检测警告（测试修改、大量删除）— 2 天
- ⚠️ P1.1: 快照对比（API 前后对比）— 5 天（可选）

**发布标准**：误修复率降到 5-10%

### v0.4.0 (3 周) - 推荐
- ✅ P0.1: 依赖图分析（madge 集成）— 5 天
- ✅ P0.2: 分阶段修复（配置→类型→代码）— 5 天
- ✅ P1.1: 增量提交（每阶段独立 commit）— 3 天

**发布标准**：复杂升级成功率达到 50-70%

### v0.5.0 (4 周) - 长期
- ✅ P0.1: Docker 沙盒模式 — 7 天
- ⚠️ P1.1: 数据库集成测试 — 5 天
- ⚠️ P1.2: 性能回归检测 — 5 天

**发布标准**：适用于高风险生产环境

---

## 技术选型

### 依赖图分析
- **madge**（推荐）：轻量，支持 ES6/CommonJS
- **dependency-cruiser**：功能更强，但配置复杂

### 静态分析
- **TypeScript**：tsc --noEmit（必须）
- **ESLint**：eslint .（推荐）
- **Prettier**：prettier --check .（可选）

### Docker
- **官方 Node 镜像**：node:20-alpine（体积小）
- **Docker Compose**：v2.x（数据库支持）

---

## 成本-收益评估

### v0.3.0 投入 vs 产出
**投入**：
- 开发时间：2 周 × 1 人 = 10 天
- 测试时间：3 天

**产出**：
- 误修复率：10-20% → 5-10%（降低一半）
- 用户信任度：+30%（明确警告）
- PR review 时间：-40%（自动标记可疑改动）

**ROI**：⭐⭐⭐⭐⭐（必做，影响用户信任）

### v0.4.0 投入 vs 产出
**投入**：
- 开发时间：3 周 × 1 人 = 15 天
- 测试时间：5 天

**产出**：
- 复杂升级成功率：20-40% → 50-70%（+30%）
- Token 使用效率：+30%（减少无效尝试）
- 用户满意度：+50%（Webpack/TS 升级可用）

**ROI**：⭐⭐⭐⭐（推荐，显著提升成功率）

### v0.5.0 投入 vs 产出
**投入**：
- 开发时间：4 周 × 1 人 = 20 天
- 测试时间：7 天
- 基础设施成本：Docker 镜像存储

**产出**：
- 高风险场景可用性：0% → 60%
- 并行升级能力：1x → 5x
- 可重现性：+95%

**ROI**：⭐⭐⭐（长期投资，适合企业用户）

---

## 风险评估

### v0.3.0 风险
- **兼容性**：某些项目没配置 TSConfig/ESLint（降级处理：跳过检查）
- **误报**：启发式规则可能误判（解决：可配置关闭）

### v0.4.0 风险
- **依赖图准确性**：动态导入可能漏检（解决：保守策略，多包含文件）
- **阶段划分**：不是所有项目都适合 3 阶段（解决：用户可自定义）

### v0.5.0 风险
- **Docker 依赖**：用户可能没装 Docker（解决：检测并降级到本地模式）
- **启动时间**：+10-30 秒（解决：缓存镜像）

---

## 下一步行动

### 立即可做（v0.3.0）
1. **Week 1**：
   - Day 1-2: 实现 `verify.ts`（TypeScript + ESLint 集成）
   - Day 3-4: 实现 `change-detector.ts`（测试修改检测）
   - Day 5: 集成到 `run.ts`，写单元测试

2. **Week 2**：
   - Day 1-3: 实现 `snapshot.ts`（API 快照对比）
   - Day 4-5: 端到端测试（真实 repo）
   - Day 6-7: 文档 + 发布 v0.3.0

### 用户验证（Beta 测试）
在 v0.3.0 发布后，招募 10-20 个 beta 用户：
- 收集误修复案例
- 调优启发式规则
- 决定是否继续 v0.4.0

---

## 总结

**核心策略**：
1. v0.3.0 先解决「信任问题」（降低误修复率）
2. v0.4.0 再解决「能力问题」（提升复杂升级成功率）
3. v0.5.0 最后解决「场景问题」（高风险环境可用）

**预期成果**：
- 6 个月后，greenbump 成为「可信赖的」AI 升级工具
- 适用场景从「小项目」扩展到「中大型项目」
- 与 Migratowl 在「Python + 高风险」之外的所有场景竞争

**关键成功指标**：
- 误修复率 < 5%
- 复杂升级成功率 > 60%
- GitHub Star 增长 > 50%（用户信任度）
