'use strict';

const { DEFAULT_AGENT_LIMIT, parseContractPrompt } = require('./contracts.cjs');
const { SHELL_ANALYSIS_REASONS, isShellAnalysisReason, assertControlEvent, supportsLifecycleFacts } = require('./control-protocol.cjs');
const { inspectDelegation, applyDelegationFact } = require('./delegation-state.cjs');
const { decide } = require('./decision.cjs');
const { readRuntime, recordDecision } = require('./runtime-audit.cjs');
const { recordAnnotation } = require('./runtime-annotations.cjs');
const { readState, recoveryState, updateSession } = require('./state.cjs');

function none() {
  return { kind: 'none' };
}

function context(text) {
  return { kind: 'context', text };
}

function contractFields(contract, summary) {
  const limit = Number.isSafeInteger(contract.agentBudget) && contract.agentBudget >= 0 ? contract.agentBudget : DEFAULT_AGENT_LIMIT;
  return `mode=${contract.mode}; agents=${summary.reservedUpperBound}/${limit} 已预留${summary.unresolvedReasons.length ? '; 计数未证实' : ''}; hash=${contract.hashPolicy || 'deny'}; deps=${contract.dependencyPolicy || 'ask'}; files=${Array.isArray(contract.allowedPaths) ? contract.allowedPaths.join('|') : '无边界'}.`;
}

function contractContext(contract, delegation = {}, phase = 'active', directiveWarning = null, storageError = null) {
  if (contract.source === 'recovery' && storageError) return `${storageError.code}: ${storageError.message}`;
  if (contract.source === 'recovery') return 'STATE_DAMAGED: 已保存的契约不可用，当前进入只读恢复。请用已知可用的备份恢复，或开一个新的宿主会话；损坏文件已保留。';
  if (typeof delegation === 'string') {
    phase = delegation;
    delegation = {};
  }
  if (contract.level === 'off') {
    return [
      directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,
      '本会话的 Stop That Shit 已停用，插件不做任何强制决策。'
    ].filter(Boolean).join(' ');
  }
  if (contract.mode === 'unconfirmed') {
    return [
      directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,
      '还没有确认任务模式，Stop That Shit 处于仅观察模式。',
      '只读工作用 $stop-that-shit review，要改代码用 change。默认快路径只依赖 Stop Ladder，不宣称完整机器契约。',
      '模式确认之前，不要说「写操作正在被拦截」。'
    ].filter(Boolean).join(' ');
  }

  return [
    directiveWarning && directiveWarning.message ? `警告: ${directiveWarning.message}` : null,
    `Stop That Shit（${phase}）：${contractFields(contract, inspectDelegation(delegation))}`,
    'Stop Ladder：这是被要求的吗？是必要的吗？有什么可达证据能证明？不做会破坏当前验收吗？',
    '即使没有改代码的授权，也要报告真实发现。',
    '扩大范围之前，说清可达证据、不做会怎样失败，以及哪个事实会改变下一步动作。',
    '宿主拦截覆盖只是护栏，不是安全边界。'
  ].filter(Boolean).join(' ');
}

const FAMILY_NAMES = { I: 'INTENT', H: 'HASH', S: 'SCOPE', T: 'THRASH' };

function activeControlState(contract) {
  if (contract.level === 'off') return 'OFF';
  return contract.level === 'watch' ? 'OBSERVING' : 'ARMED';
}

function decisionMessage(result, contract, event, responseOutcome, analysisReason) {
  const observing = responseOutcome === 'context_returned';
  const executionDenial = responseOutcome === 'execution_denial_returned';
  const lines = [
    `${observing ? 'WATCH' : 'STOP'} / ${FAMILY_NAMES[result.family] || result.family || 'CONTROL'}`,
    observing
      ? 'Guard 只返回了上下文，没有拒绝该动作。'
      : executionDenial ? 'Guard 在执行前返回了拒绝。' : 'Guard 返回了权限拒绝。',
    `理由: ${result.reasonCode}`,
    ...(result.explanation ? [`细节: ${result.explanation}`] : []),
    `代码: ${result.family}/${result.reasonCode}`,
    `状态: ${activeControlState(contract)} / ${contract.mode}`
  ];
  if (event) lines.push(`事件: ${event.eventId}`);
  if (result.nextStep) lines.push(`下一步: ${result.nextStep}`);
  return lines.join('\n');
}

