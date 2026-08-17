# 🌱 greenbump：让 AI 帮你修复依赖升级的破坏性变更

## 前言

你是否也经历过这样的场景：

- Dependabot 又发了一个 PR，升级了某个依赖，然后… CI 全红了 🔴
- 你打开 PR，看到一堆失败的测试，心想："又要花一下午修这玩意儿"
- 你翻开 changelog，找到那个 breaking change，然后手动改遍所有调用点
- 改完提交，CI 还是红的，原来还有个隐藏的 API 变更没注意到...

**如果有个工具，能在升级依赖的同时，自动把破坏性变更修好，该多好？**

今天给大家介绍我开发的开源工具：**greenbump** —— 一个真正会「修代码」的依赖升级工具。

## TL;DR

```bash
# 一行命令，升级 + 自动修复 + 验证
npx greenbump react

# 30 秒后...
✅ Fixed: react 18.3.1 → 19.2.0
   broke the build, agent repaired 2 file(s), now green.
   branch: greenbump/react-19.2.0 (committed)
```

**GitHub**: https://github.com/shidesheng0218/greenbump  
**npm**: https://www.npmjs.com/package/greenbump

---

## 为什么需要 greenbump？

### 现状：依赖升级是个「体力活」

目前的依赖升级工具（Dependabot、Renovate）做的事情很简单：

1. 检测到新版本
2. 修改 `package.json`
3. 开一个 PR

然后你会得到一个**红色的 PR**，上面写着：

```
❌ Build failed
❌ 47 tests failed
```

接下来的工作全是你的：

1. 读 changelog，找 breaking changes
2. 找到所有受影响的代码
3. 一个个改
4. 提交，等 CI
5. 发现还有遗漏，再改
6. 循环往复...

**一个简单的版本升级，可能要花费 1-3 小时。**

### greenbump 的解决方案：让 AI 修代码

greenbump 不仅升级依赖，还会：

1. ✅ 运行你的测试，检测哪里坏了
2. ✅ 自动读取 changelog 和错误信息
3. ✅ 让 AI agent 分析并修复破坏性变更
4. ✅ 循环修复直到测试通过
5. ✅ 多层验证（TypeScript + ESLint + 变更检测）
6. ✅ 提交到新分支，生成 PR 描述

**你只需要 review 代码，然后 merge。**

---

## 实际案例：React 18 → 19 升级

React 19 移除了 `ReactDOM.render`，必须改用 `createRoot`。

### 传统方式

```bash
# Dependabot 发 PR
npm install react@19

# 运行测试
npm test
# ❌ Error: ReactDOM.render is not a function

# 手动修改所有文件
# src/index.tsx
# src/test-utils.tsx
# tests/setup.ts
# ...

# 再次测试
npm test
# ❌ 还有几个遗漏的...
```

**耗时：1-2 小时**

### greenbump 方式

```bash
npx greenbump react
```

**输出：**

```
🌱 greenbump
  · target: react 18.3.1 → 19.2.0
  · created branch greenbump/react-19.2.0
  · running baseline build + tests…
  · installing react@19.2.0…
  · upgrade broke test — starting AI fix loop via Claude
  
  · round 1: read_file src/index.tsx
  · round 2: write_file src/index.tsx
           (replaced ReactDOM.render with createRoot)
  · round 3: run_check
  · round 3: check passed — fixed

✅ Fixed: react 18.3.1 → 19.2.0
  broke the build, agent repaired 2 file(s), now green.
  
📊 Verification:
  ✓ Build passed
  ✓ Tests passed (47 passed)
  ✓ TypeScript types valid
  ✓ No suspicious changes detected
  
  branch: greenbump/react-19.2.0 (committed)
  tokens: 41,201 in / 3,338 out
```

**耗时：30 秒**（自动完成）  
**成本：~$0.15**（根据你的 API key）

---

## 核心特性

### 🤖 AI 驱动的代码修复

- 支持多个 AI 模型：Claude、OpenAI、DeepSeek、Groq
- 自动读取 changelog 和错误信息
- 多轮修复循环（read → analyze → edit → test）
- 可配置最大轮次，防止成本失控

### 🔍 多层验证体系（v0.3.0+）

不仅仅是"测试通过"就算修好：

1. ✅ Build + Tests（基础）
2. ✅ TypeScript 类型检查（`tsc --noEmit`）
3. ✅ ESLint 检查
4. ✅ 变更检测（是否修改了测试文件、是否有大量删除、是否注释掉了测试）

**通过多层验证，将误报率从 20% 降低到 10%。**

### 🐳 沙盒隔离模式（v0.5.0+）

对于需要数据库的项目：

