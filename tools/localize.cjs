'use strict';

/**
 * tools/localize.cjs —— 把 vendored 运行时里的「面向人/面向模型」的英文字符串
 * 换成中文。只改字符串字面量，不改代码路径、变量名、reason code 与协议字段。
 *
 * 用法：
 *   node tools/localize.cjs           # 就地应用（幂等：已翻译的条目自然匹配不到，会跳过）
 *   node tools/localize.cjs --check   # 只检查还剩多少未翻译的英文条目
 *
 * 上游升级流程：把新版本的同名文件覆盖进 src/，跑一次本脚本；表里匹配不到原有
 * 英文的条目会在输出里列出来，按新版本文案补表即可。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** [文件, 原文, 译文]；原文必须在文件里出现，否则报未命中（方便发现上游改文案）。 */
const TABLE = [
  // ---- contracts.cjs：指令解析 ----
  ['src/contracts.cjs',
    '`Conflicting values for ${field}. Submit one value per directive field.`',
    '`字段 ${field} 出现了冲突值。每个指令字段只给一个值。`'],
  ['src/contracts.cjs',
    'message: `${rawToken} must be a non-negative safe integer.`',
    'message: `${rawToken} 必须是非负的安全整数。`'],
  ['src/contracts.cjs',
    "'Use agents=N to set the maximum number of concurrently active subagents.'",
    "'用 agents=N 设置同时活跃的子代理上限。'"],
  ['src/contracts.cjs',
    "'Unknown directive field. Put task text after -- or on the next line.'",
    "'无法识别的指令字段。任务正文请放在 -- 之后或下一行。'"],
  ['src/contracts.cjs',
    'message: `${token} must be a non-negative safe integer.`',
    'message: `${token} 必须是非负的安全整数。`'],
  ['src/contracts.cjs',
    "'DIRECTIVE_NOT_ARMED: a Stop That Shit directive was not applied because it does not start the first non-empty line of the received prompt. Send the directive first in a separate message and check $stop-that-shit status before continuing.'",
    "'DIRECTIVE_NOT_ARMED: 这条 Stop That Shit 指令没有生效，因为它不在收到的 prompt 的第一个非空行。请单独发一条消息、把指令放在最前面，并用 $stop-that-shit status 确认状态后再继续。'"],

  // ---- control-protocol.cjs：shell 分析原因 ----
  ['src/control-protocol.cjs',
    "shell_syntax_unproven: 'This shell syntax cannot be confirmed as a static read.'",
    "shell_syntax_unproven: '这种 shell 语法无法被确认为静态读取。'"],
  ['src/control-protocol.cjs',
    "shell_command_unproven: 'This program is not a supported read-only command.'",
    "shell_command_unproven: '该程序不是受支持的只读命令。'"],
  ['src/control-protocol.cjs',
    "shell_execution_option: 'This ripgrep option can execute another program.'",
    "shell_execution_option: '这个 ripgrep 选项可以执行另一个程序。'"],
  ['src/control-protocol.cjs',
    "option_value_missing: 'A required command option value is missing.'",
    "option_value_missing: '缺少必需的选项值。'"],
  ['src/control-protocol.cjs',
    "git_arguments_unproven: 'This Git subcommand or argument form is not supported as a read.'",
    "git_arguments_unproven: '这个 Git 子命令或参数形式不被支持为只读操作。'"],
  ['src/control-protocol.cjs',
    "native_quotes_unproven: 'Native argument passing can reinterpret these embedded quotes.'",
    "native_quotes_unproven: '原生命令行传参可能重新解释这些内嵌引号。'"],
  ['src/control-protocol.cjs',
    "native_empty_arguments: 'Dropping empty native arguments exposes a different operation.'",
    "native_empty_arguments: '丢弃空的原生参数会变成另一个操作。'"],
  ['src/control-protocol.cjs',
    "shell_redirection: 'This command redirects output and may write a file.'",
    "shell_redirection: '该命令重定向输出，可能写文件。'"],
  ['src/control-protocol.cjs',
    "git_output_file: 'This Git command requests an output file.'",
    "git_output_file: '该 Git 命令要求产出文件。'"],

  // ---- state-schema.cjs / state.cjs：损坏恢复 ----
  ['src/state-schema.cjs',
    "message: 'The saved control state cannot be read. Read-only recovery is active; restore the state from a known-good backup or start a new host session. The damaged file has been preserved.'",
    "message: '已保存的控制状态无法读取。当前进入只读恢复：请用已知可用的备份恢复，或开一个新的宿主会话；损坏文件已保留。'"],
  ['src/state.cjs',
    '`The legacy session lock "${path.basename(file)}" has no valid owner. `',
    '`旧版会话锁 "${path.basename(file)}" 没有有效持有者。`'],
  ['src/state.cjs',
    "+ 'Read-only recovery is active; the lock and saved state are preserved. '",
    "+ '当前进入只读恢复；锁文件与已保存状态都会保留。'"],
  ['src/state.cjs',
    "+ 'Start a new host session and submit a new contract, or stop every host process using this data directory '",
    "+ '请开一个新的宿主会话并重新提交契约；或者先停掉所有使用该数据目录的宿主进程，'"],
  ['src/state.cjs',
    "+ 'before moving only this lock file aside. Keep the saved state and delegation records. '",
    "+ '再只把这一把锁文件移走。已保存的契约与委派记录必须保留。'"],
  ['src/state.cjs',
    "+ 'See INSTALL.md#recover-a-damaged-legacy-session-lock.'",
    "+ '处理步骤见本插件 README 的「锁文件损坏」一节。'"],

  // ---- adapters/dsh-hooks.cjs：根会话不可验证 ----
  ['src/adapters/dsh-hooks.cjs',
    "reason: 'Delegated tool call has no verified root session. '",
    "reason: '委派的工具调用找不到可验证的根会话。'"],
  ['src/adapters/dsh-hooks.cjs',
    "+ 'Pass context.rootSessionId from the parent session; the session header '",
    "+ '请从父会话传入 context.rootSessionId；会话 header '"],
  ['src/adapters/dsh-hooks.cjs',
    "+ 'names only the immediate parent, so one hop is not enough to reach the root.'",
    "+ '只记录直接父会话，跨一级不足以到达根会话。'"],

  // ---- controller.cjs：契约上下文与状态输出 ----
  ['src/controller.cjs',
    "return `mode=${contract.mode}; agents=${summary.reservedUpperBound}/${limit} reserved${summary.unresolvedReasons.length ? '; count unproven' : ''}; hash=${contract.hashPolicy || 'deny'}; deps=${contract.dependencyPolicy || 'ask'}; files=${Array.isArray(contract.allowedPaths) ? contract.allowedPaths.join('|') : 'unbounded'}.`;",
    "return `mode=${contract.mode}; agents=${summary.reservedUpperBound}/${limit} 已预留${summary.unresolvedReasons.length ? '; 计数未证实' : ''}; hash=${contract.hashPolicy || 'deny'}; deps=${contract.dependencyPolicy || 'ask'}; files=${Array.isArray(contract.allowedPaths) ? contract.allowedPaths.join('|') : '无边界'}.`;"],
  ['src/controller.cjs',
    "'STATE_DAMAGED: the saved contract is unavailable. Read-only recovery is active. Restore a known-good backup or start a new host session; the damaged file is preserved.'",
    "'STATE_DAMAGED: 已保存的契约不可用，当前进入只读恢复。请用已知可用的备份恢复，或开一个新的宿主会话；损坏文件已保留。'"],
  ['src/controller.cjs',
    "directiveWarning && directiveWarning.message ? `Warning: ${directiveWarning.message}` : null,\n      'Stop That Shit is disabled for this session. No plugin decision is being enforced.'",
    "directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,\n      '本会话的 Stop That Shit 已停用，插件不做任何强制决策。'"],
  ['src/controller.cjs',
    "directiveWarning && directiveWarning.message ? `Warning: ${directiveWarning.message}` : null,\n      'Stop That Shit is in watch-only mode because no task mode is confirmed.',\n      'Use $stop-that-shit review for read-only work, or change for implementation. The default fast path relies on the Stop Ladder and does not claim a full machine contract.',\n      'Do not claim that mutations are being blocked until a mode is confirmed.'",
    "directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,\n      '还没有确认任务模式，Stop That Shit 处于仅观察模式。',\n      '只读工作用 $stop-that-shit review，要改代码用 change。默认快路径只依赖 Stop Ladder，不宣称完整机器契约。',\n      '模式确认之前，不要说「写操作正在被拦截」。'"],
  ['src/controller.cjs',
    "directiveWarning && directiveWarning.message ? `Warning: ${directiveWarning.message}` : null,\n    `Stop That Shit (${phase}): ${contractFields(contract, inspectDelegation(delegation))}`,\n    'Stop Ladder: Is it requested? Is it necessary? What reachable evidence proves that? Would omission fail the current acceptance?',\n    'Report real findings even when implementation is not authorized.',\n    'Before expanding scope, name reachable evidence, failure if omitted, and the fact that changes the next action.',\n    'Harness interception coverage is a guardrail, not a security boundary.'",
    "directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,\n    `Stop That Shit（${phase}）：${contractFields(contract, inspectDelegation(delegation))}`,\n    'Stop Ladder：这是被要求的吗？是必要的吗？有什么可达证据能证明？不做会破坏当前验收吗？',\n    '即使没有改代码的授权，也要报告真实发现。',\n    '扩大范围之前，说清可达证据、不做会怎样失败，以及哪个事实会改变下一步动作。',\n    '宿主拦截覆盖只是护栏，不是安全边界。'"],
  ['src/controller.cjs',
    "? 'Guard returned context; it did not deny the action.'\n      : executionDenial ? 'Guard returned a pre-execution denial.' : 'Guard returned permission deny.',\n    `Reason: ${result.reasonCode}`,\n    ...(result.explanation ? [`Detail: ${result.explanation}`] : []),\n    `Code: ${result.family}/${result.reasonCode}`,\n    `State: ${activeControlState(contract)} / ${contract.mode}`",
    "? 'Guard 只返回了上下文，没有拒绝该动作。'\n      : executionDenial ? 'Guard 在执行前返回了拒绝。' : 'Guard 返回了权限拒绝。',\n    `理由: ${result.reasonCode}`,\n    ...(result.explanation ? [`细节: ${result.explanation}`] : []),\n    `代码: ${result.family}/${result.reasonCode}`,\n    `状态: ${activeControlState(contract)} / ${contract.mode}`"],
  ['src/controller.cjs',
    "if (event) lines.push(`Event: ${event.eventId}`);\n  if (result.nextStep) lines.push(`Next: ${result.nextStep}`);",
    "if (event) lines.push(`事件: ${event.eventId}`);\n  if (result.nextStep) lines.push(`下一步: ${result.nextStep}`);"],
  ['src/controller.cjs',
    "'Stop That Shit runtime (host effect remains unobserved)',\n    `Checked actions: ${summary.checkedActions}`,\n    `Context responses: ${summary.contextResponses}`,\n    `Permission-deny responses: ${summary.permissionDenyResponses}`",
    "'Stop That Shit 运行记录（宿主实际效果仍未观测）',\n    `检查动作数: ${summary.checkedActions}`,\n    `上下文响应数: ${summary.contextResponses}`,\n    `权限拒绝响应数: ${summary.permissionDenyResponses}`"],
  ['src/controller.cjs',
    "lines.push(`Execution-denial responses: ${summary.executionDenialResponses}`);",
    "lines.push(`执行拒绝响应数: ${summary.executionDenialResponses}`);"],
  ['src/controller.cjs',
    "`Labels: correct=${labels.correct}; incorrect=${labels.incorrect}; inconclusive=${labels.inconclusive}`,\n    `Damaged records ignored: ${summary.damagedRecords}`",
    "`标注: correct=${labels.correct}; incorrect=${labels.incorrect}; inconclusive=${labels.inconclusive}`,\n    `已忽略的损坏记录: ${summary.damagedRecords}`"],
  ['src/controller.cjs',
    "'Stop That Shit status',\n      `State: ${activeControlState(state.contract)} / ${state.contract.mode}`,\n      contractFields(state.contract, summary),\n      `Authority source: ${state.contract.source || 'unconfirmed'}`",
    "'Stop That Shit 状态',\n      `状态: ${activeControlState(state.contract)} / ${state.contract.mode}`,\n      contractFields(state.contract, summary),\n      `授权来源: ${state.contract.source || 'unconfirmed'}`"],
  ['src/controller.cjs',
    "`Directive error: ${state.directiveError.code}: ${state.directiveError.message}`",
    "`指令错误: ${state.directiveError.code}: ${state.directiveError.message}`"],
  ['src/controller.cjs',
    "? [`Unresolved activity: ${summary.unresolvedReasons.join(', ')}. A confirmed completion or a new host session is required; do not reset the ledger.`] : []),\n      'Host effect: unobserved',\n      'Use runtime for checked-action and Guard-response counts.'",
    "? [`未结活动: ${summary.unresolvedReasons.join(', ')}。需要确认完成，或换一个新的宿主会话；不要重置账本。`] : []),\n      '宿主效果: 未观测',\n      '用 runtime 查看检查动作数与 Guard 响应计数。'"],
  ['src/controller.cjs',
    "return context(`Stop That Shit runtime event not found: ${command.eventId}`);",
    "return context(`未找到 Stop That Shit 运行事件: ${command.eventId}`);"],
  ['src/controller.cjs',
    "? `Stop That Shit label recorded: ${command.eventId} = ${command.label}`\n      : `Stop That Shit could not record label for ${command.eventId}.`",
    "? `已记录标注: ${command.eventId} = ${command.label}`\n      : `无法为 ${command.eventId} 记录标注。`"],
  ['src/controller.cjs',
    "`Stop That Shit event ${found.eventId}`,\n    `State: ${found.controlState.toUpperCase()} / ${found.contract.mode}`,\n    `Action: ${found.action.toolName} (${found.action.mutability}); paths=${found.action.pathCount}`",
    "`Stop That Shit 事件 ${found.eventId}`,\n    `状态: ${found.controlState.toUpperCase()} / ${found.contract.mode}`,\n    `动作: ${found.action.toolName} (${found.action.mutability}); paths=${found.action.pathCount}`"],
  ['src/controller.cjs',
    "? [`Analysis: ${SHELL_ANALYSIS_REASONS[found.action.analysisReason]}`] : []),\n    `Decision: ${found.decision.policyOutcome} / ${found.decision.reasonCode}`,\n    `Response: ${found.decision.responseOutcome}`,\n    `Host effect: ${found.decision.hostEffect}`,\n    `Label: ${found.label || 'unlabeled'}`",
    "? [`分析: ${SHELL_ANALYSIS_REASONS[found.action.analysisReason]}`] : []),\n    `决策: ${found.decision.policyOutcome} / ${found.decision.reasonCode}`,\n    `响应: ${found.decision.responseOutcome}`,\n    `宿主效果: ${found.decision.hostEffect}`,\n    `标注: ${found.label || '未标注'}`"],

  // ---- decision.cjs：判定理由与下一步 ----
  ['src/decision.cjs', "'Read-only recovery remains available.'", "'只读恢复仍然可用。'"],
  ['src/decision.cjs',
    "'Follow the legacy lock recovery steps in INSTALL.md. Keep saved contracts and delegation records.'",
    "'按 README 的旧版锁恢复步骤处理，保留已保存的契约与委派记录。'"],
  ['src/decision.cjs',
    "'Restore the saved state from a known-good backup or start a new host session. Do not clear unresolved delegation records.'",
    "'用已知可用的备份恢复状态，或开一个新的宿主会话；不要清除未结的委派记录。'"],
  ['src/decision.cjs', "'No confirmed enforcing contract is active.'", "'没有已确认的强制契约在生效。'"],
  ['src/decision.cjs',
    "`The active Stop That Shit directive is invalid: ${state.directiveError.message || state.directiveError.code || 'unknown directive error'}.`",
    "`当前 Stop That Shit 指令无效：${state.directiveError.message || state.directiveError.code || '未知指令错误'}。`"],
  ['src/decision.cjs',
    "'Submit a corrected directive for the reported field before delegating.'",
    "'先针对报错字段提交修正后的指令，再委派。'"],
  ['src/decision.cjs',
    "'This adapter has no supported lifecycle declaration, so it cannot prove that delegation and resume actions obey the finite limit.'",
    "'这个适配器没有受支持的生命周期声明，无法证明委派与恢复动作遵守有限上限。'"],
  ['src/decision.cjs',
    "'Update the host adapter and runtime together before using agents=N. Ordinary read and write actions remain available.'",
    "'用 agents=N 之前，先把宿主适配器与运行时一起更新；普通读写动作不受影响。'"],
  ['src/decision.cjs',
    '`Task mode ${mode} does not authorize repository mutation.',
    '`任务模式 ${mode} 不授权修改仓库。'],
  ['src/decision.cjs',
    "'Report the finding, use a read-only action, or obtain an explicit change contract.'",
    "'报告发现、改用只读动作，或者取得明确的修改契约。'"],
  ['src/decision.cjs',
    '`The proposed action is not proven read-only under ${mode} mode.',
    '`在 ${mode} 模式下，无法证明该动作是只读的。'],
  ['src/decision.cjs',
    "'Use a clearly read-only command or obtain an explicit change contract.'",
    "'改用明确的只读命令，或者取得明确的修改契约。'"],
  ['src/decision.cjs',
    "`The action introduces or runs hashing while the active contract is hash=${contract.hashPolicy || 'deny'}.`",
    "`当前契约是 hash=${contract.hashPolicy || 'deny'}，该动作却要引入或执行哈希。`"],
  ['src/decision.cjs',
    "'Use a direct alternative, or obtain explicit hash=allow authority and name the consumer, the cost it replaces, and the decision it changes.'",
    "'改用直接替代方案；或者明确取得 hash=allow，并说明谁消费它、它替代了什么成本、它改变哪个决定。'"],
  ['src/decision.cjs',
    "'The proposed hardening has no supported reachable input or deployed state.'",
    "'这项防御没有受支持的可达输入或部署状态。'"],
  ['src/decision.cjs',
    "'Defer it unless project evidence establishes reachability.'",
    "'除非项目证据证明它可达，否则先搁置。'"],
  ['src/decision.cjs',
    "'The action may write through a tool whose target path is not proven inside the declared file boundary.'",
    "'该动作可能通过一个无法证明目标路径在声明范围内的工具写文件。'"],
  ['src/decision.cjs',
    "'Use apply_patch or an Edit tool with visible paths, or obtain approval for an explicit broader boundary.'",
    "'改用能看到路径的编辑工具，或者为明确更宽的范围取得批准。'"],
  ['src/decision.cjs',
    '`The action writes outside the declared file boundary: ${outside.join(\', \')}.`',
    '`该动作写到声明范围之外：${outside.join(\', \')}。`'],
  ['src/decision.cjs',
    "'Keep the write inside files=..., or obtain a new explicit file boundary.'",
    "'把写入限制在 files=... 之内，或者重新给出明确的文件范围。'"],
  ['src/decision.cjs',
    "`The action adds a dependency while the active contract is deps=${contract.dependencyPolicy || 'ask'}.`",
    "`当前契约是 deps=${contract.dependencyPolicy || 'ask'}，该动作却要新增依赖。`"],
  ['src/decision.cjs',
    "'Use the existing stack, or obtain explicit deps=allow authority for the named dependency.'",
    "'沿用现有技术栈，或者为指定依赖明确取得 deps=allow。'"],
  ['src/decision.cjs',
    "'The proposed delegation can fan out to an unbounded number of subagents, so it cannot satisfy the configured agent limits deterministically.'",
    "'这次委派可能扇出到无上限数量的子代理，无法确定性地满足配置的代理上限。'"],
  ['src/decision.cjs',
    "'Use an explicit bounded delegation batch, or disable the Guard for a deliberately unbounded workflow.'",
    "'改用明确有界的委派批次；如果是刻意不设上限的流程，就停用 Guard。'"],
  ['src/decision.cjs',
    "'The host reused an already accepted action identifier. Another execution cannot share the original reservation or completion events.'",
    "'宿主重复使用了已经接受的动作标识，另一次执行无法共享原来的预留与完成事件。'"],
  ['src/decision.cjs',
    "'Use a unique action identifier for each delegation call.'",
    "'每次委派调用都用唯一的动作标识。'"],
  ['src/decision.cjs',
    "`Earlier permitted activity has no proven bound: ${delegation.unresolvedReasons.join(', ')}.`",
    "`先前放行的活动没有可证实的边界：${delegation.unresolvedReasons.join(', ')}。`"],
  ['src/decision.cjs',
    "'Wait for confirmed completion of the affected call. If the host cannot identify its completion, use a new session for a finite limit.'",
    "'等受影响的调用确认完成；如果宿主无法识别它的完成，就用新会话取得有限上限。'"],
  ['src/decision.cjs',
    "'This action can restart an existing agent, but the host does not identify each run in its completion events.'",
    "'该动作可能重启已有代理，但宿主的完成事件不区分每一次运行。'"],
  ['src/decision.cjs',
    "'Use a new delegation call so agents=N can track its completion. Messaging and resuming remain available without a finite agent limit.'",
    "'改用新的委派调用，让 agents=N 能跟踪它的完成；即使不设代理上限，发消息与恢复仍然可用。'"],
  ['src/decision.cjs',
    '`The session allows ${agentBudget} concurrently active subagent(s), with ${activeAgents} units reserved, and this action requires ${delegationCount}.`',
    '`本会话允许 ${agentBudget} 个同时活跃的子代理，已预留 ${activeAgents} 个，而这次动作需要 ${delegationCount} 个。`'],
  ['src/decision.cjs',
    "'A tool returned without proof that its child work ended. Collect a supported completion result before reusing its reserved capacity.'",
    "'有工具返回时没有证明它的子任务已结束。先拿到受支持的完成结果，再复用那份预留。'"],
  ['src/decision.cjs',
    "'Wait for the current delegation to complete or increase agents=N in a corrected directive.'",
    "'等当前委派完成，或者在修正后的指令里加大 agents=N。'"],
  ['src/decision.cjs',
    "'The action is neither requested nor established as a necessary consequence.'",
    "'这个动作既不是被要求的，也没有被证明是必要后果。'"],
  ['src/decision.cjs',
    "'Report or defer it, or obtain explicit approval for the expansion.'",
    "'报告或搁置它，或者为这次范围扩大取得明确批准。'"],
  ['src/decision.cjs',
    "'The action is within the active task contract.'",
    "'该动作在当前任务契约范围内。'"]
];

