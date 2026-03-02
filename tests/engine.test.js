'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const NotificationEngine = require('../src/engine');

function makeLogger() {
  return {
    info: mock.fn(),
    error: mock.fn(),
  };
}

describe('NotificationEngine', () => {
  let engine, logger;

  beforeEach(() => {
    logger = makeLogger();
    engine = new NotificationEngine(logger);
  });

  describe('loadPlugin() — source', () => {
    it('calls plugin.start(engine, config)', async () => {
      const start = mock.fn(async () => {});
      const pluginPath = path.join(__dirname, '_fixtures', 'fake-source');
      // Create an inline module mock via require cache
      const fakePlugin = { name: 'fake-source', start };
      require.cache[require.resolve(pluginPath)] = {
        id: pluginPath,
        filename: pluginPath,
        loaded: true,
        exports: fakePlugin,
      };

      await engine.loadPlugin(pluginPath, 'source', { foo: 1 });

      assert.equal(start.mock.callCount(), 1);
      assert.equal(start.mock.calls[0].arguments[0], engine);
      assert.deepEqual(start.mock.calls[0].arguments[1], { foo: 1 });
      assert.equal(engine.sources.get('fake-source'), fakePlugin);

      delete require.cache[require.resolve(pluginPath)];
    });
  });

  describe('loadPlugin() — notifier', () => {
    it('stores the notifier and calls plugin.init() if present', async () => {
      const init = mock.fn(async () => {});
      const notify = mock.fn(async () => {});
      const pluginPath = path.join(__dirname, '_fixtures', 'fake-notifier');
      const fakePlugin = { name: 'fake-notifier', init, notify };
      require.cache[require.resolve(pluginPath)] = {
        id: pluginPath,
        filename: pluginPath,
        loaded: true,
        exports: fakePlugin,
      };

      const config = { time: 5 };
      await engine.loadPlugin(pluginPath, 'notifier', config);

      assert.equal(init.mock.callCount(), 1);
      assert.equal(init.mock.calls[0].arguments[0], engine);
      const stored = engine.notifiers.get('fake-notifier');
      assert.equal(stored.plugin, fakePlugin);
      assert.deepEqual(stored.config, config);

      delete require.cache[require.resolve(pluginPath)];
    });

    it('works without init()', async () => {
      const notify = mock.fn(async () => {});
      const pluginPath = path.join(__dirname, '_fixtures', 'fake-notifier-noinit');
      const fakePlugin = { name: 'no-init', notify };
      require.cache[require.resolve(pluginPath)] = {
        id: pluginPath,
        filename: pluginPath,
        loaded: true,
        exports: fakePlugin,
      };

      await engine.loadPlugin(pluginPath, 'notifier');
      assert.ok(engine.notifiers.has('no-init'));

      delete require.cache[require.resolve(pluginPath)];
    });
  });

  describe('loadPlugin() — error handling', () => {
    it('logs error on bad path and does not crash', async () => {
      await engine.loadPlugin('/nonexistent/plugin.js', 'source');

      assert.equal(logger.error.mock.callCount(), 1);
      assert.match(logger.error.mock.calls[0].arguments[0], /Failed to load plugin/);
      assert.equal(engine.sources.size, 0);
    });
  });

  describe('broadcast()', () => {
    it('calls all notifiers with notification and config', () => {
      const notify1 = mock.fn(async () => {});
      const notify2 = mock.fn(async () => {});
      engine.notifiers.set('a', { plugin: { notify: notify1 }, config: { x: 1 } });
      engine.notifiers.set('b', { plugin: { notify: notify2 }, config: { y: 2 } });

      const notification = { title: 'Hello', body: 'World', source: 'test' };
      engine.broadcast(notification);

      assert.equal(notify1.mock.callCount(), 1);
      assert.deepEqual(notify1.mock.calls[0].arguments[0], notification);
      assert.deepEqual(notify1.mock.calls[0].arguments[1], { x: 1 });

      assert.equal(notify2.mock.callCount(), 1);
      assert.deepEqual(notify2.mock.calls[0].arguments[0], notification);
      assert.deepEqual(notify2.mock.calls[0].arguments[1], { y: 2 });
    });

    it('emits "notification" event', () => {
      const handler = mock.fn();
      engine.on('notification', handler);

      const notification = { title: 'Test', body: 'Body', source: 'x' };
      engine.broadcast(notification);

      assert.equal(handler.mock.callCount(), 1);
      assert.deepEqual(handler.mock.calls[0].arguments[0], notification);
    });

    it('catches sync errors from notifiers', () => {
      engine.notifiers.set('bad', {
        plugin: {
          notify() { throw new Error('boom'); },
        },
        config: {},
      });

      assert.doesNotThrow(() => {
        engine.broadcast({ body: 'test', source: 'x' });
      });

      assert.equal(logger.error.mock.callCount(), 1); // sync error logged
    });
  });
});
