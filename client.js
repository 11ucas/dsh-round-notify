/**
 * Client half of the round-notify bundle.
 *
 * A "round" is one Agent turn: the goal round driver only starts a round at
 * whole-agent idle, so a Session's `running` flag going `true -> false` is
 * exactly one completed round, automatic goal rounds included. The watcher
 * reads that flag from the Client Session list (a public `sessions` face) and
 * raises a browser notification only while this page is not in the foreground.
 *
 * The Settings row owns the preference and the browser-permission handshake,
 * because `Notification.requestPermission()` needs a user gesture.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-round-notify',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'round-notify';
    /** Browser-storage key for the preference (per origin, survives reloads). */
    const STORAGE_KEY = 'dsh.round-notify.enabled';
    /** Browser-storage key for "Not now" on the permission prompt. */
    const PROMPT_KEY = 'dsh.round-notify.promptDismissed';

    const en = {
      'meta.title': 'Round notifications',
      'meta.description': 'Sends a system notification when a round finishes while this window is in the background, automatic goal rounds included.',
      'row.title': 'Round notifications',
      'row.description': 'Send a system notification when a round finishes while this window is not in the foreground — automatic goal rounds included.',
      'row.permissionNeeded': 'Allow browser notifications to turn this on.',
      'row.blocked': 'Notifications are blocked for this site. Allow them in the browser site settings, then reload this page.',
      'row.unsupported': 'This browser does not support system notifications.',
      'row.test': 'Send test',
      'prompt.title': 'Turn on round notifications',
      'prompt.text': 'Get a system notification when a round finishes while this window is in the background.',
      'prompt.allow': 'Allow notifications',
      'prompt.later': 'Not now',
      'notify.title': 'Round finished',
      'notify.body': '{session} · round finished',
      'notify.bodyWithDuration': '{session} · round finished in {duration}',
      'notify.testBody': 'Test notification from Round notifications.',
      'notify.durationSeconds': '{seconds}s',
      'notify.durationMinutes': '{minutes}m',
      'notify.durationMinutesSeconds': '{minutes}m {seconds}s'
    };

    const zh = {
      'meta.title': '轮次通知',
      'meta.description': '窗口不在前台时，每一轮结束后发送系统通知；目标自动续轮同样生效。',
      'row.title': '轮次通知',
      'row.description': '当这个窗口不在前台时，每一轮结束后发送系统通知（包括目标的自动续轮）。',
      'row.permissionNeeded': '需要允许浏览器通知才能开启。',
      'row.blocked': '这个站点已被禁止通知。请在浏览器的站点设置里允许通知，然后重新加载本页。',
      'row.unsupported': '当前浏览器不支持系统通知。',
      'row.test': '发送测试',
      'prompt.title': '开启轮次通知',
      'prompt.text': '窗口不在前台时，每一轮结束后会收到系统通知。',
      'prompt.allow': '允许通知',
      'prompt.later': '以后再说',
      'notify.title': '一轮已完成',
      'notify.body': '{session} · 本轮已完成',
      'notify.bodyWithDuration': '{session} · 本轮已完成，用时 {duration}',
      'notify.testBody': '这是一条来自「轮次通知」的测试通知。',
      'notify.durationSeconds': '{seconds} 秒',
      'notify.durationMinutes': '{minutes} 分钟',
      'notify.durationMinutesSeconds': '{minutes} 分 {seconds} 秒'
    };

    const CSS = [
      '.dsh-round-notify_row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dsh-round-notify_text{min-width:0}',
      '.dsh-round-notify_title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dsh-round-notify_description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-round-notify_hint{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-round-notify_hintError{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-round-notify_side{display:flex;flex:none;align-items:center;gap:12px}',
      '.dsh-round-notify_action{appearance:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:3px 8px;cursor:pointer}',
      '.dsh-round-notify_action:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-round-notify_action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dsh-round-notify_switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:none;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s ease}',
      '.dsh-round-notify_switchOn{background:var(--dsw-alias-brand-primary)}',
      '.dsh-round-notify_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dsh-round-notify_knob{position:absolute;top:2px;left:2px;display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}',
      '.dsh-round-notify_switchOn .dsh-round-notify_knob{transform:translateX(16px)}',
      '.dsh-round-notify_prompt{position:fixed;right:24px;bottom:24px;width:320px;max-width:calc(100vw - 48px);box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.18)}',
      '.dsh-round-notify_promptTitle{font-size:14px;line-height:20px}',
      '.dsh-round-notify_promptText{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-round-notify_promptActions{display:flex;justify-content:flex-end;gap:8px}',
      '.dsh-round-notify_primary{appearance:none;border:.5px solid var(--dsw-alias-brand-primary);border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;cursor:pointer}',
      '.dsh-round-notify_primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}'
    ].join('\n');

    /** Notification support state: the browser's permission string, or `unsupported`. */
    function permissionState() {
      const Ctor = globalThis.Notification;
      return Ctor === undefined ? 'unsupported' : Ctor.permission;
    }

    /** Whether this page is out of the user's foreground attention. */
    function inBackground() {
      if (typeof document === 'undefined') return false;
      if (document.visibilityState !== 'visible') return true;
      return document.hasFocus() === false;
    }

    /** Ask for the browser permission; must be called from a user gesture. */
    function requestBrowserPermission(onResult) {
      const Ctor = globalThis.Notification;
      if (Ctor === undefined) {
        onResult('unsupported');
        return;
      }
      Promise.resolve(Ctor.requestPermission())
        .then(onResult)
        .catch(() => onResult(permissionState()));
    }

    /** Whether the user already chose "Not now" on the permission prompt. */
    function readPromptDismissed() {
      try {
        return globalThis.localStorage.getItem(PROMPT_KEY) === 'yes';
      } catch {
        return false;
      }
    }

    function writePromptDismissed() {
      try {
        globalThis.localStorage.setItem(PROMPT_KEY, 'yes');
      } catch {
        /* Without storage the prompt only stays dismissed for this page. */
      }
    }

    /** Read the stored preference; notifications default to on so a granted permission is enough. */
    function readPreference() {
      try {
        const raw = globalThis.localStorage.getItem(STORAGE_KEY);
        return raw === null ? true : raw !== 'off';
      } catch {
        return true;
      }
    }

    function writePreference(enabled) {
      try {
        globalThis.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch {
        /* Private mode without storage still notifies for this page lifetime. */
      }
    }

    /** Minimal observable mirroring the Client's `HostObservable` snapshot contract. */
    function createPreference() {
      let value = readPreference();
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        set: (next) => {
          if (value === next) return;
          value = next;
          writePreference(next);
          for (const listener of [...listeners]) listener();
        }
      };
    }

    /** Human-readable duration for the notification body. */
    function formatDuration(t, elapsedMs) {
      const seconds = Math.max(0, Math.round(elapsedMs / 1000));
      if (seconds < 60) return t('notify.durationSeconds', { seconds });
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      if (rest === 0) return t('notify.durationMinutes', { minutes });
      return t('notify.durationMinutesSeconds', { minutes, seconds: rest });
    }

    /**
     * Render the General Settings row: preference switch, permission handshake.
     * @param props - composed Settings slot props (`hooks` become `use*` props).
     * @returns the preference row.
     */
    function RoundNotifyRow({ useRoundNotify, setRoundNotify, t }) {
      const enabled = useRoundNotify((value) => value);
      const [permission, setPermission] = React.useState(permissionState);

      const request = () =>
        requestBrowserPermission((result) => {
          setPermission(result);
          setRoundNotify(result === 'granted');
        });

      const sendTest = () => {
        const Ctor = globalThis.Notification;
        if (Ctor === undefined || Ctor.permission !== 'granted') return;
        try {
          new Ctor(t('notify.title'), { body: t('notify.testBody'), tag: 'dsh-round-notify:test' });
        } catch {
          /* A browser that refuses construction keeps the watcher silent too. */
        }
      };

      const active = enabled && permission === 'granted';
      const toggle = () => {
        if (permission === 'denied' || permission === 'unsupported') return;
        if (permission === 'granted') {
          setRoundNotify(!enabled);
          return;
        }
        request();
      };

      const controls = [];
      if (permission === 'granted' && enabled) {
        controls.push(
          h(
            'button',
            { type: 'button', className: 'dsh-round-notify_action', onClick: sendTest },
            t('row.test')
          )
        );
      }
      if (permission !== 'unsupported') {
        controls.push(
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': active,
              'aria-label': t('row.title'),
              disabled: permission === 'denied',
              className:
                'dsh-round-notify_switch' + (active ? ' dsh-round-notify_switchOn' : ''),
              onClick: toggle
            },
            h('span', { className: 'dsh-round-notify_knob' })
          )
        );
      }

      const hints = [];
      if (permission === 'unsupported') {
        hints.push(h('div', { className: 'dsh-round-notify_hint', key: 'unsupported' }, t('row.unsupported')));
      } else if (permission === 'denied') {
        hints.push(
          h(
            'div',
            { className: 'dsh-round-notify_hint dsh-round-notify_hintError', key: 'blocked', role: 'alert' },
            t('row.blocked')
          )
        );
      } else if (enabled && permission === 'default') {
        hints.push(h('div', { className: 'dsh-round-notify_hint', key: 'permission' }, t('row.permissionNeeded')));
      }

      return h(
        'div',
        { className: 'dsh-round-notify_row' },
        h(
          'div',
          { className: 'dsh-round-notify_text' },
          h('div', { className: 'dsh-round-notify_title' }, t('row.title')),
          h('div', { className: 'dsh-round-notify_description' }, t('row.description')),
          ...hints
        ),
        h('div', { className: 'dsh-round-notify_side' }, ...controls)
      );
    }

    /**
     * Frame-wide prompt asking for the notification permission while it is still
     * undecided. A page load cannot request it: the browser requires a click.
     * @param props - composed slot props (`useRoundNotify`) and localization.
     * @returns the prompt, or nothing once decided, disabled, or dismissed.
     */
    function PermissionPrompt({ useRoundNotify, t }) {
      const enabled = useRoundNotify((value) => value);
      const [permission, setPermission] = React.useState(permissionState);
      const [dismissed, setDismissed] = React.useState(readPromptDismissed);
      if (dismissed || !enabled || permission !== 'default') return null;

      const allow = () =>
        requestBrowserPermission((result) => {
          setPermission(result);
        });
      const later = () => {
        writePromptDismissed();
        setDismissed(true);
      };

      return h(
        'div',
        { className: 'dsh-round-notify_prompt', role: 'status' },
        h('div', { className: 'dsh-round-notify_promptTitle' }, t('prompt.title')),
        h('div', { className: 'dsh-round-notify_promptText' }, t('prompt.text')),
        h(
          'div',
          { className: 'dsh-round-notify_promptActions' },
          h('button', { type: 'button', className: 'dsh-round-notify_action', onClick: later }, t('prompt.later')),
          h('button', { type: 'button', className: 'dsh-round-notify_primary', onClick: allow }, t('prompt.allow'))
        )
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        const preference = createPreference();

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'round-notify: dictionaries');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-round-notify';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'round-notify: styles');

        /**
         * Watch every listed Session's `running` flag. The Sessions face is an
         * optional dependency: without it this watcher stays off while the
         * Settings row still renders.
         */
        ctx.inject(['sessions'], (scope) => {
          scope.effect(() => {
            const running = new Map();
            const startedAt = new Map();

            const deliver = (row, elapsedMs) => {
              // Child Sessions (subagents and teammates) are internal work, not a
              // user-facing round; a goal round is the parent Session's round.
              if (row.parentId !== undefined || row.origin === 'subagent') return;
              if (!preference.getSnapshot()) return;
              const Ctor = globalThis.Notification;
              if (Ctor === undefined || Ctor.permission !== 'granted') return;
              if (!inBackground()) return;

              const session = row.displayTitle;
              const body =
                elapsedMs === undefined
                  ? t('notify.body', { session })
                  : t('notify.bodyWithDuration', { session, duration: formatDuration(t, elapsedMs) });
              let notification;
              try {
                notification = new Ctor(t('notify.title'), {
                  body,
                  tag: 'dsh-round-notify:' + row.id,
                  renotify: true
                });
              } catch {
                return;
              }
              notification.onclick = () => {
                notification.close();
                try {
                  globalThis.focus();
                } catch {
                  /* Focus is best-effort (some window managers refuse it). */
                }
                try {
                  ctx.get('uiWorkspace')?.openSession(row.id);
                } catch {
                  /* Opening an archived or foreign Session is not fatal. */
                }
              };
            };

            const evaluate = (state) => {
              const observedAt = Date.now();
              const present = new Set();
              for (const id of Object.keys(state.byId)) {
                const row = state.byId[id];
                present.add(id);
                const was = running.get(id);
                running.set(id, row.running);
                if (row.running) {
                  // Only a start we actually observed can time the round.
                  if (was === false) startedAt.set(id, observedAt);
                  else if (was === undefined) startedAt.delete(id);
                  continue;
                }
                const started = startedAt.get(id);
                startedAt.delete(id);
                if (was !== true) continue;
                deliver(row, started === undefined ? undefined : observedAt - started);
              }
              for (const id of [...running.keys()]) {
                if (present.has(id)) continue;
                running.delete(id);
                startedAt.delete(id);
              }
            };

            const sessions = scope.get('sessions');
            evaluate(sessions.list.getSnapshot());
            return sessions.list.subscribe(() => evaluate(sessions.list.getSnapshot()));
          }, 'round-notify: round watcher');
        });

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'round-notify',
              order: 30,
              locale: NS,
              inject: () => ({
                hooks: { roundNotify: preference },
                setRoundNotify: (enabled) => preference.set(enabled)
              })
            },
            RoundNotifyRow
          )
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'round-notify-permission',
              order: 40,
              locale: NS,
              inject: () => ({ hooks: { roundNotify: preference } })
            },
            PermissionPrompt
          )
        );
      }
    };
  }
});