/**
 * 一条翻译算「到位」的标志：文件里已经有译文。
 * 已经翻过的条目在 --check 里算通过，在应用时直接跳过（幂等）。
 * 既没有英文原文也没有译文，才说明上游改了文案或文件被覆盖，需要补表。
 */
function run({ check }) {
  const byFile = new Map();
  const pending = [];
  const drift = [];
  for (const [file, from, to] of TABLE) {
    const absolute = path.join(ROOT, file);
    const text = byFile.has(file) ? byFile.get(file) : fs.readFileSync(absolute, 'utf8');
    if (text.includes(to)) {
      byFile.set(file, text);
      continue;
    }
    if (!text.includes(from)) {
      drift.push(`${file}: ${from.slice(0, 70)}…`);
      byFile.set(file, text);
      continue;
    }
    pending.push(file);
    byFile.set(file, text.replace(from, to));
  }
  for (const entry of drift) console.log(`未命中：原文和译文都不在文件里（上游改文案了？）：${entry}`);

  if (check) {
    console.log(`检查：${TABLE.length - pending.length - drift.length}/${TABLE.length} 条已本地化，`
      + `${pending.length} 条待应用，${drift.length} 条对不上。`);
    process.exit(drift.length === 0 ? 0 : 1);
  }

  for (const [file, text] of byFile) fs.writeFileSync(path.join(ROOT, file), text);
  console.log(`应用：新翻 ${pending.length} 条，已翻 ${TABLE.length - pending.length - drift.length} 条，`
    + `对不上 ${drift.length} 条（涉及 ${byFile.size} 个文件）。`);
  process.exit(drift.length === 0 ? 0 : 1);
}

run({ check: process.argv.includes('--check') });
