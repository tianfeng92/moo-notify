'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class NotificationEngine extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.sources = new Map();
    this.notifiers = new Map();
  }

  async loadPlugin(pluginPath, type, config = {}) {
    try {
      const plugin = require(pluginPath);
      const name = plugin.name || path.basename(pluginPath, '.js');

      if (type === 'source') {
        this.sources.set(name, plugin);
        await plugin.start(this, config);
        this.logger.info(`Loaded source plugin: ${name}`);
      } else if (type === 'notifier') {
        this.notifiers.set(name, { plugin, config });
        if (plugin.init) await plugin.init(this, config);
        this.logger.info(`Loaded notifier plugin: ${name}`);
      }
    } catch (err) {
      this.logger.error(`Failed to load plugin from ${pluginPath}: ${err.message}`);
    }
  }

  broadcast(notification) {
    this.logger.info(`Broadcasting notification: ${notification.title || 'No Title'}`);
    this.emit('notification', notification);
    
    for (const [name, { plugin, config }] of this.notifiers) {
      try {
        plugin.notify(notification, config).catch(err => {
          this.logger.error(`Notifier ${name} failed: ${err.message}`);
        });
      } catch (err) {
        this.logger.error(`Notifier ${name} sync error: ${err.message}`);
      }
    }
  }
}

module.exports = NotificationEngine;
