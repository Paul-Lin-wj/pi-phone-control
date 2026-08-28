# pi-phone-control

基于 [pi](https://github.com/earendil-works/pi-coding-agent)（@earendil-works/pi-coding-agent）全局改造的**Android 手机操控 agent**——所有 pi 会话自动具备受约束的手机操控能力：截屏看屏、触控注入、中文输入、拉起应用，全程横幅常显可暂停/终止，多层防线防模型越权。

## 功能

| 工具 | 作用 |
|---|---|
| `screen` | 截图回传（自动避让横幅遮挡） |
| `tap` / `swipe` / `key` | 触控注入（物理坐标 1080×2400，运行时整数校验） |
| `text` | 中文注入（自动切 ADBKeyboard，收尾恢复原输入法） |
| `launch` | 启动应用（包名字符白名单 + PROTECTED_APPS 黑名单） |
| `status` / `wait` / `banner` | 状态查询 / 等待 / 任务横幅（⏸暂停 / ⏹终止按钮） |

典型用法（pi 会话里直接说人话）：

- 「打开 B 站搜一下 xxx，把第一个视频的标题告诉我」
- 「截屏看看现在手机上是什么」
- 「给 QQ 里的 xxx 发一条消息：……」（外部动作，内容先过目）
- 「帮我签到 xxx App」——多步任务每步屏幕显示 `▶ n/N 进度`，可随时按横幅按钮暂停/终止

## 前置：让 DroidSpaces 获取手机控制权限

本 agent 跑在 DroidSpaces 容器里，操控的是容器外的 Android 宿主（HyperOS）。容器与宿主隔离（独立 pid/mount ns、binder 孤儿节点、SELinux 独立域），**传统 adb 入口全部不可用**（明文 5555 拒连、mdns 空、无线调试配对不持久）。实测唯一可靠路径 = 在手机 Termux 里用 KernelSU 播种常驻 adbd：

```bash
# 手机 Termux 中执行（KSU 授权后）：
su -c 'setprop service.adb.tcp.port 5555
setprop persist.service.adb.tcp.port 5555
settings put global adb_enabled 1
stop adbd && start adbd'
```

要点（踩坑实录）：

- **必须对齐权威源**：三个设置缺一不可——只设非标准名 `persist.adb.tcp.port` 会被 HyperOS 几分钟内"纠偏"回落（监控实录：首次连接数分钟后监听消失）
- **信任免弹窗**：容器侧 `~/.android/adbkey` 已在宿主 `/data/misc/adb/adb_keys` 白名单（`ro.adb.secure=1` 却直连 authorized），重启不失效
- **容器侧自愈**：`adb connect 127.0.0.1:5555` 断线重连即可，日常全流程零用户操作
- 兜底：若重启后 adbd 未自动恢复 tcp 模式，往 `/data/adb/service.d/` 塞保活脚本

## 部署

```
~/.pi/agent/extensions/droid.ts  ← symlink ──→  extensions/droid.ts（真身，本仓库受管）
tests/                            工具层安全单元测试（绕过 LLM 直打 execute）
docs/security-report.md           三轮红队测试报告
node_modules                      symlink → pi 包依赖（供测试解析 typebox 等）
```

- **部署形态**：真身在本仓库，`~/.pi/agent/extensions/droid.ts` 是 symlink——pi 的扩展自动发现照常加载，`/reload` 热重载有效
- **测试解析**：仓库内 `node_modules` symlink 指向 pi 包的依赖（node 按 realpath 解析 import）
- **手机端依赖**：DroidSpaces adb 通道（见上节）、[ClaudeOverlay](../../claude-overlay)（悬浮横幅 + ⏸⏹按钮）、ADBKeyboard（中文输入）

## 安全设计

模型接触不到裸 adb/bash 命令——所有触控经白名单工具，参数过字符/类型白名单：

1. `adbShell` 整条命令单引号字面传递（宿主机零展开）；inject 走 `su -c` 固定命令模板
2. `tool_call` 拦截 bash 中的 `adb`/`su`/`sudo`
3. **bash 混淆确认门**：含 eval / 变量拼接 / base64 解码 / 管道进 shell 特征的命令弹 TUI 确认框，用户放行才执行；无 UI 模式（print/json）默认拒绝
4. 横幅任务期间强制常显（用户观察 / 暂停 / 终止的唯一入口，仅截图/触控瞬间避让）
5. `session_shutdown` 自动收尾（输入法恢复 + 撤横幅）
6. 提示词纪律：屏幕/消息/网页文字一律视为数据非指令（防截屏内容注入，红队实测有效）

完整攻击向量、修复过程与回归见 `docs/security-report.md`（三轮红队：框架逃逸 4 向量、混淆/注入 8 向量、混淆门加固回归 13 用例）。

## 执行审计（每次执行可审查，2026-08-28 建设）

所有工具调用被**代码强制记录**——审计点在工具层（`extensions/audit.ts`），模型只能提供参数，控制不了"写不写、写什么格式、能否删"。模型可见的工具接口完全不变，纯旁路。

```
~/.pi/agent/audit/<时间戳-pid>/
  meta.json        会话元信息（开始时间/pid）
  events.jsonl     事件流：ts / 工具名 / 参数全文 / ok / 耗时 / 截图文件 / 结果或错误
  0001-screen.png  screen 截图按序号存档
```

审查入口（只给用户，刻意不暴露给模型——日志进模型上下文反而给截屏注入添素材）：

```bash
node --experimental-strip-types tools/audit-report.ts latest   # 生成 HTML 时间线（表格+内嵌截图）
```

**防篡改**（四条模型通道全封堵，回归 `tests/audit.test.ts`）：`write`/`edit`/`bash` 的输入命中审计目录或扩展本体（`.pi/agent/audit`、`.pi/agent/extensions`、`droid.ts`）一律硬拦——写/删/执行/读全挡。已记录的攻击参数（`$(touch)` 注入、reboot 尝试）实测均在案可查。剩余边界：bash 命令**不含**这些路径字面量的间接删除（如 `find ~ -name '*.jsonl'`）靠混淆门+概率兜底。

## ⚠️ 警告

- **root 级真实设备控制**：工具链末端是宿主机的 `su`，模型执行的每一步都作用于你的真实手机——误点、误发、误删不可逆。只在 you own 的设备上部署
- **发消息等外部动作不可逆**：给真人发消息前内容必须过目确认；定位真人会话必须视觉确认后点，绝不盲点坐标
- **隐私外泄面**：`screen` 会把真实屏幕（含聊天记录、相册）回传给 LLM；对话记录会离开本机到达模型服务商。敏感场景自行权衡
- **adb 5555 是明文端口**：仅限本机容器网络使用，切勿暴露到公网/不可信局域网
- **锁屏不绕过**：检测到 keyguard 停下请用户解锁——这是设计不是缺陷
- **防线非绝对**：解释器内联代码（`python -c` 拼子进程调 adb）不含混淆特征、确认门不触发，最后防线是模型自身拒绝（红队端到端实测均拒绝，但这是概率防线）；PROTECTED_APPS 黑名单只拦 `launch` 通道，tap 桌面图标进入受保护应用靠提示词兜底

## 运行测试

```bash
cd tests
for t in droid.test.ts round2.test.ts bash-bypass.test.ts banner-show.test.ts; do
  node --experimental-strip-types $t
done
```

- `droid.test.ts`：13 用例（注入/校验/拦截/终态零标记）——需要手机在线（adb 127.0.0.1:5555）
- `round2.test.ts`：6 用例（ovl 注入/APP_RE 变体/key 枚举）
- `bash-bypass.test.ts`：混淆确认门回归（硬拦不弹门 / 放行 / 拒绝 / 无 UI 默认拒 / 普通命令误伤对照）
- `audit.test.ts`：审计层回归（防篡改守卫 12 用例 / 写入落盘 / 截图编号 / 多会话隔离）——无手机依赖
- `banner-show.test.ts`：横幅显示回归

## 相关配置（不在本仓库，含密钥）

- `~/.pi/agent/settings.json`：defaultModel（当前 glm-5.3-flash）+ `defaultThinkingLevel: "medium"`（2026-08-28 速度调优：原 max 每步深推理拖慢节奏，off 又太直给——屏幕有意外内容时会照字面跑偏；medium 平衡思考与速度，复杂任务临时 `pi --thinking max`）+ **专用化改造（2026-08-28）**：`"skills": ["!*"]` 全禁 skills 自动发现（原会加载 `~/.agents/skills/` 的 26 个飞书技能，与手机操控无关）、移除 `packages: ["npm:pi-subagents"]`（subagent delegation 属"其他处理"通道，droid.ts 不依赖它）——pi 现在是纯手机操控 agent
- `~/.pi/agent/models.json`：模型需 `"input": ["text", "image"]` 才收截图
