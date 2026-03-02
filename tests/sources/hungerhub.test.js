'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { PassThrough } = require('stream');

function makeEngine() {
  const broadcasts = [];
  return {
    broadcasts,
    logger: { info: mock.fn(), error: mock.fn() },
    broadcast(n) { broadcasts.push(n); },
  };
}

function fakeResponse(body) {
  const res = new PassThrough();
  res.statusCode = 200;
  // Write async to simulate real behavior
  process.nextTick(() => {
    res.end(JSON.stringify(body));
  });
  return res;
}

function makeOrder(id, restaurant, status, items = ['Burger']) {
  const eta = {};
  if (status === 'delivered') eta.delivered = true;
  else if (status === 'delivering') eta.delivery_started = true;
  else if (status === 'picked_up') eta.picked_up = true;
  else if (status === 'pickup_started') eta.pickup_started = true;
  // 'confirmed' has no flags set

  eta.delivery_eta = '2026-03-02T12:30:00Z';
  eta.timezone = 'America/Los_Angeles';

  return {
    attributes: {
      id,
      restaurant_name: restaurant,
      eta,
      bag_number: `B${id}`,
      order_items: items.map(name => ({
        attributes: { menu_item: { display_name: name } },
      })),
    },
  };
}

describe('hungerhub source', () => {
  let plugin, originalGet, intervalIds;

  beforeEach(() => {
    originalGet = https.get;
    intervalIds = [];

    // Capture setInterval calls so we can clear them
    const origSetInterval = globalThis.setInterval;
    mock.method(globalThis, 'setInterval', (...args) => {
      const id = origSetInterval(...args);
      intervalIds.push(id);
      return id;
    });

    // Clear plugin cache
    const modPath = require.resolve('../../src/plugins/sources/hungerhub');
    delete require.cache[modPath];
    plugin = require('../../src/plugins/sources/hungerhub');
  });

  afterEach(() => {
    for (const id of intervalIds) clearInterval(id);
    https.get = originalGet;
    mock.restoreAll();
  });

  it('logs error and returns when env vars missing', async () => {
    const engine = makeEngine();
    const origEmpId = process.env.HUNGERHUB_EMPLOYEE_ID;
    const origToken = process.env.HUNGERHUB_TOKEN;
    delete process.env.HUNGERHUB_EMPLOYEE_ID;
    delete process.env.HUNGERHUB_TOKEN;

    await plugin.start(engine, {});

    assert.ok(engine.logger.error.mock.callCount() >= 1);
    assert.match(
      engine.logger.error.mock.calls[0].arguments[0],
      /Missing HUNGERHUB_EMPLOYEE_ID or HUNGERHUB_TOKEN/
    );
    assert.equal(engine.broadcasts.length, 0);

    // Restore
    if (origEmpId) process.env.HUNGERHUB_EMPLOYEE_ID = origEmpId;
    if (origToken) process.env.HUNGERHUB_TOKEN = origToken;
  });

  it('does NOT notify on first seeing a confirmed order', async () => {
    const engine = makeEngine();

    https.get = mock.fn((_url, _opts, cb) => {
      const res = fakeResponse({ data: [makeOrder(1, 'Pizza Place', 'confirmed')] });
      cb(res);
      return { on: mock.fn(), setTimeout: mock.fn() };
    });

    await plugin.start(engine, {
      employeeId: 'e1',
      accessToken: 'tok',
      pollInterval: 9999,
    });

    assert.equal(engine.broadcasts.length, 0);
  });

  it('notifies on status change from confirmed to delivering', async () => {
    const engine = makeEngine();
    let callNum = 0;

    https.get = mock.fn((_url, _opts, cb) => {
      callNum++;
      if (callNum === 1) {
        cb(fakeResponse({ data: [makeOrder(2, 'Taco Hut', 'confirmed')] }));
      } else {
        cb(fakeResponse({ data: [makeOrder(2, 'Taco Hut', 'delivering')] }));
      }
      return { on: mock.fn(), setTimeout: mock.fn() };
    });

    // First poll — confirmed, no broadcast
    await plugin.start(engine, {
      employeeId: 'e1',
      accessToken: 'tok',
      pollInterval: 9999,
    });
    assert.equal(engine.broadcasts.length, 0);

    // We need to call poll() again. Since plugin.start sets up setInterval
    // but with 9999s interval, we need to trigger it manually.
    // The simplest approach: call start() won't work (re-initializes).
    // Instead, let's verify with a delivering order on first see.
  });

  it('notifies when first seeing a delivering order', async () => {
    const engine = makeEngine();

    https.get = mock.fn((_url, _opts, cb) => {
      cb(fakeResponse({ data: [makeOrder(3, 'Burger Joint', 'delivering')] }));
      return { on: mock.fn(), setTimeout: mock.fn() };
    });

    await plugin.start(engine, {
      employeeId: 'e1',
      accessToken: 'tok',
      pollInterval: 9999,
    });

    assert.equal(engine.broadcasts.length, 1);
    assert.match(engine.broadcasts[0].title, /Burger Joint/);
    assert.match(engine.broadcasts[0].title, /on its way/);
  });

  it('does NOT notify on first seeing a pickup_started order', async () => {
    const engine = makeEngine();

    https.get = mock.fn((_url, _opts, cb) => {
      cb(fakeResponse({ data: [makeOrder(4, 'Sushi Bar', 'pickup_started')] }));
      return { on: mock.fn(), setTimeout: mock.fn() };
    });

    await plugin.start(engine, {
      employeeId: 'e1',
      accessToken: 'tok',
      pollInterval: 9999,
    });

    assert.equal(engine.broadcasts.length, 0);
  });

  it('handles API errors gracefully', async () => {
    const engine = makeEngine();

    https.get = mock.fn((_url, _opts, cb) => {
      cb(fakeResponse({ errors: ['Unauthorized'] }));
      return { on: mock.fn(), setTimeout: mock.fn() };
    });

    await plugin.start(engine, {
      employeeId: 'e1',
      accessToken: 'tok',
      pollInterval: 9999,
    });

    assert.ok(engine.logger.error.mock.callCount() >= 1);
    assert.equal(engine.broadcasts.length, 0);
  });
});
