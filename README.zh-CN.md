# 🌱 greenbump

[English](README.md) | 简体中文

**真正能修复代码的依赖升级工具。**

Dependabot 和 Renovate 只会升级版本号，然后给你一个失败的 PR 就不管了。greenbump 不仅升级依赖，**还会让 AI 智能体修复升级导致的代码问题**，在你真实的构建和测试上循环迭代，直到**全部通过**。

```bash
npx greenbump react
```

```
🌱 greenbump
  · 目标：react 18.3.1 → 19.2.0
  · 创建分支 greenbump/react-19.2.0
  · 运行基准构建和测试…
  · 安装 react@19.2.0…
  · 升级破坏了测试 — 启动 AI 修复循环
  · 第 1 轮：read_file src/App.tsx
  · 第 2 轮：write_file src/App.tsx
  · 第 3 轮：run_check
  · ✓ 所有检查通过
  · 已提交修复，推送到远程
```

---

## 特性

- **自动修复破坏性变更** — AI 智能体读取错误日志，编辑代码，重新运行测试，直到通过
- **支持 20+ 包管理器** — npm、yarn、pnpm、cargo、pip、poetry、go mod、maven、gradle 等
- **GitHub Actions 集成** — 在 CI 中作为 scheduled workflow 运行，自动创建 PR
- **完整可见性** — 每一轮都显示智能体调用的工具和令牌使用量
- **可配置** — 设置最大修复轮数、选择 AI 模型、限制令牌预算

---

## 快速开始

### CLI 使用

```bash
# 升级 React 到最新版本
npx greenbump react

# 升级多个依赖
npx greenbump react typescript @types/react

# 指定目标版本
npx greenbump lodash@4.17.21

# 使用不同的 AI 模型
npx greenbump --provider openai --model gpt-4o react
```

**需要 API 密钥：**
- Anthropic（默认）：`export ANTHROPIC_API_KEY=sk-ant-...`
- OpenAI：`export OPENAI_API_KEY=sk-...`

### GitHub Actions

创建 `.github/workflows/greenbump.yml`：

```yaml
name: greenbump
on:
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨 2 点
  workflow_dispatch:

jobs:
  upgrade:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: shidesheng0218/greenbump@v0
        with:
          packages: 'react typescript lodash'
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

在仓库设置中添加 `ANTHROPIC_API_KEY` secret。

---

## 工作原理

1. **检测生态系统** — 自动识别 package.json、Cargo.toml、go.mod 等
2. **运行基准测试** — 在升级前运行构建和测试，确保它们通过
3. **升级依赖** — 安装目标版本
4. **检查是否破坏** — 重新运行测试，如果失败则启动 AI 修复循环
5. **AI 修复循环** — 智能体可以：
   - `read_file` — 读取源代码和错误日志
   - `write_file` — 编辑代码文件
   - `run_check` — 重新运行构建和测试
   - 循环直到所有检查通过或达到最大轮数
6. **提交并推送** — 创建描述性提交信息和 PR 正文

---

## CLI 选项

```
npx greenbump [选项] <包名...>

选项：
  --provider <名称>        AI 提供商：anthropic | openai（默认：anthropic）
  --model <名称>           模型名称（默认：claude-3-7-sonnet-20250219）
  --max-rounds <数字>      每个包的最大修复轮数（默认：15）
  --max-total-tokens <数字> 令牌预算限制（可选）
  --no-push               本地提交但不推送到远程
  --help                  显示帮助信息
```

---

## 支持的包管理器

| 生态系统 | 清单文件 | 安装命令 |
|---------|---------|---------|
| **JavaScript** | package.json | npm/yarn/pnpm/bun |
| **Python** | requirements.txt, pyproject.toml | pip/poetry/pipenv/uv |
| **Rust** | Cargo.toml | cargo |
| **Go** | go.mod | go get |
| **Java** | pom.xml, build.gradle | mvn/gradle |
| **Ruby** | Gemfile | bundler |
| **PHP** | composer.json | composer |
| **Dart** | pubspec.yaml | pub/flutter |
| **Swift** | Package.swift | swift |
| **Elixir** | mix.exs | mix |
| **Elm** | elm.json | elm |
| **C#** | *.csproj | dotnet |
| **C++** | conanfile.txt | conan |
| **iOS** | Podfile | pod |

每个适配器实现：
- `detect()` — 查找清单文件
- `outdated()` — 检查可用更新
- `install()` — 安装特定版本

---

## 贡献

欢迎提交 Issue 和 Pull Request！

查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解：
- 如何设置开发环境
- 如何添加新的包管理器支持
- 代码风格指南
- 如何运行测试

---

## 安全

如果你发现安全漏洞，请查看 [SECURITY.md](SECURITY.md) 了解如何负责任地报告。

**关键安全边界：**
- AI 智能体只能访问项目目录内的文件（路径遍历保护）
- 所有文件操作都经过 `safePath()` 验证
- 智能体不能执行任意 shell 命令
- 发送给 AI 提供商的数据：错误日志、差异、文件内容（不包含 secrets）

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

## 常见问题

**Q: greenbump 和 Renovate/Dependabot 有什么区别？**

A: Renovate 和 Dependabot 只升级版本号。如果升级破坏了代码（例如 API 变更），它们会创建一个失败的 PR，由你来修复。greenbump 使用 AI 智能体自动修复破坏性变更，循环运行测试直到通过。

**Q: AI 修复需要多长时间？**

A: 取决于破坏的复杂度。简单的 API 重命名通常 1-2 轮（30-60 秒）。复杂的架构变更可能需要 5-10 轮（2-5 分钟）。你可以用 `--max-rounds` 限制。

**Q: 费用是多少？**

A: 使用你自己的 API 密钥，按 AI 提供商的定价付费。典型的修复消耗 10k-50k tokens（Claude Sonnet 约 $0.15-$0.75）。可以用 `--max-total-tokens` 设置预算上限。

**Q: 支持私有包吗？**

A: 支持。greenbump 使用你本地的包管理器配置，如果 `npm install` 能访问你的私有 registry，greenbump 也能。

**Q: 能修复所有破坏性变更吗？**

A: 不能保证。AI 能处理大多数常见的 API 变更、导入重命名、配置更新等。对于需要深度架构改动的变更可能会达到 `--max-rounds` 限制。你总是可以在智能体的工作基础上继续手动修复。

**Q: 安全吗？**

A: 智能体被限制在项目目录内，不能执行任意命令。但它**会修改你的代码**，所以：
- 在干净的 git 工作树上运行（有未提交的变更会被拒绝）
- 审查修复后的 PR 再合并
- 在非关键分支上先测试
- 查看 [SECURITY.md](SECURITY.md) 了解完整的安全模型

---

## 反馈

遇到问题或有建议？请在 [GitHub Issues](https://github.com/shidesheng0218/greenbump/issues) 提交。

开发者：[@shidesheng0218](https://github.com/shidesheng0218)
