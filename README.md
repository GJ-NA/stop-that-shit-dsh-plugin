# dsh-stop-that-shit

Stop That Shit（别再造史了）的 **DeepSeek Harness 本地化插件**：把上游 0.2.5 的
DSH Guard 桥接、两套 Skill 和整套判定运行时适配进 `dsh`，并把面向人和面向模型的消息、
Skill 正文翻成中文。已在 **DSH 0.2.1-rc.5 桌面端（`desktop` profile）** 实测运行。

上游项目：<https://github.com/lennney/stop-that-shit> ｜ 版本 `0.2.5` ｜
本仓库：<https://github.com/GJ-NA/stop-that-shit-dsh-plugin> ｜
commit `17ffc9f` ｜ 许可证 MIT

## 它在你这里装了什么

| 层 | 内容 | 位置 |
| --- | --- | --- |
| 插件 | `sts-bridge`：挂 7 个 DSH 事件监听，把契约判定接进工具调用 | `lib/index.cjs` |
| 运行时 | 上游 `src/` 的依赖闭包（18 个文件，中文化） | `src/` |
| Skill | `stop-that-shit`（Stop Ladder 判断规则）、`stss`（去防御性废话） | `skills/` |
| 数据 | 会话契约 + 审计账本（不含代码和对话正文） | `~/.dsh/stop-that-shit/` |

两个 Skill 通过 `ctx.skills.register()` 在插件挂载时注册，装完即可在技能目录里看到，
不需要往 `~/.dsh/skills` 里复制文件。

## 相对上游改了什么（适配清单）

上游 `dsh/` 目录只是一个「开发期挂载」用的桥，直接装不能跑。这里做了四处适配：

1. **依赖路径**：上游 `dsh/lib/bridge.cjs` 用 `require('../../src/adapters/dsh-hooks.cjs')`
   指回仓库根的 `src/`；本包把 `src/` 的闭包 vendoring 进包内，路径改成 `../src/...`，
   包自包含，不依赖上游 checkout。
2. **Skill 注册**：上游只提供 Skill 文件，不注册。这里在 `apply()` 里读包内
   `skills/*/SKILL.md`、拆 frontmatter，注册进 DSH 的 `ctx.skills`（失败只告警，不影响 Guard）。
3. **可停用开关**：patch 里加 `enabled:false` 就能临时停用，不必卸载或改代码。
4. **本地化**：运行时 77 条消息 + 两套 Skill 正文翻成中文，见 [LOCALIZATION.md](LOCALIZATION.md)。

事件契约在两个宿主上逐个核对过：开发期是 **DSH 0.2.2-alpha.2（Web profile）**，
另一次是 **DSH 0.2.1-rc.5（桌面端 `desktop` profile）**。两边的
`dsh-agent`、`dsh-agent-loop`、`dsh-tools/lib/index.js`、`dsh-session`、`dsh-subagent`
的类型声明与实现都一致，差异只在下表最后一列记的两处（均已按实测兼容）：

| DSH 事件 | 适配层事件 | 模式 | 能否拦截 | 桌面端注意 |
| --- | --- | --- | --- | --- |
| `session/created` / `session/disposed` | `session.start` / `session.end` | emit | 否 | 只收到一个 `session` 实参 |
| `agent/pre-step` | `prompt.submit` | waterfall | 可拒绝本步 | 载荷里 `turn` 有、`step` 也有 |
| `tools/pre-execute` | `action.before` | waterfall | 可拒绝调用 | — |
| `tools/post-execute` | `action.after` | waterfall | 仅观测 | — |
| `subagent/start` / `subagent/end` | `subagent.start` / `subagent.stop` | emit | 否 | 只收到扁平 `info`，父会话靠 header 反查 |

`agent/pre-step` 的 `payload.agent` 由 harness 的 `agentEvents().fused()` 注入，
`tools/pre-execute` 的签名是 `(exec, next)`，`subagent/start` 的 run info 是扁平的
`{ runId, provider, id, local }` —— 这三点是桥接能否工作的关键，都已验证。

`subagent/start|end` 的第二个实参是 cordis 的 scope carrier，不是监听器参数
（`createLifecycleEmitter` 里 `callback(info)` 只传一个），所以父会话只能靠
`session.header.parentSession` 反查。`subagent/end` 可能晚于子会话的
`session/disposed`，那时 header 已经查不到 —— 本包为此在内存里缓存
child→parent（LRU 512），查不到就在日志里警告并跳过，不再把账记到空会话上。

## 怎么用

指令必须放在 prompt 的**第一个非空行**，任务正文放在 `--` 之后：

```text
$stop-that-shit review -- 只看这个 diff，报告问题，不要改。
$stop-that-shit change -- 修掉配置读取失败，补齐受影响的调用方和检查。
```

| 指令 | 用途 |
| --- | --- |
| `review` / `answer` / `monitor` | 只读；写文件会被拒 |
| `change` | 允许完成任务需要的修改 |
| `lock change files=a\|b` | 再加硬文件边界，越界写被拒 |
| `change deps=allow` | 放行新增依赖（默认 `ask`） |
| `change hash=allow` | 放行哈希操作（默认 `deny`） |
| `change agents=N` | 并发子代理上限（默认不限，`0` 禁止委派） |
| `status` / `runtime` / `explain evt_…` / `label evt_…` | 查看状态与账本，不改契约 |

