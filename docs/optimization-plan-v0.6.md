# greenbump 短期优化方案 (v0.6.0)

## 📋 目标

在 1-2 个月内完成三个核心优化：
1. **准确率提升**: 95% → 98%+
2. **Token 成本优化**: 平均成本降低 60-70%
3. **交互式模式**: 提升用户信任和控制力

---

## 🎯 优化一：准确率提升

### 现状分析

**当前准确率**: ~95%
**误报来源**:
- AI 修复通过测试但引入隐性问题（2-3%）
- Changelog 解析不完整（1-2%）
- 运行时问题测试无法覆盖（1%）

### 优化方案

#### 1.1 静态分析增强 (AST 对比)

**实现**: `src/engine/verifiers/ast-analyzer.ts`

```typescript
import * as ts from 'typescript';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

interface ASTDiff {
  removedExports: string[];
  addedExports: string[];
  modifiedSignatures: SignatureChange[];
  removedTypes: string[];
  breakingChanges: BreakingChange[];
}

export class ASTAnalyzer {
  /**
   * 对比升级前后的 AST，检测潜在的 breaking changes
   */
  async analyzeDiff(
    beforeFiles: Map<string, string>,
    afterFiles: Map<string, string>
  ): Promise<ASTDiff> {
    const diff: ASTDiff = {
      removedExports: [],
      addedExports: [],
      modifiedSignatures: [],
      removedTypes: [],
      breakingChanges: []
    };

    for (const [path, beforeCode] of beforeFiles) {
      const afterCode = afterFiles.get(path);
      if (!afterCode) {
        // 文件被删除
        diff.breakingChanges.push({
          type: 'file-deleted',
          file: path,
          severity: 'high'
        });
        continue;
      }

      // 对比 exports
      const beforeExports = this.extractExports(beforeCode, path);
      const afterExports = this.extractExports(afterCode, path);

      const removed = beforeExports.filter(e => !afterExports.includes(e));
      if (removed.length > 0) {
        diff.removedExports.push(...removed);
        diff.breakingChanges.push({
          type: 'export-removed',
          file: path,
          exports: removed,
          severity: 'high'
        });
      }

      // 对比函数签名
      const signatureChanges = this.compareSignatures(beforeCode, afterCode, path);
      diff.modifiedSignatures.push(...signatureChanges);
    }

    return diff;
  }

  /**
   * 提取文件的 exports
   */
  private extractExports(code: string, filename: string): string[] {
    const exports: string[] = [];
    
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) {
      // TypeScript AST 解析
      const sourceFile = ts.createSourceFile(
        filename,
        code,
        ts.ScriptTarget.Latest,
        true
      );

      ts.forEachChild(sourceFile, node => {
        if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
          // 提取 export 名称
          // ... 实现细节
        }
      });
    } else {
      // JavaScript Babel 解析
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx']
      });

      traverse(ast, {
        ExportNamedDeclaration(path) {
          // 提取 export 名称
        },
        ExportDefaultDeclaration(path) {
          exports.push('default');
        }
      });
    }

    return exports;
  }

  /**
   * 对比函数签名
   */
  private compareSignatures(
    before: string,
    after: string,
    filename: string
  ): SignatureChange[] {
    // 实现签名对比逻辑
    // 检测参数数量变化、类型变化、返回值变化
    return [];
  }
}
```

**集成到验证流程**:

```typescript
// src/engine/verifiers/pipeline.ts

async verify(ctx: VerifyContext): Promise<VerifyResult> {
  const results = [];

  // 现有验证
  results.push(await this.runTests(ctx));
  results.push(await this.runTypeScript(ctx));
  results.push(await this.runESLint(ctx));
  results.push(await this.detectChanges(ctx));

  // 新增 AST 分析
  results.push(await this.analyzeAST(ctx));

  // 如果发现 breaking changes，标记为需要 review
  const hasBreakingChanges = results.some(
    r => r.type === 'ast-analysis' && r.breakingChanges.length > 0
  );

  return {
    success: results.every(r => r.passed),
    needsReview: hasBreakingChanges,
    results
  };
}
```

#### 1.2 Changelog 深度解析

