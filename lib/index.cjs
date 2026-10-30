'use strict';

/**
 * dsh-stop-that-shit —— Stop That Shit 的 DeepSeek Harness 桥接插件（中文本地化版）。
 *
 * 上游：https://github.com/lennney/stop-that-shit 0.2.5（commit 17ffc9f），
 * 本文件由上游 `dsh/lib/bridge.cjs` 改写而来，改动只有四处：
 *   1. require 路径改为包内 `../src/adapters/dsh-hooks.cjs`（上游指向仓库根的 src/）；
 *   2. 插件名改为 dsh-stop-that-shit，并额外把两套 Skill 注册进 `ctx.skills`；
 *   3. 控制台提示本地化为中文；
 *   4. 增加了 `enabled` 开关，方便不改 patch 就临时停用。
 *
 * 事件翻译（DSH 0.2.2-alpha.2 实测签名）：
 *   session/created    -> session.start       （emit，仅观测）
 *   session/disposed   -> session.end         （emit，仅观测）
 *   agent/pre-step     -> prompt.submit       （waterfall，可拒绝本步）
 *   tools/pre-execute  -> action.before       （waterfall，可拒绝调用）
 *   tools/post-execute -> action.after        （waterfall，仅观测）
 *   subagent/start     -> subagent.start      （emit，仅观测）
 *   subagent/end       -> subagent.stop       （emit，仅观测）
 *
 * 所有工具调用都以**根会话**为键：bridge 沿会话存储的 parentSession 链上溯，
 * 所以 root → child → grandchild 的委派调用仍然受根会话契约约束。
 * 没有显式 `$stop-that-shit` 指令时，每个决策都是放行。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  applyDshDecision,
  fromNativeEvent,
  handleDshHook,
  resolveRootLineage
} = require('../src/adapters/dsh-hooks.cjs');

/** 本插件塞进决策流的消息都带这个来源标记。 */
const SOURCE = { kind: 'stop-that-shit' };

const PACKAGE_VERSION = require('../package.json').version;

// ---------------------------------------------------------------------------
// Skill 注册：SKILL.md 正文是模型的判断规则，不属于 Guard 的执行拦截。
// ---------------------------------------------------------------------------

/**
 * 拆出 SKILL.md 的 YAML frontmatter。
 * 只支持本插件自己用到的简单 `key: value` 行；解析失败时返回 null，不猜。
 */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2].trim();
    if (value) fields[field[1]] = value;
  }
  return { fields, body: text.slice(match[0].length) };
}

/**
 * 把包内 `skills/<name>/SKILL.md` 注册进 DSH 的 skill 目录。
 * 注册失败只记日志：Skill 是建议性的，缺了它 Guard 仍然工作。
 */
function registerSkills(ctx, logger) {
  const skills = ctx.get ? ctx.get('skills') : ctx.skills;
  if (!skills || typeof skills.register !== 'function') {
    logger('未找到 skills 服务，跳过 Skill 注册（Guard 不受影响）');
    return [];
  }
  const root = path.join(__dirname, '..', 'skills');
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    logger(`未找到技能目录 ${root}，跳过 Skill 注册`);
    return [];
  }
  const disposers = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name, 'SKILL.md');
    try {
      const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      if (!parsed || !parsed.fields.name || !parsed.fields.description) {
        logger(`技能 ${entry.name} 缺少 frontmatter，跳过`);
        continue;
      }
      disposers.push(skills.register({
        name: parsed.fields.name,
        description: parsed.fields.description,
        whenToUse: parsed.fields.whenToUse,
        content: parsed.body.trim(),
        source: 'bundled',
        path: file
      }));
    } catch (error) {
      logger(`技能 ${entry.name} 注册失败：${error && error.message ? error.message : error}`);
    }
  }
  return disposers;
}

/** 上游 errors 用的 console；这里统一走 harness logger，并带上插件名前缀。 */
function makeLogger(ctx) {
  const name = `[${'dsh-stop-that-shit'}@${PACKAGE_VERSION}]`;
  return (level, ...args) => {
    const target = ctx.logger && typeof ctx.logger[level] === 'function' ? ctx.logger[level].bind(ctx.logger) : null;
    if (target) target(name, ...args);
    else if (level === 'warn') console.warn(name, ...args);
    else if (level === 'error') console.error(name, ...args);
    else console.log(name, ...args);
  };
}