装了 Guard **默认不拦**：它从 `unconfirmed` / 只观察起步，只有显式指令才进入 `ARMED`。
所以第一次对话会看到一条中文提示「还没有确认任务模式……」，这是设计，不是故障。

拒绝理由走 DSH 的 `PreToolDecision.deny.reason`，模型能直接看到；被拒绝的 pre-step
只写日志（`PreStepDecision` 没有 reason 字段），这是上游的取舍，不是这里改坏的。

## 已装进哪个 profile

```bash
# 本机已经执行过的安装（桌面端 desktop profile，live 生效，无需重启）
dsh plugin --profile desktop add "file:C:/Users/gjna/.dsh/plugins/dsh-stop-that-shit"
```

装完 profile 的 `package.json` 里会同时出现：

```json
"dependencies": { "dsh-stop-that-shit": "file:C:/Users/gjna/.dsh/plugins/dsh-stop-that-shit" },
"dsh": { "profile": { "bundles": ["…", "dsh-stop-that-shit"] } }
```

`web` profile 同样能装，把 `--profile desktop` 换成 `--profile web` 即可。

换一台机器或换 profile：

```bash
dsh plugin --profile <名字> add "file:<本目录绝对路径>"
```

## 第三方工具的分类白名单

适配层内置了 DSH 自带工具的分类。插件自己注册的工具（`ig5_*`、`acp_*`、`purge_*` ……）
只能落到名字启发式，落到 `unknown` 后，在契约外只是「询问」而不是「拒绝」。
知道自己工具集的部署可以在 patch 里补上：

```yaml
config:
  toolClasses:
    ig5_open: read
    ig5_funcs: read
    "ig5_*": read          # 前缀通配，末尾 * 匹配其余名字
    purge_apply: write
    acp_cache: read
```

值域是 `read` / `write` / `control` / `delegate` / `unknown`，非法项会被忽略并在日志里列出来。
白名单只在**内置显式分类之后、名字启发式之前**查询，所以配置改不动
`write`、`edit`、`bash`、`pwsh`、`run_code` 这些已经明确的分类 —— 防止把写操作配成只读。

## 验证

```bash
node --test tests/bridge.test.cjs   # 9 条：review 拦截、change 放行、files= 边界、
                                    # hash 拦截、子/孙会话按根契约判定、status 中文输出、Skill 注册
node tools/localize.cjs --check     # 本地化表是否仍与 src/ 对得上
```

装上后两种活体验证（本机已完成第一种）：

1. 会话里出现中文的「仅观察模式」上下文提示 —— 说明 `agent/pre-step` 已经接上；
2. 发一条 `$stop-that-shit review -- …`，再让 agent 写文件，会拿到
   `MODE_FORBIDS_MUTATION` 的中文拒绝理由 —— 说明 `tools/pre-execute` 已武装。

## 停用、卸载、更新

```yaml
# cordis.patch.yml：临时停用（不卸载）
config:
  enabled: false
```

```bash
dsh plugin --profile desktop remove dsh-stop-that-shit   # 卸载
```

更新上游：把新版 `src/`、`skills/` 覆盖进来，跑一次 `node tools/localize.cjs`
（表里对不上的条目会列出来，按新版文案补表），再跑测试。

## 数据、隐私与恢复

- `~/.dsh/stop-that-shit/sessions/*.json`：每个会话的契约与委派账本；
- `~/.dsh/stop-that-shit/runtime/*.jsonl`：判定审计（动作名、判定、理由码，不存参数正文）。

**锁文件损坏**（`STS_LOCK_DAMAGED`）：先把所有使用该数据目录的 dsh 进程停掉，再只把
`.lock` 文件移走，保留 `sessions/` 与账本。**状态损坏**（`STATE_DAMAGED`）：用备份恢复
或换新会话，不要清掉未结的委派记录。

## 已知限制

- 只做 DeepSeek Harness 适配；上游的 Codex / Claude Code / OpenCode / Pi / Hermes 适配器没有移植，
  也删掉了 `codex-tool-classifier` 之外的其它 host 文件。
- 守卫是**护栏不是沙箱**：宿主最终有没有执行动作，适配层记为 `hostEffect: unobserved`；
  真正的隔离靠 DSH 自己的 sandbox / permission。
- 工具分类对第三方插件注册的工具只能靠名字启发式，未配置白名单时会落 `unknown`；
  要让它按契约拒绝而不只是询问，得按上面「第三方工具的分类白名单」补声明。
- `agent/pre-step` 不处理子会话（`header.parentSession` 存在时直接放行）：
  委派出去的子代理不参与 prompt 级判定，工具级判定仍按其根会话契约生效。
- 审计账本不存代码与对话正文，但会存路径与关联 ID；要分享前先自己看一眼。
- `skills/stss/references/examples.md` 保留上游英文原样（它本身就是英文写作的成对案例）。
