'use strict';

/**
 * dsh-stop-that-shit 冒烟测试 —— 不起真实 DSH，只用假的 ctx 复现
 * 「prompt 指令 → 契约 → tools/pre-execute 判定」这条链。
 *
 * 覆盖：
 *   - 指令生效后写文件被拒（review）
 *   - change 放行写文件
 *   - files= 边界之外被拒
 *   - hash=deny 时写哈希代码被拒
 *   - 子会话 / 孙会话的调用按根会话契约判定
 *   - status 指令返回中文状态
 *   - 两套 Skill 注册进 skills
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const plugin = require('../lib/index.cjs');

function createContext(sessions) {
  const listeners = new Map();
  const registered = [];
  const warnings = [];
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
      return () => {};
    },
    sessions: { get: (id) => sessions.get(id) },
    skills: {
      register(definition) {
        registered.push(definition);
        return () => {};
      }
    },
    logger: {
      info() {},
      warn: (...args) => warnings.push(args.join(' ')),
      error: (...args) => warnings.push(args.join(' '))
    }
  };
  return { ctx, listeners, registered, warnings };
}

function userMessage(text) {
  return {
    id: `m-${Math.random().toString(16).slice(2)}`,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }]
  };
}

function lastText(messages) {
  const last = messages[messages.length - 1];
  return last.content.map((block) => block.text).join('');
}

function harness(options = {}) {
  const sessions = new Map([
    ['root', { id: 'root', header: { cwd: '/repo' } }],
    ['child', { id: 'child', header: { cwd: '/repo', parentSession: 'root' } }],
    ['grandchild', { id: 'grandchild', header: { cwd: '/repo', parentSession: 'child' } }]
  ]);
  const { ctx, listeners, registered, warnings } = createContext(sessions);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-dsh-'));
  plugin.apply(ctx, { dataDir });

  const call = async (name, ...args) => {
    const list = listeners.get(name) || [];
    assert.ok(list.length > 0, `没有监听器: ${name}`);
    const results = [];
    for (const listener of list) results.push(await listener(...args));
    return results[results.length - 1];
  };

  const prompt = async (text, sessionId = 'root') => call(
    'agent/pre-step',
    { agent: { session: sessions.get(sessionId) }, messages: [userMessage(text)], turn: 1, step: 1 },
    async () => ({ kind: 'enter', messages: [userMessage(text)] })
  );

  const tool = async (name, args, sessionId = 'root', callId = `c-${name}`) => {
    const exec = {
      name,
      arguments: args,
      callId,
      agent: { session: sessions.get(sessionId) }
    };
    return call('tools/pre-execute', exec, async () => ({ kind: 'allow' }));
  };

  return {
    dataDir,
    sessions,
    registered,
    warnings,
    call,
    prompt,
    tool,
    cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true })
  };
}

test('指令 + review：写文件被拒，读文件放行', async () => {
  const h = harness();
  try {
    const step = await h.prompt('$stop-that-shit review -- 只看看这个 diff，别改');
    assert.equal(step.kind, 'enter');
    const context = lastText(step.messages);
    assert.match(context, /mode=review/);
    assert.match(context, /Stop Ladder/);

    const write = await h.tool('write', { file_path: '/repo/src/a.js', content: 'x' });
    assert.equal(write.kind, 'deny');
    assert.match(write.reason, /MODE_FORBIDS_MUTATION/);
    assert.match(write.reason, /不授权修改仓库/);

    const read = await h.tool('read', { file_path: '/repo/src/a.js' }, 'root', 'c-read');
    assert.equal(read.kind, 'allow');
  } finally {
    h.cleanup();
  }
});

test('change：放行写文件', async () => {
  const h = harness();
  try {
    await h.prompt('$stop-that-shit change -- 修一下配置读取');
    const write = await h.tool('write', { file_path: '/repo/src/a.js', content: 'y' });
    assert.equal(write.kind, 'allow');
  } finally {
    h.cleanup();
  }
});

test('files= 边界之外被拒', async () => {
  const h = harness();
  try {
    await h.prompt('$stop-that-shit change files=src/a.js -- 只改这个文件');
    const inside = await h.tool('write', { file_path: '/repo/src/a.js', content: 'z' }, 'root', 'c1');
    assert.equal(inside.kind, 'allow');
    const outside = await h.tool('write', { file_path: '/repo/src/b.js', content: 'z' }, 'root', 'c2');
    assert.equal(outside.kind, 'deny');
    assert.match(outside.reason, /PATH_OUTSIDE_CONTRACT/);
  } finally {
    h.cleanup();
  }
});

test('hash=deny：写哈希代码被拒', async () => {
  const h = harness();
  try {
    await h.prompt('$stop-that-shit change -- 导出报表');
    const hashed = await h.tool('write', {
      file_path: '/repo/export.js',
      content: "const { createHash } = require('node:crypto');\n"
        + "const sum = createHash('sha256').update(csv).digest('hex');\n"
    });
    assert.equal(hashed.kind, 'deny');
    assert.match(hashed.reason, /HASH_NOT_AUTHORIZED/);
  } finally {
    h.cleanup();
  }
});

test('子会话与孙会话的调用按根会话契约判定', async () => {
  const h = harness();
  try {
    await h.prompt('$stop-that-shit review -- 只读审查');
    const inChild = await h.tool('write', { file_path: '/repo/src/a.js', content: 'q' }, 'child', 'c-child');
    assert.equal(inChild.kind, 'deny');
    assert.match(inChild.reason, /MODE_FORBIDS_MUTATION/);
    const inGrandchild = await h.tool('write', { file_path: '/repo/src/a.js', content: 'q' }, 'grandchild', 'c-gc');
    assert.equal(inGrandchild.kind, 'deny');
    assert.match(inGrandchild.reason, /MODE_FORBIDS_MUTATION/);
  } finally {
    h.cleanup();
  }
});

test('status 指令返回中文状态', async () => {
  const h = harness();
  try {
    await h.prompt('$stop-that-shit review -- 只读');
    const status = await h.prompt('$stop-that-shit status');
    const text = lastText(status.messages);
    assert.match(text, /Stop That Shit 状态/);
    assert.match(text, /状态: ARMED \/ review/);
    assert.match(text, /宿主效果: 未观测/);
  } finally {
    h.cleanup();
  }
});

test('没有确认指令时全部放行', async () => {
  const h = harness();
  try {
    const write = await h.tool('write', { file_path: '/repo/src/a.js', content: 'w' });
    assert.equal(write.kind, 'allow');
  } finally {
    h.cleanup();
  }
});

test('两套 Skill 注册进 skills，且描述是中文', () => {
  const h = harness();
  try {
    const names = h.registered.map((skill) => skill.name).sort();
    assert.deepEqual(names, ['stop-that-shit', 'stss']);
    for (const skill of h.registered) {
      assert.match(skill.description, /[\u4e00-\u9fff]/);
      assert.ok(skill.content.length > 200, `${skill.name} 正文太短`);
    }
  } finally {
    h.cleanup();
  }
});

test('enabled=false 时不注册任何监听', () => {
  const sessions = new Map();
  const { ctx, listeners, registered } = createContext(sessions);
  plugin.apply(ctx, { enabled: false });
  assert.equal(listeners.size, 0);
  assert.equal(registered.length, 0);
});