function runtimeCommand(prompt) {
  const match = /^(?:[ \t]*\r?\n)* {0,3}\$(?:stop-that-shit:)?stop-that-shit[ \t]+(status|runtime(?:[ \t]+all)?|explain[ \t]+(evt_[0-9a-f-]+)|label[ \t]+(evt_[0-9a-f-]+)[ \t]+(correct|incorrect|inconclusive))[ \t]*(?:\r?\n[ \t]*)*$/i.exec(prompt);
  if (!match) return null;
  const words = match[1].toLowerCase().split(/\s+/);
  return { name: words[0], all: words[1] === 'all', eventId: match[2] || match[3] || null, label: match[4] || null };
}

function runtimeSummaryText(runtime) {
  const { summary } = runtime;
  const labels = summary.labels;
  const lines = [
    'Stop That Shit 运行记录（宿主实际效果仍未观测）',
    `检查动作数: ${summary.checkedActions}`,
    `上下文响应数: ${summary.contextResponses}`,
    `权限拒绝响应数: ${summary.permissionDenyResponses}`
  ];
  if (summary.executionDenialResponses) {
    lines.push(`执行拒绝响应数: ${summary.executionDenialResponses}`);
  }
  lines.push(
    `标注: correct=${labels.correct}; incorrect=${labels.incorrect}; inconclusive=${labels.inconclusive}`,
    `已忽略的损坏记录: ${summary.damagedRecords}`
  );
  return lines.join('\n');
}

function handleRuntimeCommand(command, event, state, options) {
  if (command.name === 'status') {
    const summary = inspectDelegation(state.delegation);
    return context([
      'Stop That Shit 状态',
      `状态: ${activeControlState(state.contract)} / ${state.contract.mode}`,
      contractFields(state.contract, summary),
      `授权来源: ${state.contract.source || 'unconfirmed'}`,
      ...(state.storageError ? [`${state.storageError.code}: ${state.storageError.message}`] : []),
      ...(state.directiveError ? [`指令错误: ${state.directiveError.code}: ${state.directiveError.message}`] : []),
      ...(summary.unresolvedReasons.length
        ? [`未结活动: ${summary.unresolvedReasons.join(', ')}。需要确认完成，或换一个新的宿主会话；不要重置账本。`] : []),
      '宿主效果: 未观测',
      '用 runtime 查看检查动作数与 Guard 响应计数。'
    ].join('\n'));
  }
  if (command.name === 'runtime') {
    const query = command.all ? {} : { sessionId: event.sessionId };
    return context(runtimeSummaryText(readRuntime(query, options)));
  }
  const runtime = readRuntime({ eventId: command.eventId }, options);
  if (runtime.events.length === 0) return context(`未找到 Stop That Shit 运行事件: ${command.eventId}`);
  if (command.name === 'label') {
    const annotation = recordAnnotation(command.eventId, command.label, options);
    return context(annotation
      ? `已记录标注: ${command.eventId} = ${command.label}`
      : `无法为 ${command.eventId} 记录标注。`);
  }
  const found = runtime.events[0];
  return context([
    `Stop That Shit 事件 ${found.eventId}`,
    `状态: ${found.controlState.toUpperCase()} / ${found.contract.mode}`,
    `动作: ${found.action.toolName} (${found.action.mutability}); paths=${found.action.pathCount}`,
    ...(isShellAnalysisReason(found.action.analysisReason)
      ? [`分析: ${SHELL_ANALYSIS_REASONS[found.action.analysisReason]}`] : []),
    `决策: ${found.decision.policyOutcome} / ${found.decision.reasonCode}`,
    `响应: ${found.decision.responseOutcome}`,
    `宿主效果: ${found.decision.hostEffect}`,
    `标注: ${found.label || '未标注'}`
  ].join('\n'));
}

