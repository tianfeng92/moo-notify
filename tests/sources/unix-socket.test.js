'use strict';

const { describe, it, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('unix-socket source', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-test-'));
  const socketPath = path.join(tmpDir, 'test.sock');

  // Capture the server so we can close it in after()
  let capturedServer;
  const origCreateServer = net.createServer.bind(net);
  mock.method(net, 'createServer', (cb) => {
    capturedServer = origCreateServer(cb);
    return capturedServer;
  });

  const modPath = require.resolve('../../src/plugins/sources/unix-socket');
  delete require.cache[modPath];
  const plugin = require('../../src/plugins/sources/unix-socket');

  const broadcasts = [];
  const engine = {
    logger: { info: mock.fn(), error: mock.fn() },
    broadcast(n) { broadcasts.push(n); },
  };

  after(() => {
    if (capturedServer) capturedServer.close();
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  });

  it('broadcasts notification from JSON sent to socket', async () => {
    await plugin.start(engine, { socketPath });

    // Wait for server to be listening
    await new Promise(r => setTimeout(r, 50));

    await new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ title: 'Hi', body: 'From socket' }));
        client.end();
      });
      client.on('error', reject);
      setTimeout(resolve, 100);
    });

    assert.ok(broadcasts.length >= 1, 'expected at least one broadcast');
    const n = broadcasts[0];
    assert.equal(n.source, 'unix-socket');
    assert.equal(n.title, 'Hi');
    assert.equal(n.body, 'From socket');
  });

  it('handles invalid JSON without crashing', async () => {
    const errorsBefore = engine.logger.error.mock.callCount();

    await new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write('not valid json{{{');
        client.end();
      });
      client.on('error', reject);
      setTimeout(resolve, 100);
    });

    assert.ok(
      engine.logger.error.mock.callCount() > errorsBefore,
      'expected an error to be logged'
    );
  });
});