**实现**: `src/engine/analyzers/changelog-parser.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';

interface BreakingChange {
  type: 'api-removed' | 'api-renamed' | 'behavior-changed' | 'type-changed';
  description: string;
  migration: string;
  affectedApis: string[];
  severity: 'low' | 'medium' | 'high';
}

export class ChangelogParser {
  private client: Anthropic;
  private cache: Map<string, BreakingChange[]>;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.cache = new Map();
  }

  /**
   * 使用 LLM 专门提取 breaking changes
   */
  async extractBreakingChanges(
    packageName: string,
    fromVersion: string,
    toVersion: string,
    changelog: string
  ): Promise<BreakingChange[]> {
    const cacheKey = `${packageName}:${fromVersion}->${toVersion}`;
    
    // 缓存命中
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const prompt = `Analyze this changelog for breaking changes between versions.

Package: ${packageName}
From: ${fromVersion}
To: ${toVersion}

Changelog:
${changelog}

Extract ONLY breaking changes in this JSON format:
[
  {
    "type": "api-removed" | "api-renamed" | "behavior-changed" | "type-changed",
    "description": "Brief description",
    "migration": "How to fix it",
    "affectedApis": ["ReactDOM.render", "React.renderToString"],
    "severity": "low" | "medium" | "high"
  }
]

Return ONLY valid JSON, no other text.`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });

    const breakingChanges = JSON.parse(response.content[0].text);
    
    // 缓存结果
    this.cache.set(cacheKey, breakingChanges);
    
    return breakingChanges;
  }

  /**
   * 建立 breaking change 模式库
   */
  async buildPatternLibrary(): Promise<void> {
    // 预定义常见升级的修复模式
    const patterns = {
      'react': {
        '18->19': [
          {
            pattern: /ReactDOM\.render\(/g,
            replacement: 'createRoot(',
            imports: {
              remove: "import ReactDOM from 'react-dom'",
              add: "import { createRoot } from 'react-dom/client'"
            }
          }
        ]
      },
      'vue': {
        '2->3': [
          // Vue 2→3 的常见修复模式
        ]
      }
    };

    // 持久化到本地存储
    await this.savePatterns(patterns);
  }

  private async savePatterns(patterns: any): Promise<void> {
    // 保存到 ~/.greenbump/patterns.json
  }
}
```

**集成到修复循环**:

```typescript
// src/engine/fixer/loop.ts

async fix(ctx: FixContext): Promise<FixResult> {
  // 1. 先尝试模式匹配（免费、快速）
  const patternFix = await this.tryPatternFix(ctx);
  if (patternFix.success) {
    return patternFix;  // 无需调用 LLM
  }

  // 2. 模式匹配失败，使用 LLM
  // 但提供更精确的上下文
  const breakingChanges = await this.changelogParser.extractBreakingChanges(
    ctx.packageName,
    ctx.fromVersion,
    ctx.toVersion,
    ctx.changelog
  );

  const enhancedContext = {
    ...ctx,
    breakingChanges,  // 结构化的 breaking changes
    astDiff: await this.astAnalyzer.analyzeDiff(...)  // AST 对比结果
  };

  return await this.llmFix(enhancedContext);
}
```

#### 1.3 语义版本检查

**实现**: `src/engine/verifiers/semver-checker.ts`

```typescript
export class SemverChecker {
  /**
   * 检测 patch 版本是否有 hidden breaking changes
   */
  async checkHiddenBreakingChanges(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<HiddenBreakingChange[]> {
    // 1. 下载两个版本的实际代码
    const beforeCode = await this.downloadPackage(packageName, fromVersion);
    const afterCode = await this.downloadPackage(packageName, toVersion);

    // 2. 对比导出的 API
    const beforeApi = await this.extractPublicApi(beforeCode);
    const afterApi = await this.extractPublicApi(afterCode);

    // 3. 检测差异
    const breaking: HiddenBreakingChange[] = [];
    
    for (const api of beforeApi) {
      if (!afterApi.includes(api)) {
        breaking.push({
          type: 'api-removed',
          api,
          severity: 'high'
        });
      }
    }

    return breaking;
  }

  /**
   * 提取包的公开 API
   */
  private async extractPublicApi(packagePath: string): Promise<string[]> {
    // 分析 package.json 的 exports 字段
    // 或分析 index.d.ts 的导出
    return [];
  }
}
```

