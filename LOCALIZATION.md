# 本地化说明

只翻「人/模型会读到的句子」，**不动**代码路径、变量名、`reasonCode`、协议字段、
指令关键字与命令名。改动用 `tools/localize.cjs` 里的表驱动完成，可重放、可检查。

## 范围

| 文件 | 条数 | 内容 |
| --- | --- | --- |
| `src/contracts.cjs` | 6 | 指令解析错误、`DIRECTIVE_NOT_ARMED` 警告 |
| `src/control-protocol.cjs` | 9 | shell / git 只读分析原因 |
| `src/decision.cjs` | 33 | 每条判定的解释与「下一步」建议 |
| `src/controller.cjs` | 22 | 契约上下文、`status`/`runtime`/`explain` 输出、拒绝消息 |
| `src/state.cjs` + `src/state-schema.cjs` | 6 | 锁损坏 / 状态损坏的恢复说明 |
| `src/adapters/dsh-hooks.cjs` | 3 | 根会话不可验证时的拒绝理由 |
| 合计 | **77** | |

另外两套 Skill 的正文（`skills/stop-that-shit/SKILL.md`、`skills/stss/SKILL.md`）
整篇译成中文，并把上游给 Claude Code / Codex 的调用示例改成 DSH 的
`$stop-that-shit …` 形式。

## 刻意保留英文的部分

- `reasonCode`（`MODE_FORBIDS_MUTATION`、`PATH_OUTSIDE_CONTRACT`…）：审计与
  `explain` 会按它检索，翻译会让账本不可比对。
- 指令与字段名（`review`、`change`、`agents=`、`files=`、`hash=`、`deps=`）、
  查询命令（`status`、`runtime`、`explain`、`label`）：解析器按这些词匹配。
- `Stop Ladder`、`Guard`、`Claim Ledger` 等术语：保留英文并在中文里括注，避免自造译名。
- `codex-tool-classifier.cjs` 里的内部 `TypeError` 文案：属于编程错误，不是用户消息。

## 复核与更新

```bash
node tools/localize.cjs --check   # 逐条核对表里的英文是否还在
node tools/localize.cjs           # 就地应用（幂等）
```

上游升级后若某条文案变了，脚本会把它列为「未命中」，按新版句子补表即可。