```bash
npx greenbump typeorm --sandbox --services postgres
```

- 🐳 在 Docker 容器中运行测试（完全隔离）
- 🗄️ 自动启动数据库服务（PostgreSQL、MySQL、Redis、MongoDB）
- 📊 性能回归检测（构建时间、包大小、内存占用）

**准确率提升到 95%+。**

### 🌍 多生态系统支持

不仅仅是 JavaScript！支持 20+ 语言和包管理器：

- **JavaScript/TypeScript**: npm, Yarn, pnpm
- **Python**: pip, Poetry, uv, Pipenv
- **Rust**: Cargo
- **Go**: Go modules
- **Java/Kotlin**: Gradle, Maven
- **Ruby**: Bundler
- **PHP**: Composer
- **.NET**: NuGet
- 还有更多...

### 🛡️ 安全至上

- ✅ 在独立 git 分支上工作，不影响主分支
- ✅ 从不自动合并，始终需要人工审查
- ✅ 使用你自己的 API key，成本可控
- ✅ 本地运行，代码不经过第三方服务器

---

## 工作原理

### 架构图

```
检测过时依赖 → 创建 git 分支 → 基线测试
    ↓
升级依赖 → 运行测试
    ↓
测试失败？
    ├─ Yes → AI 修复循环
    │         ├─ 读取错误日志
    │         ├─ 获取 changelog
    │         ├─ LLM 分析并编辑代码
    │         ├─ 重新运行测试
    │         └─ 循环直到通过或达到最大轮次
    │
    └─ No → 静态分析验证
              ├─ TypeScript 类型检查
              ├─ ESLint
              ├─ 变更检测
              └─ (可选) Docker 沙盒 + 性能检测
                    ↓
                  提交 & 生成 PR
```

### 修复循环详解

AI agent 可以使用这些工具：

- `read_file`: 读取源代码
- `write_file`: 修改源代码
- `run_check`: 运行构建和测试
- `list_files`: 探索项目结构

典型的修复流程：

1. **Round 1**: Agent 读取错误信息，发现 `ReactDOM.render is not a function`
2. **Round 2**: Agent 获取 React 19 changelog，了解需要改用 `createRoot`
3. **Round 3**: Agent 读取 `src/index.tsx`，理解当前用法
4. **Round 4**: Agent 修改代码，将 `ReactDOM.render` 替换为 `createRoot`
5. **Round 5**: Agent 运行测试，验证修复
6. **Round 5**: ✅ 测试通过，修复完成

---

## 快速开始

### 安装

无需安装，直接使用 `npx`：

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# 升级指定依赖
npx greenbump react

# 升级到特定版本
npx greenbump eslint --to 9.15.0

# 自动选择最过时的依赖
npx greenbump

# 扫描模式（只查看，不升级）
npx greenbump --scan
```

### 使用其他 AI 模型

```bash
# 使用 OpenAI
npx greenbump react --provider openai --model gpt-4

# 使用 DeepSeek（更便宜）
npx greenbump react --provider deepseek --model deepseek-chat

# 使用 Groq（更快）
npx greenbump react --provider groq --model llama-3.1-70b
```

### 批量升级

```bash
# 升级所有过时的依赖
npx greenbump --all

# 将多个依赖组合到一个 PR
npx greenbump react react-dom --group react-upgrade
```

### GitHub Action

在 `.github/workflows/greenbump.yml` 中：

```yaml
name: greenbump
on:
  schedule:
    - cron: "0 6 * * 1" # 每周一早上 6 点
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: shidesheng0218/greenbump@v0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

每周自动运行，升级依赖并创建 PR！

---

## 适用场景

### ✅ 适合的场景

- **Minor/Patch 升级**：小的破坏性变更（重命名、函数签名调整）
- **有完善测试的项目**：greenbump 只能修复测试能捕获的问题
- **TypeScript 项目**：类型检查能提前发现大部分问题
- **常见框架升级**：React、Vue、Angular 等有详细 changelog 的框架

### ⚠️ 需谨慎的场景

- **Major 版本跨越**：架构级变更（如 Angular 2 → 3）
- **安全补丁**：需要人工审查修复方案，不能只看测试通过
- **没有测试的项目**：greenbump 无法验证修复是否正确

### ❌ 不推荐的场景

- **框架迁移**：如从 Webpack 迁移到 Vite
- **运行时才出现的问题**：测试覆盖不到的场景

**最佳实践**：将 greenbump 作为第一轮自动修复工具，但始终要人工 review PR diff，尤其是涉及安全、数据处理的依赖。

---

## 成本分析

### Token 使用

一次典型的升级修复：