### 预期效果

- **准确率**: 95% → 98%+
- **误报率**: 5% → 2%
- **实现时间**: 3-4 周

---

## 💰 优化二：Token 成本优化

### 现状分析

**当前成本**:
- 简单修复: $0.15 (Claude) / $0.015 (DeepSeek)
- 中等修复: $0.30 / $0.03
- 复杂修复: $0.80 / $0.08

**主要成本来源**:
1. 重复的 changelog 获取（每次升级都重新获取）
2. 整个项目上下文发送到 LLM（浪费 token）
3. 所有修复都调用 LLM（即使简单的正则替换）

### 优化方案

#### 2.1 智能缓存系统

**实现**: `src/engine/cache/manager.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

export class CacheManager {
  private cacheDir: string;

  constructor() {
    this.cacheDir = path.join(process.env.HOME!, '.greenbump', 'cache');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * 缓存 changelog
   */
  async getChangelog(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string | null> {
    const key = this.getChangelogKey(packageName, fromVersion, toVersion);
    const cachePath = path.join(this.cacheDir, 'changelogs', `${key}.txt`);

    try {
      return await fs.readFile(cachePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async setChangelog(
    packageName: string,
    fromVersion: string,
    toVersion: string,
    changelog: string
  ): Promise<void> {
    const key = this.getChangelogKey(packageName, fromVersion, toVersion);
    const cachePath = path.join(this.cacheDir, 'changelogs', `${key}.txt`);

    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, changelog, 'utf-8');
  }

  /**
   * 缓存修复模式
   */
  async getFixPattern(
    packageName: string,
    errorPattern: string
  ): Promise<FixPattern | null> {
    const key = this.hashKey(`${packageName}:${errorPattern}`);
    const cachePath = path.join(this.cacheDir, 'patterns', `${key}.json`);

    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async setFixPattern(
    packageName: string,
    errorPattern: string,
    pattern: FixPattern
  ): Promise<void> {
    const key = this.hashKey(`${packageName}:${errorPattern}`);
    const cachePath = path.join(this.cacheDir, 'patterns', `${key}.json`);

    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(pattern, null, 2), 'utf-8');
  }

  /**
   * 缓存 LLM 响应（用于相同错误）
   */
  async getLlmResponse(contextHash: string): Promise<string | null> {
    const cachePath = path.join(this.cacheDir, 'llm', `${contextHash}.txt`);

    try {
      return await fs.readFile(cachePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async setLlmResponse(contextHash: string, response: string): Promise<void> {
    const cachePath = path.join(this.cacheDir, 'llm', `${contextHash}.txt`);

    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, response, 'utf-8');
  }

  private getChangelogKey(pkg: string, from: string, to: string): string {
    return `${pkg.replace('/', '_')}-${from}-${to}`;
  }

  private hashKey(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}
```

#### 2.2 增量上下文管理

**实现**: `src/engine/context/optimizer.ts`

```typescript
export class ContextOptimizer {
  /**
   * 只发送相关的文件上下文，而非整个项目
   */
  async buildOptimalContext(
    errorOutput: string,
    projectRoot: string
  ): Promise<MinimalContext> {
    // 1. 从错误输出中提取相关文件
    const affectedFiles = this.extractFilesFromError(errorOutput);

    // 2. 分析依赖图，找到直接相关的文件
    const relatedFiles = await this.findRelatedFiles(
      affectedFiles,
      projectRoot
    );

    // 3. 只读取这些文件
    const context: MinimalContext = {
      files: new Map(),
      errorOutput,
      packageJson: await this.readPackageJson(projectRoot)
    };

    for (const file of relatedFiles) {
      const content = await fs.readFile(
        path.join(projectRoot, file),
        'utf-8'
      );
      context.files.set(file, content);
    }

    return context;
  }

  /**
   * 从错误输出提取文件路径
   */
  private extractFilesFromError(error: string): string[] {
    const files: string[] = [];
    
    // 匹配常见的错误格式
    const patterns = [
      /at .*\((.*?):(\d+):(\d+)\)/g,        // Node.js 错误
      /(.*?):(\d+):(\d+) - error/g,         // TypeScript 错误
      /ERROR in (.*?)$/gm                    // Webpack 错误
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(error)) !== null) {
        files.push(match[1]);
      }
    }

    return [...new Set(files)];  // 去重
  }

  /**
   * 查找相关文件（通过 import 关系）
   */
  private async findRelatedFiles(
    files: string[],
    projectRoot: string
  ): Promise<string[]> {
    const related = new Set(files);

    for (const file of files) {
      // 解析 import 语句
      const content = await fs.readFile(
        path.join(projectRoot, file),
        'utf-8'
      );
      
      const imports = this.extractImports(content);
      for (const imp of imports) {
        related.add(imp);
      }
    }

    return Array.from(related);
  }

  private extractImports(code: string): string[] {
    // 解析 import/require 语句
    return [];
  }
}
```

