'use strict';

const nodePath = require('node:path');
const { DEFAULT_AGENT_LIMIT } = require('./contracts.cjs');
const { inspectDelegation } = require('./delegation-state.cjs');
const { SHELL_ANALYSIS_REASONS, isShellAnalysisReason } = require('./control-protocol.cjs');

function analysisExplanation(action) {
  return isShellAnalysisReason(action.analysisReason)
    ? ` ${SHELL_ANALYSIS_REASONS[action.analysisReason]}` : '';
}

function decision(outcome, family, reasonCode, explanation, nextStep) {
  return { outcome, family, reasonCode, explanation, nextStep };
}

function controlledOutcome(level, guarded = 'deny_and_explain') {
  return level === 'watch' ? 'report_and_defer' : guarded;
}

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(String(value || ''));
}

function normalizeComparablePath(value, cwd) {
  let normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  const base = String(cwd || '').trim();
  if (base && isWindowsAbsolute(normalized) && isWindowsAbsolute(base)) {
    normalized = nodePath.win32.relative(base, normalized).replace(/\\/g, '/');
  } else if (base && nodePath.posix.isAbsolute(normalized) && nodePath.posix.isAbsolute(base.replace(/\\/g, '/'))) {
    normalized = nodePath.posix.relative(base.replace(/\\/g, '/'), normalized);
  }
  return nodePath.posix.normalize(normalized).replace(/^\.\//, '');
}

function pathAllowed(path, allowedPaths, cwd) {
  const normalizedPath = normalizeComparablePath(path, cwd);
  return allowedPaths.some((value) => {
    const allowed = normalizeComparablePath(value, cwd);
    const caseInsensitive = isWindowsAbsolute(cwd) || (isWindowsAbsolute(path) && isWindowsAbsolute(value));
    const comparablePath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
    const comparableAllowed = caseInsensitive ? allowed.toLowerCase() : allowed;
    if (comparableAllowed === '**') return true;
    if (comparableAllowed.endsWith('/**')) {
      const base = comparableAllowed.slice(0, -3);
      return comparablePath === base || comparablePath.startsWith(`${base}/`);
    }
    return comparablePath === comparableAllowed;
  });
}

function decide({ contract, action, state = {}, delegation = inspectDelegation(state.delegation) }) {
  const mode = contract.mode || 'unconfirmed';
  const level = contract.level || 'watch';

  if (state.storageError) {
    const lockDamaged = state.storageError.code === 'STS_LOCK_DAMAGED';
    return action.mutability === 'read' || action.mutability === 'control' && !action.delegationLifecycleUnproven
      ? decision('allow', null, 'RECOVERY_READ_ONLY', '只读恢复仍然可用。', null)
      : decision('deny_and_explain', 'I', lockDamaged ? 'STS_LOCK_DAMAGED' : 'STATE_DAMAGED', state.storageError.message,
        lockDamaged ? '按 README 的旧版锁恢复步骤处理，保留已保存的契约与委派记录。'
          : '用已知可用的备份恢复状态，或开一个新的宿主会话；不要清除未结的委派记录。');
  }

  const delegationCount = action.mutability === 'delegate'
    ? (Number.isInteger(action.delegationCount) ? action.delegationCount : 1)
    : 0;
  if (level === 'off' || mode === 'unconfirmed') {
    return decision('allow', null, 'CONTROL_INACTIVE', '没有已确认的强制契约在生效。', null);
  }
  if (action.mutability === 'delegate' && state.directiveError) {
    return decision(
      controlledOutcome(level),
      'S',
      'INVALID_DIRECTIVE',
      `当前 Stop That Shit 指令无效：${state.directiveError.message || state.directiveError.code || '未知指令错误'}。`,
      '先针对报错字段提交修正后的指令，再委派。'
    );
  }

  const agentBudget = Number.isSafeInteger(contract.agentBudget) && contract.agentBudget >= 0
    ? contract.agentBudget
    : DEFAULT_AGENT_LIMIT;
  if (action.legacyDelegationProtocol && agentBudget < DEFAULT_AGENT_LIMIT) {
    return decision(
      controlledOutcome(level),
      'S',
      'LIFECYCLE_PROTOCOL_REQUIRED',
      '这个适配器没有受支持的生命周期声明，无法证明委派与恢复动作遵守有限上限。',
      '用 agents=N 之前，先把宿主适配器与运行时一起更新；普通读写动作不受影响。'
    );
  }

  const nonMutatingMode = ['answer', 'review', 'monitor'].includes(mode);
  if (nonMutatingMode && action.mutability === 'write') {
    return decision(
      controlledOutcome(level),
      'I',
      'MODE_FORBIDS_MUTATION',
      `任务模式 ${mode} 不授权修改仓库。${analysisExplanation(action)}`,
      '报告发现、改用只读动作，或者取得明确的修改契约。'
    );
  }

  if (nonMutatingMode && action.mutability === 'unknown') {
    return decision(
      controlledOutcome(level, 'require_user_approval'),
      'I',
      'MUTABILITY_UNPROVEN',
      `在 ${mode} 模式下，无法证明该动作是只读的。${analysisExplanation(action)}`,
      '改用明确的只读命令，或者取得明确的修改契约。'
    );
  }

  if (action.hashIntent && contract.hashPolicy !== 'allow') {
    const requiresApproval = contract.hashPolicy === 'ask';
    return decision(
      controlledOutcome(level, requiresApproval ? 'require_user_approval' : 'deny_and_explain'),
      'H',
      'HASH_NOT_AUTHORIZED',
      `当前契约是 hash=${contract.hashPolicy || 'deny'}，该动作却要引入或执行哈希。`,
      '改用直接替代方案；或者明确取得 hash=allow，并说明谁消费它、它替代了什么成本、它改变哪个决定。'
    );
  }

  if (action.reachability === 'unreachable') {
    return decision(
      'report_and_defer',
      'H',
      'HYPOTHETICAL_UNREACHABLE',
      '这项防御没有受支持的可达输入或部署状态。',
      '除非项目证据证明它可达，否则先搁置。'
    );
  }

  if (Array.isArray(contract.allowedPaths)) {
    const affectedPaths = Array.isArray(action.affectedPaths) ? action.affectedPaths : [];
    if (['write', 'unknown'].includes(action.mutability) && affectedPaths.length === 0 && !contract.allowedPaths.includes('**')) {
      return decision(
        controlledOutcome(level, 'require_user_approval'),
        'S',
        'WRITE_PATH_UNPROVEN',
        '该动作可能通过一个无法证明目标路径在声明范围内的工具写文件。',
        '改用能看到路径的编辑工具，或者为明确更宽的范围取得批准。'
      );
    }
    const outside = affectedPaths.filter((path) => !pathAllowed(path, contract.allowedPaths, action.cwd));
    if (outside.length) {
      return decision(
        controlledOutcome(level),
        'S',
        'PATH_OUTSIDE_CONTRACT',
        `该动作写到声明范围之外：${outside.join(', ')}。`,
        '把写入限制在 files=... 之内，或者重新给出明确的文件范围。'
      );
    }
  }

  if (action.dependencyIntent && contract.dependencyPolicy !== 'allow') {
    const requiresApproval = contract.dependencyPolicy === 'ask';
    return decision(
      controlledOutcome(level, requiresApproval ? 'require_user_approval' : 'deny_and_explain'),
      'S',
      'DEPENDENCY_NOT_AUTHORIZED',
      `当前契约是 deps=${contract.dependencyPolicy || 'ask'}，该动作却要新增依赖。`,
      '沿用现有技术栈，或者为指定依赖明确取得 deps=allow。'
    );
  }

  if (action.mutability === 'delegate' && action.unboundedDelegation) {
    return decision(
      controlledOutcome(level),
      'S',
      'UNBOUNDED_DELEGATION',
      '这次委派可能扇出到无上限数量的子代理，无法确定性地满足配置的代理上限。',
      '改用明确有界的委派批次；如果是刻意不设上限的流程，就停用 Guard。'
    );
  }

  if (action.mutability === 'delegate' && action.duplicateActionId) {
    return decision(
      controlledOutcome(level),
      'S',
      'DUPLICATE_ACTION_ID',
      '宿主重复使用了已经接受的动作标识，另一次执行无法共享原来的预留与完成事件。',
      '每次委派调用都用唯一的动作标识。'
    );
  }

  const activeAgents = delegation.reservedUpperBound;
  if (action.mutability === 'delegate' && delegation.unresolvedReasons.length > 0
      && agentBudget < DEFAULT_AGENT_LIMIT) {
    return decision(
      controlledOutcome(level),
      'S',
      'DELEGATION_STATE_UNPROVEN',
      `先前放行的活动没有可证实的边界：${delegation.unresolvedReasons.join(', ')}。`,
      '等受影响的调用确认完成；如果宿主无法识别它的完成，就用新会话取得有限上限。'
    );
  }
  if (action.delegationLifecycleUnproven && agentBudget < DEFAULT_AGENT_LIMIT) {
    return decision(
      controlledOutcome(level),
      'S',
      'DELEGATION_LIFECYCLE_UNPROVEN',
      '该动作可能重启已有代理，但宿主的完成事件不区分每一次运行。',
      '改用新的委派调用，让 agents=N 能跟踪它的完成；即使不设代理上限，发消息与恢复仍然可用。'
    );
  }
  if (action.mutability === 'delegate' && activeAgents + delegationCount > agentBudget) {
    return decision(
      controlledOutcome(level),
      'S',
      'AGENT_BUDGET_EXHAUSTED',
      `本会话允许 ${agentBudget} 个同时活跃的子代理，已预留 ${activeAgents} 个，而这次动作需要 ${delegationCount} 个。`,
      delegation.unknownResults ? '有工具返回时没有证明它的子任务已结束。先拿到受支持的完成结果，再复用那份预留。' : '等当前委派完成，或者在修正后的指令里加大 agents=N。'
    );
  }

  if (action.authorization === 'unapproved_expansion') {
    return decision(
      controlledOutcome(level, 'require_user_approval'),
      'S',
      'UNAPPROVED_SCOPE_EXPANSION',
      '这个动作既不是被要求的，也没有被证明是必要后果。',
      '报告或搁置它，或者为这次范围扩大取得明确批准。'
    );
  }

  return decision('allow', null, 'WITHIN_CONTRACT', '该动作在当前任务契约范围内。', null);
}

module.exports = { decide };
