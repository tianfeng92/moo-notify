'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('google-calendar source', () => {
  let plugin, engine, broadcasts, mockEventsList;
  let tmpDir, credPath, tokenPath;
  let intervalIds;

  beforeEach(() => {
    broadcasts = [];
    intervalIds = [];
    engine = {
      logger: { info: mock.fn(), error: mock.fn() },
      broadcast(n) { broadcasts.push(n); },
    };

    // Capture setInterval calls so we can clear them
    const origSetInterval = globalThis.setInterval;
    mock.method(globalThis, 'setInterval', (...args) => {
      const id = origSetInterval(...args);
      intervalIds.push(id);
      return id;
    });

    // Create temp config dir with fake credentials and token
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcal-test-'));
    credPath = path.join(tmpDir, 'credentials.json');
    tokenPath = path.join(tmpDir, 'token.json');

    fs.writeFileSync(credPath, JSON.stringify({
      installed: {
        client_id: 'test-id',
        client_secret: 'test-secret',
      },
    }));

    fs.writeFileSync(tokenPath, JSON.stringify({
      type: 'authorized_user',
      client_id: 'test-id',
      client_secret: 'test-secret',
      refresh_token: 'test-refresh',
    }));

    // Mock googleapis
    mockEventsList = mock.fn(async () => ({ data: { items: [] } }));

    const fakeGoogle = {
      auth: {
        fromJSON: mock.fn(() => ({ credentials: { refresh_token: 'test' } })),
      },
      calendar: mock.fn(() => ({
        events: { list: mockEventsList },
      })),
    };

    // Inject into require cache
    const googMod = require.resolve('googleapis');
    require.cache[googMod] = {
      id: googMod,
      filename: googMod,
      loaded: true,
      exports: { google: fakeGoogle },
    };

    // Mock @google-cloud/local-auth
    const authMod = require.resolve('@google-cloud/local-auth');
    require.cache[authMod] = {
      id: authMod,
      filename: authMod,
      loaded: true,
      exports: { authenticate: mock.fn() },
    };

    // Clear plugin cache to pick up mocks
    const pluginPath = require.resolve('../../src/plugins/sources/google-calendar');
    delete require.cache[pluginPath];
    plugin = require('../../src/plugins/sources/google-calendar');
  });

  afterEach(() => {
    // Clear any intervals created by the plugin
    for (const id of intervalIds) clearInterval(id);
    mock.restoreAll();
  });

  it('broadcasts when event is within threshold window', async () => {
    const now = Date.now();
    const fiveMinFromNow = new Date(now + 5 * 60 * 1000).toISOString();

    mockEventsList.mock.mockImplementation(async () => ({
      data: {
        items: [{
          id: 'evt1',
          summary: 'Standup',
          start: { dateTime: fiveMinFromNow },
        }],
      },
    }));

    await plugin.start(engine, {
      configDir: tmpDir,
      thresholds: [5],
      pollInterval: 9999,
    });

    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].source, 'google-calendar');
    assert.equal(broadcasts[0].title, 'Standup');
    assert.equal(broadcasts[0].minutesBefore, 5);
  });

  it('deduplicates same event+threshold', async () => {
    const now = Date.now();
    const fiveMinFromNow = new Date(now + 5 * 60 * 1000).toISOString();

    mockEventsList.mock.mockImplementation(async () => ({
      data: {
        items: [{
          id: 'evt-dup',
          summary: 'Dup meeting',
          start: { dateTime: fiveMinFromNow },
        }],
      },
    }));

    await plugin.start(engine, {
      configDir: tmpDir,
      thresholds: [5],
      pollInterval: 9999,
    });

    // First poll broadcasts once
    assert.equal(broadcasts.length, 1);
  });

  it('skips all-day events (no dateTime)', async () => {
    mockEventsList.mock.mockImplementation(async () => ({
      data: {
        items: [{
          id: 'allday',
          summary: 'Holiday',
          start: { date: '2026-03-05' },
        }],
      },
    }));

    await plugin.start(engine, {
      configDir: tmpDir,
      thresholds: [5],
      pollInterval: 9999,
    });

    assert.equal(broadcasts.length, 0);
  });
});