#### 2.3 分级修复策略

**实现**: `src/engine/fixer/strategies.ts`

```typescript
export enum FixStrategy {
  REGEX = 'regex',        // 正则替换（免费）
  RULE = 'rule',          // 规则引擎（免费）
  LLM_CACHED = 'cached',  // 缓存的 LLM 响应（免费）
  LLM = 'llm'             // 实际 LLM 调用（付费）
}

export class FixStrategyEngine {
  /**
   * 按成本从低到高尝试修复
   */
  async fix(ctx: FixContext): Promise<FixResult> {
    // Level 1: 尝试正则替换
    const regexResult = await this.tryRegexFix(ctx);
    if (regexResult.success) {
      return { ...regexResult, strategy: FixStrategy.REGEX, cost: 0 };
    }

    // Level 2: 尝试规则引擎
    const ruleResult = await this.tryRuleEngine(ctx);
    if (ruleResult.success) {
      return { ...ruleResult, strategy: FixStrategy.RULE, cost: 0 };
    }

    // Level 3: 检查缓存的 LLM 响应
    const cachedResult = await this.tryCachedLlm(ctx);
    if (cachedResult.success) {
      return { ...cachedResult, strategy: FixStrategy.LLM_CACHED, cost: 0 };
    }

    // Level 4: 调用 LLM（最后手段）
    const llmResult = await this.callLlm(ctx);
    return { ...llmResult, strategy: FixStrategy.LLM, cost: llmResult.tokensUsed };
  }

  /**
   * 正则替换（内置常见模式）
   */
  private async tryRegexFix(ctx: FixContext): Promise<FixResult> {
    const patterns = [
      {
        // React 18 → 19
        errorPattern: /ReactDOM\.render is not a function/,
        fixPattern: /ReactDOM\.render\((.*?),\s*(.*?)\)/gs,
        replacement: 'createRoot($2).render($1)',
        imports: {
          remove: "import ReactDOM from 'react-dom'",
          add: "import { createRoot } from 'react-dom/client'"
        }
      },
      {
        // Vue 2 → 3
        errorPattern: /new Vue is not a constructor/,
        fixPattern: /new Vue\((.*?)\)/gs,
        replacement: 'createApp($1)',
        imports: {
          remove: "import Vue from 'vue'",
          add: "import { createApp } from 'vue'"
        }
      }
      // 更多模式...
    ];

    for (const pattern of patterns) {
      if (pattern.errorPattern.test(ctx.errorOutput)) {
        // 应用修复
        for (const [file, content] of ctx.files) {
          const fixed = content.replace(pattern.fixPattern, pattern.replacement);
          
          if (fixed !== content) {
            // 更新 imports
            const withImports = this.updateImports(
              fixed,
              pattern.imports.remove,
              pattern.imports.add
            );

            await this.writeFile(file, withImports);
          }
        }

        // 验证修复
        const verified = await this.verifyFix(ctx);
        if (verified) {
          return { success: true, filesModified: ctx.files.size };
        }
      }
    }

    return { success: false };
  }

  /**
   * 规则引擎（更复杂的逻辑）
   */
  private async tryRuleEngine(ctx: FixContext): Promise<FixResult> {
    // 使用 JSON 定义的规则库
    const rules = await this.loadRules(ctx.packageName);
    
    for (const rule of rules) {
      if (this.matchesRule(ctx, rule)) {
        const applied = await this.applyRule(ctx, rule);
        if (applied.success) {
          return applied;
        }
      }
    }

    return { success: false };
  }

  private async loadRules(packageName: string): Promise<FixRule[]> {
    // 从 .greenbump/rules/{packageName}.json 加载
    return [];
  }
}
```

