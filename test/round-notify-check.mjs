/**
 * Offline harness for @local/dsh-round-notify's Client half.
 *
 * It stubs the browser globals and the Cordis Client context the plugin touches,
 * then drives Session-list snapshots through the plugin's watcher to prove the
 * round signal, the foreground gate, the permission gate, the preference, the
 * child-Session filter, and the Settings row behavior.
 *
 * Run: npm test (or `node test/round-notify-check.mjs` from the repo root).
 */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))

function createEnvironment({ permission = 'granted', hidden = true, focused = false, stored = null } = {}) {
  const notifications = []
  const storage = new Map()
  if (stored !== null) storage.set('dsh.round-notify.enabled', stored)

  class FakeNotification {
    static permission = permission
    static requestPermission() {
      return Promise.resolve(FakeNotification.permission)
    }
    constructor(title, options = {}) {
      this.title = title
      this.options = options
      this.closed = false
      notifications.push(this)
    }
    close() {
      this.closed = true
    }
  }

  const styleTags = []
  let status = { hidden }
  const fakeDocument = {
    visibilityState: hidden ? 'hidden' : 'visible',
    hasFocus: () => focused,
    head: {
      appendChild(node) {
        styleTags.push(node)
      }
    },
    createElement(tag) {
      return {
        tag,
        dataset: {},
        textContent: '',
        remove() {
          this.removed = true
        }
      }
    }
  }

  let hooks = []
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() }
    },
    useState(initial) {
      const index = hooks.length
      hooks.push(typeof initial === 'function' ? initial() : initial)
      const set = (value) => {
        const next = typeof value === 'function' ? value(hooks[index]) : value
        hooks[index] = next
      }
      return [hooks[index], set]
    }
  }

  const modules = []
  globalThis.window = globalThis
  globalThis.__ModuleLoader__ = {
    load({ id, factory }) {
      modules.push({ id, factory })
    }
  }
  globalThis.document = fakeDocument
  globalThis.Notification = FakeNotification
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value)
  }
  globalThis.focus = () => {
    globalThis.focusedAt = Date.now()
  }

  return {
    notifications,
    storage,
    styleTags,
    modules,
    React,
    setHidden(value) {
      fakeDocument.visibilityState = value ? 'hidden' : 'visible'
      status.hidden = value
    },
    setFocused(value) {
      // focus state is read through hasFocus(); expose a mutable closure
    },
    fakeDocument,
    FakeNotification
  }
}

/** Translation stub: supports `{param}` interpolation. */
function makeTranslate(dict) {
  return (key, params = {}) => {
    const template = dict[key] ?? key
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}

async function loadPlugin(env) {
  const source = await readFile(CLIENT, 'utf8')
  const factoryModule = { exports: {} }
  // The Client artifact expects `window.__ModuleLoader__.load`; evaluate it with
  // a minimal CommonJS shim.
  const fn = new Function('window', 'require', 'module', 'exports', source)
  fn(globalThis, (name) => {
    assert.equal(name, 'react')
    return env.React
  }, factoryModule, factoryModule.exports)
  assert.equal(env.modules.length, 1)
  const { id, factory } = env.modules[0]
  return { id, plugin: factory((name) => (name === 'react' ? env.React : undefined)) }
}

/** Build a stub Cordis Client context that records effects and slot registrations. */
function createContext({ env, dict = {}, sessions = [], workspace } = {}) {
  const cleanups = []
  const registrations = []
  const listeners = { list: [] }
  let snapshot = {
    ids: sessions.map((row) => row.id),
    byId: Object.fromEntries(sessions.map((row) => [row.id, row])),
    phase: 'ready',
    projectionsBySession: {}
  }
  const listStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.list.push(listener)
      return () => {
        const index = listeners.list.indexOf(listener)
        if (index >= 0) listeners.list.splice(index, 1)
      }
    }
  }
  const ctx = {
    inject(deps, callback) {
      // The harness always has `sessions`; the real plugin treats it as optional.
      callback(this)
      return () => {}
    },
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
    locale: {
      register: () => () => {},
      bind: () => makeTranslate(dict)
    },
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      }
    },
    get(name) {
      if (name === 'sessions') return { list: listStore }
      if (name === 'uiWorkspace') return workspace
      return undefined
    },
    publish(rows) {
      snapshot = {
        ids: rows.map((row) => row.id),
        byId: Object.fromEntries(rows.map((row) => [row.id, row])),
        phase: 'ready',
        projectionsBySession: {}
      }
      for (const listener of [...listeners.list]) listener()
    }
  }
  return { ctx, registrations, cleanups }
}