function plugin(ctx, config = {}) {
  const log = makeLogger(ctx);
  const enabled = config.enabled !== false;
  if (!enabled) {
    log('info', '插件已停用（config.enabled=false），不注册任何监听');
    return;
  }

  const dataDir = typeof config.dataDir === 'string' && config.dataDir.trim()
    ? config.dataDir.trim()
    : path.join(os.homedir(), '.dsh', 'stop-that-shit');

  const options = { dataDir };

  if (config.skills !== false) registerSkills(ctx, (...args) => log('warn', ...args));

  // ---- 会话查找：沿会话存储的父链上溯 ----

  function getSessionById(sessionId) {
    const sessions = ctx.sessions;
    if (!sessions || typeof sessions.get !== 'function') return null;
    let session;
    try {
      session = sessions.get(sessionId);
    } catch {
      return null;
    }
    if (!session) return null;
    return { id: session.id, header: session.header };
  }

  /**
   * 工具调用所属的根会话 id。header 只记直接父会话，所以要显式走完整条链。
   * 链走不到「没有父会话」的根时返回 null：适配层会拒绝这次调用，而不是
   * 相信中间那层子会话。
   */
  const rootOf = (sessionId) => resolveRootLineage(sessionId, getSessionById);

  function gateContext(exec) {
    const sessionId = exec && exec.agent && exec.agent.session
      ? String(exec.agent.session.id || '')
      : '';
    return {
      rootSessionId: rootOf(sessionId) || undefined,
      resolveRootSession: rootOf
    };
  }

  // ---- 消息辅助 ----

  function contextMessage(text) {
    return Object.freeze({
      id: randomUUID(),
      role: 'user',
      source: SOURCE,
      content: [{ type: 'text', text: String(text) }]
    });
  }

  /**
   * pre-step waterfall 的上下文出口。
   *
   * `context`（契约解析器给出的确认文本）作为一条额外的 user 消息接在下游批次
   * 后面，让模型看到这次的契约吸收了哪些指令。下游自己的拒绝优先：一旦下游
   * 拒绝，就不再塞替换消息。
   *
   * `reason`（本步被拒的理由）只能走日志：DSH 的 PreStepDecision 没有 reason
   * 字段，而拒绝之后再返回替换消息会让同一步重新进入。
   */
  function preStepSink({ kind, text, downstream }) {
    if (kind === 'reason') {
      log('warn', '本步被拒绝：', String(text));
      return undefined;
    }
    if (!downstream || downstream.kind === 'reject' || !Array.isArray(downstream.messages)) {
      return undefined;
    }
    const extra = contextMessage(text);
    return Object.assign({}, downstream, { messages: downstream.messages.concat(extra) });
  }

  // ---- 监听器 ----

  ctx.on('session/created', (session) => {
    const payload = fromNativeEvent('session/created', session);
    if (payload) handleDshHook('session/created', payload, options);
  });

  ctx.on('session/disposed', (session) => {
    const payload = fromNativeEvent('session/disposed', session);
    if (payload) handleDshHook('session/disposed', payload, options);
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    const normalized = fromNativeEvent('agent/pre-step', payload);
    // 委派出去的子会话 prompt 完全不翻译：父会话已经持有约束这次委派的契约。
    if (!normalized) return next();
    const result = handleDshHook('agent/pre-step', normalized, options);
    if (!result) return next();
    return applyDshDecision('agent/pre-step', result, next, preStepSink);
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const payload = fromNativeEvent('tools/pre-execute', exec, gateContext(exec));
    if (!payload) return next();
    const result = handleDshHook('tools/pre-execute', payload, options);
    return applyDshDecision('tools/pre-execute', result, next);
  });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const payload = fromNativeEvent('tools/post-execute', exec, Object.assign(
      { result },
      gateContext(exec)
    ));
    if (payload) handleDshHook('tools/post-execute', payload, options);
    return next();
  });

  // 子代理生命周期：run info 是扁平的 { runId, provider, id, local }，
  // 父会话要用子会话 id 去会话存储里查。
  function parentOfChild(childId) {
    const session = getSessionById(childId);
    const header = session && session.header;
    return header && header.parentSession ? String(header.parentSession) : undefined;
  }

  ctx.on('subagent/start', (info) => {
    const payload = fromNativeEvent('subagent/start', info, { sessionId: parentOfChild(info && info.id) });
    if (payload) handleDshHook('subagent/start', payload, options);
  });

  ctx.on('subagent/end', (info) => {
    const payload = fromNativeEvent('subagent/end', info, { sessionId: parentOfChild(info && info.id) });
    if (payload) handleDshHook('subagent/end', payload, options);
  });
}

const pluginExports = {
  name: 'dsh-stop-that-shit',
  inject: ['sessions'],
  apply: plugin
};

module.exports = pluginExports;
module.exports.default = pluginExports;
module.exports.parseFrontmatter = parseFrontmatter;
