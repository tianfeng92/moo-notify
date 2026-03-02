#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const NotificationEngine = require('./src/engine');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'moo-notify');
const LOG_PATH = path.join(CONFIG_DIR, 'broadcast.log');

if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function log(level, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const msg = `${ts} ${level} ${args.join(' ')}`;
  console.log(msg);
  logStream.write(msg + '\n');
}

const logger = {
  info: (...a) => log('INFO', ...a),
  error: (...a) => log('ERROR', ...a),
};

async function main() {
  const engine = new NotificationEngine(logger);

  // Default configuration
  const config = {
    sources: [
      { path: './src/plugins/sources/google-calendar', config: {} },
      { path: './src/plugins/sources/unix-socket', config: {} },
      { path: './src/plugins/sources/hungerhub', config: {} },
    ],
    notifiers: [
      { path: './src/plugins/notifiers/xcowsay', config: { time: 8, monitor: 0 } }
    ]
  };

  // Load custom config if exists
  const customConfigPath = path.join(CONFIG_DIR, 'config.json');
  if (fs.existsSync(customConfigPath)) {
    try {
      const customConfig = JSON.parse(fs.readFileSync(customConfigPath, 'utf8'));
      Object.assign(config, customConfig);
      logger.info('Loaded custom configuration');
    } catch (err) {
      logger.error(`Error loading custom config: ${err.message}`);
    }
  }

  // Load Notifiers first
  for (const n of config.notifiers) {
    const pluginPath = n.path.startsWith('.') ? path.resolve(__dirname, n.path) : n.path;
    await engine.loadPlugin(pluginPath, 'notifier', n.config);
  }

  // Load Sources
  for (const s of config.sources) {
    const pluginPath = s.path.startsWith('.') ? path.resolve(__dirname, s.path) : s.path;
    await engine.loadPlugin(pluginPath, 'source', s.config);
  }

  logger.info('Notification Broadcast Service started');
}

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