function row(id, running, extra = {}) {
  return {
    id,
    displayTitle: `Session ${id}`,
    running,
    updatedAt: Date.now(),
    retainedBy: { mainView: 0 },
    blank: false,
    ...extra
  }
}

const EN = {
  'notify.title': 'Round finished',
  'notify.body': '{session} · round finished',
  'notify.bodyWithDuration': '{session} · round finished in {duration}',
  'notify.durationSeconds': '{seconds}s',
  'notify.durationMinutes': '{minutes}m',
  'notify.durationMinutesSeconds': '{minutes}m {seconds}s',
  'notify.testBody': 'Test notification from Round notifications.',
  'row.title': 'Round notifications',
  'row.description': 'desc',
  'row.permissionNeeded': 'permission needed',
  'row.blocked': 'blocked',
  'row.unsupported': 'unsupported',
  'row.test': 'Send test'
}

const results = []
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(['PASS', name]))
    .catch((error) => results.push(['FAIL', name, error]))
}

// 1. Baseline snapshot never notifies.
await check('baseline running=false and running=true do not notify', async () => {
  const env = createEnvironment()
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false), row('b', true)] })
  plugin.apply(ctx)
  assert.equal(env.notifications.length, 0)
  // b finishing after the baseline is a real round end
  ctx.publish([row('a', false), row('b', false)])
  assert.equal(env.notifications.length, 1)
})

// 2. Hidden window + granted + enabled -> one notification with the session title.
await check('hidden round end notifies once with session title and tag', async () => {
  const env = createEnvironment({ hidden: true })
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 1)
  const notice = env.notifications[0]
  assert.equal(notice.title, 'Round finished')
  assert.match(notice.options.body, /^Session a · round finished in \d+s$/)
  assert.equal(notice.options.tag, 'dsh-round-notify:a')
  assert.equal(notice.options.renotify, true)
})

// 3. Foreground window stays silent.
await check('visible focused window stays silent', async () => {
  const env = createEnvironment({ hidden: false, focused: true })
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 0)
})

// 4. Visible but unfocused window notifies.
await check('visible but unfocused window notifies', async () => {
  const env = createEnvironment({ hidden: false, focused: false })
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 1)
})

// 5. Preference off suppresses notifications.
await check('stored off preference suppresses notifications', async () => {
  const env = createEnvironment({ stored: 'off' })
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 0)
})

// 6. Ungranted permission suppresses notifications.
await check('default permission suppresses notifications', async () => {
  const env = createEnvironment({ permission: 'default' })
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 0)
})

// 7. Child sessions (subagents, teammates) never notify; the parent still does.
await check('child session rounds are filtered out', async () => {
  const env = createEnvironment()
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({
    env,
    dict: EN,
    sessions: [row('parent', false), row('child', false, { parentId: 'parent', origin: 'subagent' })]
  })
  plugin.apply(ctx)
  ctx.publish([row('parent', false), row('child', true, { parentId: 'parent', origin: 'subagent' })])
  ctx.publish([row('parent', false), row('child', false, { parentId: 'parent', origin: 'subagent' })])
  assert.equal(env.notifications.length, 0)
  ctx.publish([row('parent', true), row('child', false, { parentId: 'parent', origin: 'subagent' })])
  ctx.publish([row('parent', false), row('child', false, { parentId: 'parent', origin: 'subagent' })])
  assert.equal(env.notifications.length, 1)
  assert.equal(env.notifications[0].options.tag, 'dsh-round-notify:parent')
})