### 预期效果

**成本降低**:
- 简单修复: $0.15 → $0.00 (规则匹配成功) - 降低 100%
- 中等修复: $0.30 → $0.10 (部分缓存) - 降低 67%
- 复杂修复: $0.80 → $0.50 (上下文优化) - 降低 37%

**平均成本降低**: 60-70%

**实现时间**: 2-3 周

---

## 🎮 优化三：交互式模式

### 实现方案

#### 3.1 交互式 CLI

**实现**: `src/engine/cli/interactive.ts`

```typescript
import inquirer from 'inquirer';
import chalk from 'chalk';

export class InteractiveFixer {
  /**
   * AI 每次修改前询问用户
   */
  async confirmFix(
    suggestion: FixSuggestion
  ): Promise<'accept' | 'reject' | 'edit' | 'skip'> {
    console.log(chalk.blue('\n🤖 AI Suggestion:\n'));
    console.log(chalk.gray('Files to modify:'));
    
    for (const file of suggestion.files) {
      console.log(`  ${chalk.yellow('→')} ${file}`);
    }

    console.log(chalk.gray('\nProposed changes:'));
    console.log(this.formatDiff(suggestion.diff));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '✅ Accept - Apply this fix', value: 'accept' },
          { name: '❌ Reject - Skip this suggestion', value: 'reject' },
          { name: '✏️  Edit - Modify before applying', value: 'edit' },
          { name: '⏭️  Skip - Move to next round', value: 'skip' },
          { name: '❓ Why - Explain this fix', value: 'why' }
        ]
      }
    ]);

    if (action === 'why') {
      console.log(chalk.cyan('\n💡 Explanation:'));
      console.log(suggestion.explanation);
      return this.confirmFix(suggestion);  // 重新询问
    }

    return action;
  }

  /**
   * 格式化 diff 输出
   */
  private formatDiff(diff: string): string {
    const lines = diff.split('\n');
    return lines.map(line => {
      if (line.startsWith('+')) {
        return chalk.green(line);
      } else if (line.startsWith('-')) {
        return chalk.red(line);
      } else if (line.startsWith('@@')) {
        return chalk.cyan(line);
      }
      return chalk.gray(line);
    }).join('\n');
  }

  /**
   * 编辑模式
   */
  async editFix(suggestion: FixSuggestion): Promise<FixSuggestion> {
    const { edited } = await inquirer.prompt([
      {
        type: 'editor',
        name: 'edited',
        message: 'Edit the fix:',
        default: suggestion.diff
      }
    ]);

    return {
      ...suggestion,
      diff: edited
    };
  }
}
```

#### 3.2 批量操作模式

```typescript
export class BatchInteractiveFixer {
  /**
   * 一次展示多个修复建议
   */
  async reviewBatch(
    suggestions: FixSuggestion[]
  ): Promise<Map<number, 'accept' | 'reject'>> {
    console.log(chalk.blue(`\n📦 ${suggestions.length} fix suggestions:\n`));

    const decisions = new Map();

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      
      console.log(chalk.yellow(`\n[${i + 1}/${suggestions.length}] ${s.summary}`));
      console.log(this.formatDiff(s.diff));

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          choices: [
            { name: '✅ Accept', value: 'accept' },
            { name: '❌ Reject', value: 'reject' },
            { name: '⏸️  Review later', value: 'later' }
          ]
        }
      ]);

      decisions.set(i, action);

      if (action === 'later') {
        // 标记为待审查，继续下一个
        continue;
      }
    }

    return decisions;
  }

  /**
   * 快速模式：接受所有高置信度的修复
   */
  async autoAcceptHighConfidence(
    suggestions: FixSuggestion[],
    threshold: number = 0.9
  ): Promise<void> {
    const highConfidence = suggestions.filter(s => s.confidence >= threshold);
    const lowConfidence = suggestions.filter(s => s.confidence < threshold);

    console.log(chalk.green(`\n✅ Auto-accepting ${highConfidence.length} high-confidence fixes`));
    
    for (const fix of highConfidence) {
      await this.applyFix(fix);
    }

    if (lowConfidence.length > 0) {
      console.log(chalk.yellow(`\n⚠️  ${lowConfidence.length} fixes need review:`));
      await this.reviewBatch(lowConfidence);
    }
  }
}
```