function handlePrompt(event, state) {
  if (state.storageError) return context(`${state.storageError.code}: ${state.storageError.message}`);
  const parsed = parseContractPrompt(event.prompt, state.contract);
  if (parsed.error) {
    state.directiveError = parsed.error;
    state.directiveWarning = null;
    state.lastPromptContext = null;
    return { kind: 'prompt-error', error: parsed.error, message: parsed.error.message };
  }
  state.contract = parsed.contract;
  if (parsed.directive || parsed.correction) state.directiveError = null;
  if (parsed.directive || parsed.correction) state.directiveWarning = parsed.directive ? parsed.warning : null;
  const promptContext = contractContext(state.contract, state.delegation, 'active', parsed.warning || state.directiveWarning, state.storageError);
  const repeatedContext = state.lastPromptContext === promptContext;
  state.lastPromptContext = promptContext;
  if (parsed.warning) return { ...context(promptContext), warning: parsed.warning };
  return repeatedContext ? none() : context(promptContext);
}

function handleBeforeAction(event, options) {
  const legacyDelegationProtocol = !supportsLifecycleFacts(event)
    && ['delegate', 'control', 'unknown'].includes(event.action.mutability);
  const changesDelegation = event.action.mutability === 'delegate'
    || event.action.delegationLifecycleUnproven || legacyDelegationProtocol;
  const delegationCount = event.action.mutability === 'delegate'
    ? (Number.isInteger(event.action.delegationCount) ? event.action.delegationCount : 1)
    : 0;
  const evaluate = (state) => {
    const action = {
      mutability: event.action.mutability,
      analysisReason: event.action.analysisReason,
      legacyDelegationProtocol,
      delegationCount,
      hashIntent: Boolean(event.action.hashIntent),
      reachability: event.action.reachability,
      authorization: event.action.authorization,
      affectedPaths: event.action.affectedPaths,
      cwd: event.action.cwd,
      dependencyIntent: Boolean(event.action.dependencyIntent),
      unboundedDelegation: Boolean(event.action.unboundedDelegation),
      delegationLifecycleUnproven: Boolean(event.action.delegationLifecycleUnproven)
    };
    const summary = inspectDelegation(state.delegation, { id: event.action.id });
    action.duplicateActionId = summary.duplicateActionId;
    const result = decide({ contract: state.contract, action, delegation: summary, state });
    if (changesDelegation && ['allow', 'report_and_defer'].includes(result.outcome)) {
      state.delegation = applyDelegationFact(state.delegation, {
        kind: 'accepted', id: event.action.id || 'legacy:unidentified', count: delegationCount,
        completionScope: event.action.completionScope,
        uncertainty: legacyDelegationProtocol ? 'legacy_protocol'
          : action.unboundedDelegation ? 'unbounded_execution'
          : action.delegationLifecycleUnproven ? 'unversioned_resume' : null
      });
    } else if (changesDelegation && summary.duplicateActionId) {
      // A later not-started event may describe this rejected attempt, not the
      // original pending execution that still owns the reservation.
      state.delegation = applyDelegationFact(state.delegation, { kind: 'duplicate_rejected', id: event.action.id });
    }
    return { state, result };
  };

  // Separate host processes can issue independent agent launches close together.
  // Serialize delegation reservations across Hook processes. Prompt updates
  // and completion handlers use the same lock; pure reads stay unlocked.
  const { state, result } = options.recoveryError
    ? evaluate(recoveryState(options.recoveryError))
    : changesDelegation
      ? updateSession(event.sessionId, options.dataDir, evaluate)
      : evaluate(readState(event.sessionId, options.dataDir));

  const denied = result.outcome === 'deny_and_explain' || result.outcome === 'require_user_approval';
  const responseOutcome = denied
    ? options.denialResponseOutcome || 'permission_deny_returned'
    : result.outcome === 'report_and_defer' ? 'context_returned' : 'none';
  const auditEvent = recordDecision({
    sessionId: event.sessionId,
    action: { ...event.action, delegationCount },
    contract: state.contract,
    delegation: state.delegation,
    decision: result,
    responseOutcome
  }, options);

  if (denied) {
    return { kind: 'deny', decision: result, eventId: auditEvent && auditEvent.eventId, message: decisionMessage(result, state.contract, auditEvent, responseOutcome, event.action.analysisReason) };
  }
  if (responseOutcome === 'context_returned') {
    return context(decisionMessage(result, state.contract, auditEvent, responseOutcome, event.action.analysisReason));
  }
  return none();
}