// 8. Observed start time yields a duration in the body; baseline-only start does not.
await check('observed round duration appears in the body', async () => {
  const env = createEnvironment()
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  const realNow = Date.now
  const start = realNow()
  Date.now = () => start + 125000 // 2m5s later
  try {
    ctx.publish([row('a', false)])
  } finally {
    Date.now = realNow
  }
  assert.equal(env.notifications.length, 1)
  assert.equal(env.notifications[0].options.body, 'Session a · round finished in 2m 5s')
})

await check('baseline-running round end omits the duration', async () => {
  const env = createEnvironment()
  const { plugin } = await loadPlugin(env)
  const { ctx } = createContext({ env, dict: EN, sessions: [row('a', true)] })
  plugin.apply(ctx) // baseline already running: we did not observe the start
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 1)
  assert.equal(env.notifications[0].options.body, 'Session a · round finished')
})

// 9. Notification click opens the session.
await check('notification click opens the session', async () => {
  const env = createEnvironment()
  const { plugin } = await loadPlugin(env)
  const opened = []
  const { ctx } = createContext({
    env,
    dict: EN,
    sessions: [row('a', false)],
    workspace: { openSession: (id) => opened.push(id) }
  })
  plugin.apply(ctx)
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  env.notifications[0].onclick()
  assert.deepEqual(opened, ['a'])
  assert.equal(env.notifications[0].closed, true)
})

// 10. Settings row renders a switch and a working test button when active.
await check('settings row renders active switch and test button', async () => {
  const env = createEnvironment({ permission: 'granted' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN, sessions: [] })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'settings.general.item')
  assert.ok(registration, 'settings row registered')
  assert.equal(registration.options.id, 'round-notify')

  const injected = registration.options.inject()
  const props = {
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    setRoundNotify: injected.setRoundNotify,
    t: makeTranslate(EN)
  }
  const tree = registration.component(props)
  assert.equal(tree.props.className, 'dsh-round-notify_row')
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /role":"switch"/)
  assert.match(serialized, /"aria-checked":true/)
  assert.match(serialized, /Send test/)

  // Click the test action (first control in the side container).
  const side = tree.children[1]
  const test = side.children[0]
  assert.equal(test.type, 'button')
  test.props.onClick()
  assert.equal(env.notifications.length, 1)
  assert.equal(env.notifications[0].title, 'Round finished')
})

// 11. Switch turns the preference off and persists it.
await check('switch toggles the preference and persists it', async () => {
  const env = createEnvironment({ permission: 'granted' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN, sessions: [row('a', false)] })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'settings.general.item')
  const injected = registration.options.inject()
  const props = {
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    setRoundNotify: injected.setRoundNotify,
    t: makeTranslate(EN)
  }
  const tree = registration.component(props)
  const side = tree.children[1]
  const switchButton = side.children[side.children.length - 1]
  assert.equal(switchButton.props.role, 'switch')
  assert.equal(switchButton.props['aria-checked'], true)
  switchButton.props.onClick()
  assert.equal(env.storage.get('dsh.round-notify.enabled'), 'off')
  // and the watcher now stays silent
  env.notifications.length = 0
  ctx.publish([row('a', true)])
  ctx.publish([row('a', false)])
  assert.equal(env.notifications.length, 0)
})

// 12. Denied permission shows the blocked hint and does not throw.
await check('denied permission renders blocked hint', async () => {
  const env = createEnvironment({ permission: 'denied' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN, sessions: [] })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'settings.general.item')
  const injected = registration.options.inject()
  const tree = registration.component({
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    setRoundNotify: injected.setRoundNotify,
    t: makeTranslate(EN)
  })
  assert.match(JSON.stringify(tree), /blocked/)
})

// 13. Unsupported browser renders the unsupported hint without a switch.
await check('unsupported browser renders hint and no switch', async () => {
  const env = createEnvironment()
  delete globalThis.Notification
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN, sessions: [] })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'settings.general.item')
  const injected = registration.options.inject()
  const tree = registration.component({
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    setRoundNotify: injected.setRoundNotify,
    t: makeTranslate(EN)
  })
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /unsupported/)
  assert.doesNotMatch(serialized, /role":"switch"/)
})