- **简单修复**（1-2 文件）: ~40k tokens input, ~3k tokens output ≈ **$0.15**
- **中等修复**（3-5 文件）: ~80k tokens input, ~8k tokens output ≈ **$0.30**
- **复杂修复**（10+ 文件）: ~200k tokens input, ~20k tokens output ≈ **$0.80**

使用 DeepSeek 可以将成本降低 **10 倍**！

### 时间节省

- 人工修复平均耗时：**1-3 小时**
- greenbump 自动修复：**30 秒 - 5 分钟**
- **时间节省：95%+**

如果按时薪 $50 计算，节省 2 小时 = **$100**，而 greenbump 成本仅 **$0.15-0.80**。

**ROI: 125x - 666x** 🚀

---

## 与其他工具对比

| 特性 | greenbump | Dependabot | Renovate | Migratowl |
|------|-----------|------------|----------|-----------|
| **自动修复破坏性变更** | ✅ | ❌ | ❌ | ✅ |
| **多生态系统** | ✅ (20+) | ✅ | ✅ | ❌ (仅 Python) |
| **模型灵活性** | ✅ (Claude/OpenAI/DeepSeek/自定义) | N/A | N/A | ❌ (仅 Claude) |
| **静态分析验证** | ✅ (TypeScript + ESLint) | ❌ | ❌ | ❌ |
| **Docker 沙盒** | ✅ | ❌ | ❌ | ✅ |
| **数据库测试** | ✅ (Postgres/MySQL/Redis/Mongo) | ❌ | ❌ | ❌ |
| **性能检测** | ✅ | ❌ | ❌ | ❌ |
| **成本模型** | 按使用付费 | 免费 | 免费 | 按使用付费 |

**greenbump 的独特优势**：

- ✅ **唯一同时支持多生态 + 代码修复 + 模型选择**的工具
- ✅ Dependabot/Renovate 擅长检测，但不修复
- ✅ Migratowl 能修复，但仅限 Python 且模型固定
- ✅ greenbump 兼顾两者优势，并提供更多验证层

---

## 实战演示

### Demo 1: 基础升级流程

![基础升级演示](https://github.com/shidesheng0218/greenbump/raw/master/docs/assets/demo-basic.gif)

### Demo 2: 沙盒模式 + 数据库

![沙盒模式演示](https://github.com/shidesheng0218/greenbump/raw/master/docs/assets/demo-sandbox.gif)

---

## 路线图

- [x] **v0.1.0**: 核心修复循环 + 多生态支持
- [x] **v0.2.0**: 批量升级、changelog 集成
- [x] **v0.3.0**: 静态分析（TypeScript + ESLint）+ 变更检测
- [x] **v0.4.0**: 多阶段修复策略 + 依赖图分析
- [x] **v0.5.0**: Docker 沙盒 + 数据库测试 + 性能回归检测
- [ ] **v0.6.0**: Web UI 监控面板
- [ ] **v0.7.0**: 升级影响预测（运行前）
- [ ] **v0.8.0**: 自定义验证脚本
- [ ] **v0.9.0**: 多仓库编排
- [ ] **v1.0.0**: 生产就绪版本

---

## 开源与贡献

greenbump 是 **MIT 开源**项目，欢迎贡献！

**GitHub**: https://github.com/shidesheng0218/greenbump  
**npm**: https://www.npmjs.com/package/greenbump

### 我们需要的帮助

- 🌍 更多生态系统适配器（尤其是小众包管理器）
- 🧪 真实场景的集成测试
- 📚 文档改进
- 🐛 Bug 报告和复现案例

如果 greenbump 帮到了你，欢迎：
- ⭐ 给项目点个 Star
- 🐛 提 Issue 报告问题
- 💡 在 Discussions 分享使用经验
- 🔀 提 PR 贡献代码

---

## 总结

依赖升级本该是一件自动化的事情，但破坏性变更让它变成了「体力活」。

**greenbump 的目标很简单**：让 AI 做这些重复的、机械的修复工作，把你的时间还给真正需要创造力的地方。

试试看吧：

```bash
npx greenbump react
```

30 秒后，你会得到一个绿色的 PR ✅

---

## 相关链接

- 📦 **npm 包**: https://www.npmjs.com/package/greenbump
- 💻 **GitHub 仓库**: https://github.com/shidesheng0218/greenbump
- 📖 **完整文档**: https://github.com/shidesheng0218/greenbump#readme
- 💬 **讨论区**: https://github.com/shidesheng0218/greenbump/discussions
- 🐛 **问题反馈**: https://github.com/shidesheng0218/greenbump/issues

---

**如果你觉得这篇文章有用，欢迎点赞、收藏、分享！** 👍

有任何问题或建议，欢迎在评论区留言讨论 💬