function handleAfterAction(event, options) {
  if (!supportsLifecycleFacts(event)) return none();
  return updateSession(event.sessionId, options.dataDir, (state) => {
    // Only a declared facts adapter may report binding or completion. A false
    // async flag can be a request parameter and never proves children joined.
    const kind = event.action.lifecycle || (event.action.completed === true ? 'joined'
      : event.action.asyncLaunched === true ? 'running' : 'unknown');
    state.delegation = applyDelegationFact(state.delegation, {
      kind, id: event.action.id, agentId: event.action.agentId, agentAliases: event.action.agentAliases
    });
    for (const agentId of event.action.endedAgentIds || []) {
      state.delegation = applyDelegationFact(state.delegation, { kind: 'child_stopped', agentId });
    }
    return none();
  });
}

function handleLifecycleContext(event, options) {
  // An older adapter may borrow the current protocol number but still map stop
  // attempts to terminal events. Its facts cannot mutate the current ledger.
  if (!supportsLifecycleFacts(event) && event.kind !== 'session.start') return none();
  const update = (state) => {
    const fact = event.kind === 'subagent.start'
      ? { kind: 'child_started', agentId: event.agentId, agentAlias: event.agentAlias, reservationId: event.reservationId }
      : event.kind === 'subagent.stop' ? { kind: 'child_stopped', agentId: event.agentId }
      : { kind: event.allDelegationsStopped === true ? 'all_stopped' : 'unknown' };
    state.delegation = applyDelegationFact(state.delegation, fact);
    return context(contractContext(state.contract, state.delegation, 'active', state.directiveWarning, state.storageError));
  };
  // Ordinary session end carries no completion fact. Keep its context response
  // without waiting for another writer or rewriting state during shutdown.
  const readOnly = event.kind === 'session.start'
    || event.kind === 'session.end' && event.allDelegationsStopped !== true;
  return readOnly ? update(readState(event.sessionId, options.dataDir))
    : updateSession(event.sessionId, options.dataDir, update);
}

function handleControlEvent(rawEvent, options = {}) {
  let event = assertControlEvent(rawEvent);
  if (event.action && event.action.id && event.sourceSessionId && event.sourceSessionId !== event.sessionId) {
    event = { ...event, action: { ...event.action, id: JSON.stringify([event.sourceSessionId, event.action.id]) } };
  }
  switch (event.kind) {
    case 'prompt.submit': {
      const command = runtimeCommand(event.prompt);
      return command
        ? handleRuntimeCommand(command, event, readState(event.sessionId, options.dataDir), options)
        : updateSession(event.sessionId, options.dataDir, state => handlePrompt(event, state));
    }
    case 'action.before':
      return handleBeforeAction(event, options);
    case 'action.after':
      return handleAfterAction(event, options);
    case 'session.start':
    case 'subagent.start':
    case 'subagent.stop':
    case 'session.end':
      return handleLifecycleContext(event, options);
    default:
      return none();
  }
}

module.exports = { contractContext, handleControlEvent, runtimeCommand };
