# pi-agent

基于 [pi](https://github.com/earendil-works/pi-coding-agent)（@earendil-works/pi-coding-agent）全局改造的**手机操作 agent**——所有 pi 会话自动具备受约束的手机操控能力。

## 架构与部署

```
~/.pi/agent/extensions/droid.ts  ← symlink ──→  extensions/droid.ts（真身，本仓库受管）
tests/                            工具层安全单元测试（绕过 LLM 直打 execute）
docs/security-report.md           两轮红队测试报告
node_modules                      symlink → pi 包依赖（供测试解析 typebox 等）
```

- **部署形态**：真身在本仓库，`~/.pi/agent/extensions/droid.ts` 是 symlink——pi 的扩展自动发现照常加载，`/reload` 热重载有效
- **测试解析**：仓库内 `node_modules` symlink 指向 pi 包的依赖（node 按 realpath 解析 import）

## 工具面（白名单）

| 工具 | 作用 |
|---|---|
| `screen` | 截图回传（自动避让横幅遮挡） |
| `tap` / `swipe` / `key` | 触控（物理坐标 1080×2400，运行时整数校验） |
| `text` | 中文注入（自动切 ADBKeyboard，收尾恢复） |
| `launch` | 启动应用（包名字符白名单 + PROTECTED_APPS 黑名单） |
| `status` / `wait` / `banner` | 状态查询 / 等待 / 任务横幅 |

约束机制：模型接触不到裸 adb/bash 命令；`adbShell` 整条命令单引号字面传递（宿主机零展开）；inject 走 `su -c`（固定命令模板）；`tool_call` 拦截 bash 中的 adb/su/sudo；横幅任务期间强制常显（用户暂停/终止的唯一入口，仅截图/触控瞬间避让）；`session_shutdown` 自动收尾（输入法恢复 + 撤横幅）。

## 运行测试

```bash
cd tests
for t in droid.test.ts round2.test.ts bash-bypass.test.ts banner-show.test.ts; do
  node --experimental-strip-types $t
done
```

- `droid.test.ts`：13 用例（注入/校验/拦截/终态零标记）——需要手机在线（adb 127.0.0.1:5555）
- `round2.test.ts`：6 用例（ovl 注入/APP_RE 变体/key 枚举）
- `bash-bypass.test.ts`：bash 拦截的混淆边界（输出当前行为的对照）
- `banner-show.test.ts`：横幅显示回归

## 相关配置（不在本仓库，含密钥）

- `~/.pi/agent/settings.json`：defaultModel=Linapi/glm-5.3-flash
- `~/.pi/agent/models.json`：glm-5.3-flash 需 `"input": ["text", "image"]` 才收截图
- 手机端依赖：DroidSpaces adb 通道、ClaudeOverlay（横幅+⏸⏹按钮）、ADBKeyboard

## 已知边界

- bash 拦截是命令文本正则（`\badb\b`/`\bsu\b`/`\bsudo\b`），对变量拼接/base64 管道等混淆放行——防线依赖模型自身拒绝（实测两轮均拒绝）；可选加固见 docs/security-report.md
- PROTECTED_APPS 黑名单只拦 `launch` 通道，tap 桌面图标进入受保护应用无硬拦（提示词 + 横幅兜底）
- 详细红队过程与修复记录见 `docs/security-report.md`
