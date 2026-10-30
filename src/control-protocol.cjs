'use strict';

const PROTOCOL_VERSION = 2;
const EVENT_KINDS = new Set([
  'session.start',
  'prompt.submit',
  'action.before',
  'action.after',
  'subagent.start',
  'subagent.stop',
  'session.end'
]);
const MUTABILITIES = new Set(['read', 'write', 'delegate', 'control', 'unknown']);
const SHELL_ANALYSIS_REASONS = Object.freeze({
  shell_syntax_unproven: '这种 shell 语法无法被确认为静态读取。',
  shell_command_unproven: '该程序不是受支持的只读命令。',
  shell_execution_option: '这个 ripgrep 选项可以执行另一个程序。',
  option_value_missing: '缺少必需的选项值。',
  git_arguments_unproven: '这个 Git 子命令或参数形式不被支持为只读操作。',
  native_quotes_unproven: '原生命令行传参可能重新解释这些内嵌引号。',
  native_empty_arguments: '丢弃空的原生参数会变成另一个操作。',
  shell_redirection: '该命令重定向输出，可能写文件。',
  git_output_file: '该 Git 命令要求产出文件。'
});

function isShellAnalysisReason(value) {
  return typeof value === 'string' && Object.hasOwn(SHELL_ANALYSIS_REASONS, value);
}

function supportsLifecycleFacts(event) {
  // The adapter must declare its own lifecycle semantics. Older adapters import
  // PROTOCOL_VERSION from the runtime, so that number alone cannot identify them.
  return event.protocolVersion === PROTOCOL_VERSION && event.lifecycleVersion === 2;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`ControlEvent field ${field} must be a non-empty string.`);
  }
}

function assertControlEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('ControlEvent must be an object.');
  }
  if (![1, PROTOCOL_VERSION].includes(event.protocolVersion)) {
    throw new TypeError(`Unsupported ControlEvent protocolVersion: ${event.protocolVersion}.`);
  }
  if (!EVENT_KINDS.has(event.kind)) {
    throw new TypeError(`Unsupported ControlEvent kind: ${event.kind}.`);
  }
  nonEmptyString(event.sessionId, 'sessionId');

  if (event.kind === 'prompt.submit' && typeof event.prompt !== 'string') {
    throw new TypeError('ControlEvent prompt.submit requires a string prompt.');
  }
  if (event.kind === 'action.before') {
    if (!event.action || typeof event.action !== 'object') {
      throw new TypeError(`ControlEvent ${event.kind} requires an action object.`);
    }
    nonEmptyString(event.action.name, 'action.name');
    if (!MUTABILITIES.has(event.action.mutability)) {
      throw new TypeError(`Unsupported action mutability: ${event.action.mutability}.`);
    }
    if (event.action.analysisReason !== undefined && !isShellAnalysisReason(event.action.analysisReason)) {
      throw new TypeError('Unsupported action analysis reason.');
    }
    if (event.action.mutability === 'delegate' || event.action.delegationLifecycleUnproven) nonEmptyString(event.action.id, 'action.id');
    if (
      event.action.delegationCount !== undefined
      && (!Number.isSafeInteger(event.action.delegationCount) || event.action.delegationCount < 0)
    ) {
      throw new TypeError('ControlEvent action.delegationCount must be a non-negative integer.');
    }
    if (event.action.asyncLaunched !== undefined && typeof event.action.asyncLaunched !== 'boolean') {
      throw new TypeError('ControlEvent action.asyncLaunched must be a boolean when provided.');
    }
  }
  if (event.kind === 'action.after') {
    if (!event.action || typeof event.action !== 'object') {
      throw new TypeError(`ControlEvent ${event.kind} requires an action object.`);
    }
    nonEmptyString(event.action.id, 'action.id');
    if (event.action.agentId !== undefined && event.action.agentId !== null) {
      nonEmptyString(event.action.agentId, 'action.agentId');
    }
    for (const field of ['agentAliases', 'endedAgentIds']) {
      if (event.action[field] !== undefined) {
        if (!Array.isArray(event.action[field])) throw new TypeError(`action.${field} must be an array.`);
        for (const id of event.action[field]) nonEmptyString(id, `action.${field}`);
      }
    }
    if (event.action.lifecycle !== undefined && !['running', 'joined', 'not_started', 'unknown'].includes(event.action.lifecycle)) {
      throw new TypeError('Unsupported action.lifecycle fact.');
    }
    if (event.action.completed !== undefined && typeof event.action.completed !== 'boolean') {
      throw new TypeError('ControlEvent action.completed must be a boolean when provided.');
    }
    if (event.action.asyncLaunched !== undefined && typeof event.action.asyncLaunched !== 'boolean') {
      throw new TypeError('ControlEvent action.asyncLaunched must be a boolean when provided.');
    }
  }
  if (event.kind === 'subagent.start' || event.kind === 'subagent.stop') {
    for (const field of ['agentId', 'agentAlias', 'reservationId']) {
      if (event[field] !== undefined && event[field] !== null) nonEmptyString(event[field], field);
    }
  }

  if (event.allDelegationsStopped !== undefined && typeof event.allDelegationsStopped !== 'boolean') throw new TypeError('allDelegationsStopped must be boolean.');
  if (event.sourceSessionId !== undefined) nonEmptyString(event.sourceSessionId, 'sourceSessionId');
  if (event.action && event.action.completionScope !== undefined && !['call', 'children'].includes(event.action.completionScope)) {
    throw new TypeError('Unsupported action.completionScope.');
  }
  return event;
}

module.exports = {
  SHELL_ANALYSIS_REASONS,
  isShellAnalysisReason,
  EVENT_KINDS,
  MUTABILITIES,
  PROTOCOL_VERSION,
  supportsLifecycleFacts,
  assertControlEvent
};