#### 3.3 CLI 集成

```typescript
// src/cli.ts

program
  .command('upgrade [dep]')
  .option('-i, --interactive', 'Interactive mode - confirm each fix')
  .option('--auto-accept-threshold <n>', 'Auto-accept fixes with confidence > n', parseFloat)
  .option('--review-batch', 'Review all fixes at once (vs one-by-one)')
  .action(async (dep, options) => {
    if (options.interactive) {
      const fixer = new InteractiveFixer();
      
      // 在修复循环中调用
      await engine.upgrade(dep, {
        ...options,
        onFixSuggestion: async (suggestion) => {
          const action = await fixer.confirmFix(suggestion);
          
          if (action === 'edit') {
            return await fixer.editFix(suggestion);
          }
          
          return action === 'accept' ? suggestion : null;
        }
      });
    } else {
      // 非交互模式
      await engine.upgrade(dep, options);
    }
  });
```

### 用户体验改进

#### 3.4 修复预览

```typescript
/**
 * 在应用修复前预览所有更改
 */
async function previewFixes(suggestions: FixSuggestion[]): Promise<void> {
  console.log(chalk.blue('\n📋 Fix Preview:\n'));

  const summary = suggestions.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, {});

  console.log('Summary:');
  Object.entries(summary).forEach(([category, count]) => {
    console.log(`  ${category}: ${count} fixes`);
  });

  console.log('\nDetailed changes:');
  suggestions.forEach((s, i) => {
    console.log(`\n${i + 1}. ${chalk.bold(s.summary)}`);
    console.log(`   Files: ${s.files.join(', ')}`);
    console.log(`   Confidence: ${(s.confidence * 100).toFixed(0)}%`);
  });

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with these fixes?',
      default: true
    }
  ]);

  return confirm;
}
```

### 预期效果

- **用户信任提升**: 从"黑盒"变成"可控"
- **误报减少**: 用户可以拒绝不合适的修复
- **学习价值**: 用户可以看到 AI 的解释，学习最佳实践

**实现时间**: 2 周

---

## 📅 实施计划

### Week 1-2: 准确率提升（上）
- [ ] 实现 AST 分析器基础框架
- [ ] 集成到验证流程
- [ ] 编写单元测试

### Week 3-4: 准确率提升（下）
- [ ] 实现 Changelog 深度解析
- [ ] 建立修复模式库
- [ ] 集成语义版本检查
- [ ] E2E 测试

### Week 5-6: Token 成本优化
- [ ] 实现缓存管理器
- [ ] 实现上下文优化器
- [ ] 实现分级修复策略
- [ ] 性能测试和调优

### Week 7-8: 交互式模式
- [ ] 实现交互式 CLI
- [ ] 实现批量操作模式
- [ ] 实现修复预览
- [ ] 用户测试和反馈

---

## 📊 成功指标

| 指标 | 当前 | 目标 | 测量方式 |
|------|------|------|---------|
| **准确率** | 95% | 98%+ | E2E 测试通过率 |
| **平均成本** | $0.40 | $0.12 | 实际使用统计 |
| **用户信任度** | - | 85%+ | 用户调查 |
| **修复时间** | 30s | 20s | 性能测试 |

---

## 🎯 总结

**v0.6.0 将带来**:
1. ✅ **准确率**: 95% → 98%+（AST 分析 + Changelog 深度解析）
2. ✅ **成本**: 降低 60-70%（缓存 + 分级修复）
3. ✅ **用户体验**: 交互式模式，用户完全掌控

**预计开发周期**: 8 周（2 个月）

**优先级排序**:
1. 🔥 **最高**: Token 成本优化（立即降低成本）
2. 🔥 **高**: 交互式模式（提升用户信任）
3. 🔥 **中**: 准确率提升（长期质量）

建议按 **成本优化 → 交互式模式 → 准确率提升** 的顺序实施，这样可以快速看到效果并获取用户反馈。
