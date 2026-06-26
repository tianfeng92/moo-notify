'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOOK_SCRIPT_NAME = 'moo-status.sh';

function getHookScript(thresholdSeconds) {
  const socketPath = path.join(os.homedir(), '.config', 'moo-notify', 'notify.sock');
  const stateDir = path.join(os.homedir(), '.config', 'moo-notify', 'claude-state');

  const lines = [
    '#!/usr/bin/env bash',
    '# Claude Code hook -> moo-notify',
    '# Installed by: moo-ctl enable claude-code',
    '',
    'set -euo pipefail',
    '',
    'SOCKET="' + socketPath + '"',
    'STATE_DIR="' + stateDir + '"',
    'THRESHOLD=' + thresholdSeconds,
    '',
    'if [[ ! -S "$SOCKET" ]]; then',
    '  exit 0',
    'fi',
    '',
    'mkdir -p "$STATE_DIR"',
    '',
    'input=$(cat)',
    '',
    'event=$(echo "$input" | jq -r \'.hook_event_name // empty\')',
    'session_id=$(echo "$input" | jq -r \'.session_id // empty\')',
    'cwd=$(echo "$input" | jq -r \'.cwd // empty\')',
    '',
    'project=$(basename "$cwd")',
    'session_id="${session_id//[^a-zA-Z0-9_-]/}"',
    'stamp_file="$STATE_DIR/$session_id"',
    '',
    'send() {',
    '  printf \'%s\' "$1" | socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null || true',
    '}',
    '',
    'elapsed_ok() {',
    '  if [[ ! -f "$stamp_file" ]]; then return 1; fi',
    '  local started=$(cat "$stamp_file")',
    '  local now=$(date +%s)',
    '  (( now - started >= THRESHOLD ))',
    '}',
    '',
    'case "$event" in',
    '  UserPromptSubmit)',
    '    date +%s > "$stamp_file"',
    '    ;;',
    '  Stop)',
    '    if elapsed_ok; then',
    '      send "{\\"title\\":\\"Claude\\",\\"body\\":\\"Finished - $project\\"}"',
    '    fi',
    '    rm -f "$stamp_file"',
    '    ;;',
    '  Notification)',
    '    ntype=$(echo "$input" | jq -r \'.notification_type // empty\')',
    '    if [[ "$ntype" == "permission_prompt" ]]; then',
    '      send "{\\"title\\":\\"Claude\\",\\"body\\":\\"Waiting permission - $project\\"}"',
    '    fi',
    '    ;;',
    'esac',
  ];
  return lines.join('\n') + '\n';
}

function getClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getHookScriptPath() {
  return path.join(os.homedir(), '.claude', 'hooks', HOOK_SCRIPT_NAME);
}

const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'];

function installHook(thresholdSeconds) {
  const hookDir = path.join(os.homedir(), '.claude', 'hooks');
  if (!fs.existsSync(hookDir)) {
    fs.mkdirSync(hookDir, { recursive: true });
  }

  const hookPath = getHookScriptPath();
  fs.writeFileSync(hookPath, getHookScript(thresholdSeconds), { mode: 0o755 });

  const settingsPath = getClaudeSettingsPath();
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  const hookEntry = {
    hooks: [{ type: 'command', command: hookPath }]
  };

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [hookEntry];
    } else {
      const already = settings.hooks[event].some(group =>
        group.hooks && group.hooks.some(h => h.command && h.command.includes(HOOK_SCRIPT_NAME))
      );
      if (!already) {
        settings.hooks[event].push(hookEntry);
      }
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function uninstallHook() {
  const hookPath = getHookScriptPath();
  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
  }

  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) return;

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.hooks) return;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) continue;
    settings.hooks[event] = settings.hooks[event].filter(group =>
      !group.hooks || !group.hooks.some(h => h.command && h.command.includes(HOOK_SCRIPT_NAME))
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  const stateDir = path.join(os.homedir(), '.config', 'moo-notify', 'claude-state');
  if (fs.existsSync(stateDir)) {
    for (const f of fs.readdirSync(stateDir)) {
      fs.unlinkSync(path.join(stateDir, f));
    }
    fs.rmdirSync(stateDir);
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

module.exports = {
  name: 'claude-code',

  async start(engine, config) {
    const deps = [];
    for (const cmd of ['jq', 'socat']) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
      } catch {
        deps.push(cmd);
      }
    }
    if (deps.length > 0) {
      engine.logger.error(`[claude-code] Missing dependencies: ${deps.join(', ')}. Install with: sudo apt install ${deps.join(' ')}`);
      return;
    }

    const threshold = config.threshold || 30;
    installHook(threshold);
    engine.logger.info(`[claude-code] Installed Claude Code hooks (threshold: ${threshold}s)`);
  },

  async stop() {
    uninstallHook();
  },
};
