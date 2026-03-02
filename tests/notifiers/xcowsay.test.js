'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('xcowsay notifier', () => {
  let xcowsay;
  let spawnMock;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };

    // Mock child_process.spawn before requiring the module
    spawnMock = mock.fn(() => {
      const child = {
        on: mock.fn(),
        unref: mock.fn(),
      };
      return child;
    });

    // Clear require cache so we get a fresh module
    const modPath = require.resolve('../../src/plugins/notifiers/xcowsay');
    delete require.cache[modPath];

    // Inject mock into require cache for child_process
    const origCP = require('child_process');
    mock.method(origCP, 'spawn', spawnMock);

    xcowsay = require('../../src/plugins/notifiers/xcowsay');
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restoreAll();
  });

  it('spawns xcowsay with correct args', async () => {
    process.env.DISPLAY = ':1';
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/tmp/bus';

    await xcowsay.notify({ body: 'Hello cow' }, { time: 10, monitor: 2 });

    assert.equal(spawnMock.mock.callCount(), 1);
    const call = spawnMock.mock.calls[0];
    assert.equal(call.arguments[0], 'xcowsay');
    assert.deepEqual(call.arguments[1], ['--time=10', '--monitor=2', 'Hello cow']);
    assert.equal(call.arguments[2].detached, true);
    assert.equal(call.arguments[2].stdio, 'ignore');
  });

  it('uses default time=8 and monitor=0', async () => {
    process.env.DISPLAY = ':0';
    await xcowsay.notify({ body: 'test' }, {});

    const args = spawnMock.mock.calls[0].arguments[1];
    assert.deepEqual(args, ['--time=8', '--monitor=0', 'test']);
  });

  it('sets DISPLAY when missing', async () => {
    delete process.env.DISPLAY;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;

    await xcowsay.notify({ body: 'test' }, {});

    const env = spawnMock.mock.calls[0].arguments[2].env;
    assert.equal(env.DISPLAY, ':0');
    assert.match(env.DBUS_SESSION_BUS_ADDRESS, /^unix:path=\/run\/user\/\d+\/bus$/);
  });
});