// 14. Permission request from the row grants and enables.
await check('permission request grants and enables the preference', async () => {
  const env = createEnvironment({ permission: 'default' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN, sessions: [] })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'settings.general.item')
  const injected = registration.options.inject()
  let nextState
  const props = {
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    setRoundNotify: (value) => {
      nextState = value
      injected.setRoundNotify(value)
    },
    t: makeTranslate(EN)
  }
  const tree = registration.component(props)
  const switchButton = tree.children[1].children[tree.children[1].children.length - 1]
  env.FakeNotification.permission = 'granted'
  env.FakeNotification.requestPermission = () => Promise.resolve('granted')
  switchButton.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(nextState, true)
  // Granting is enough: the stored preference already defaults to on, so the
  // next completed round now raises a notification.
  ctx.publish([row('b', true)])
  ctx.publish([row('b', false)])
  assert.equal(env.notifications.length, 1)
  assert.equal(env.notifications[0].options.tag, 'dsh-round-notify:b')
})

// 15. Permission prompt shows while the permission is undecided.
await check('permission prompt renders with allow and not-now actions', async () => {
  const env = createEnvironment({ permission: 'default' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: { ...EN, 'prompt.title': 'Turn on round notifications', 'prompt.text': 'text', 'prompt.allow': 'Allow notifications', 'prompt.later': 'Not now' } })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'shell.overlay')
  assert.ok(registration, 'overlay prompt registered')
  const injected = registration.options.inject()
  const tree = registration.component({
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    t: makeTranslate({ ...EN, 'prompt.title': 'Turn on round notifications', 'prompt.text': 'text', 'prompt.allow': 'Allow notifications', 'prompt.later': 'Not now' })
  })
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /Allow notifications/)
  assert.match(serialized, /Not now/)
  assert.match(serialized, /dsh-round-notify_prompt/)
})

// 16. The prompt disappears once permission is granted, denied, or disabled.
await check('permission prompt hides when decided or disabled', async () => {
  for (const permission of ['granted', 'denied']) {
    const env = createEnvironment({ permission })
    const { plugin } = await loadPlugin(env)
    const { ctx, registrations } = createContext({ env, dict: EN })
    plugin.apply(ctx)
    const registration = registrations.find((entry) => entry.options.name === 'shell.overlay')
    const injected = registration.options.inject()
    const tree = registration.component({
      useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
      t: makeTranslate(EN)
    })
    assert.equal(tree, null, `no prompt when permission is ${permission}`)
  }
  const env = createEnvironment({ permission: 'default', stored: 'off' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'shell.overlay')
  const injected = registration.options.inject()
  const tree = registration.component({
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    t: makeTranslate(EN)
  })
  assert.equal(tree, null, 'no prompt when the preference is off')
})

// 17. "Not now" persists and the allow button drives requestPermission.
await check('prompt not-now persists and allow requests permission', async () => {
  const env = createEnvironment({ permission: 'default' })
  const { plugin } = await loadPlugin(env)
  const { ctx, registrations } = createContext({ env, dict: EN })
  plugin.apply(ctx)
  const registration = registrations.find((entry) => entry.options.name === 'shell.overlay')
  const injected = registration.options.inject()
  const tree = registration.component({
    useRoundNotify: (select) => select(injected.hooks.roundNotify.getSnapshot()),
    t: makeTranslate(EN)
  })
  const actions = tree.children[2].children
  const later = actions[0]
  const allow = actions[1]
  let asked = 0
  env.FakeNotification.requestPermission = () => {
    asked += 1
    return Promise.resolve('granted')
  }
  allow.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(asked, 1, 'allow button asks the browser once')
  later.props.onClick()
  assert.equal(env.storage.get('dsh.round-notify.promptDismissed'), 'yes')
})

let failed = 0
for (const [state, name, error] of results) {
  if (state === 'FAIL') {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(error?.stack ?? error)
  } else {
    console.log(`PASS ${name}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
