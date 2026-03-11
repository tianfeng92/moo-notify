'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_URL = 'https://nbe.hungerhub.com/api/v1/company/orders';
const STATE_PATH = path.join(os.homedir(), '.config', 'moo-notify', 'hungerhub-state.json');

module.exports = {
  name: 'hungerhub',

  async start(engine, config) {
    const employeeId = process.env.HUNGERHUB_EMPLOYEE_ID || config.employeeId;
    const accessToken = process.env.HUNGERHUB_TOKEN || config.accessToken;
    const pollInterval = config.pollInterval || 120;
    // activeHours: { days: [1, 3], from: '09:00', to: '13:00' }
    // days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const activeHours = config.activeHours || null;

    if (!employeeId || !accessToken) {
      engine.logger.error('[hungerhub] Missing HUNGERHUB_EMPLOYEE_ID or HUNGERHUB_TOKEN env vars');
      return;
    }

    function isActiveNow() {
      if (!activeHours) return true;
      const now = new Date();
      const tz = activeHours.timezone || 'America/Los_Angeles';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const weekdayStr = parts.find(p => p.type === 'weekday').value;
      const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const currentDay = weekdayMap[weekdayStr];
      const hours = parts.find(p => p.type === 'hour').value;
      const minutes = parts.find(p => p.type === 'minute').value;
      const currentTime = `${hours}:${minutes}`;

      const days = activeHours.days || [1, 3];
      if (!days.includes(currentDay)) return false;

      const from = activeHours.from || '00:00';
      const to = activeHours.to || '23:59';
      return currentTime >= from && currentTime <= to;
    }

    // Track status per order to only notify on changes — persisted to disk
    const orderState = new Map();

    function loadState() {
      try {
        if (fs.existsSync(STATE_PATH)) {
          const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
          for (const [k, v] of Object.entries(data)) {
            orderState.set(Number(k), v);
          }
        }
      } catch (err) {
        engine.logger.error(`[hungerhub] Failed to load state: ${err.message}`);
      }
    }

    function saveState() {
      try {
        const obj = Object.fromEntries(orderState);
        fs.writeFileSync(STATE_PATH, JSON.stringify(obj) + '\n');
      } catch (err) {
        engine.logger.error(`[hungerhub] Failed to save state: ${err.message}`);
      }
    }

    loadState();

    function fetchOrders() {
      return new Promise((resolve, reject) => {
        const url = `${API_URL}?employee_id=${employeeId}&status=active&page=1&per_page=20`;
        const req = https.get(url, { headers: { 'Access-Token': accessToken } }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse response: ${err.message}`));
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
      });
    }

    function formatEta(isoString, timezone) {
      if (!isoString) return 'unknown';
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone || 'America/Los_Angeles',
      });
    }

    function getStatusSummary(eta) {
      if (eta.delivered) return 'delivered';
      if (eta.delivery_started) return 'delivering';
      if (eta.picked_up) return 'picked_up';
      if (eta.pickup_started) return 'pickup_started';
      return 'confirmed';
    }

    const statusMessages = {
      pickup_started: 'is being prepared',
      picked_up: 'has been picked up',
      delivering: 'is on its way',
      delivered: 'has arrived!',
    };

    async function poll() {
      if (!isActiveNow()) {
        engine.logger.info('[hungerhub] Outside active hours, skipping poll');
        return;
      }
      try {
        const resp = await fetchOrders();

        if (resp.errors) {
          engine.logger.error(`[hungerhub] API error: ${resp.errors.join(', ')}`);
          return;
        }

        const orders = resp.data || [];

        for (const order of orders) {
          const attr = order.attributes;
          const orderId = attr.id;
          const eta = attr.eta || {};
          const currentStatus = getStatusSummary(eta);
          const prevStatus = orderState.get(orderId);

          const items = (attr.order_items || [])
            .map(i => i.attributes.menu_item.display_name)
            .join(', ');

          const restaurant = attr.restaurant_name.trim();
          const deliveryEta = formatEta(eta.delivery_eta, eta.timezone);
          const bagNumber = attr.bag_number;

          // First time seeing this order — log it but only notify if interesting
          if (!prevStatus) {
            orderState.set(orderId, currentStatus);
            saveState();
            engine.logger.info(`[hungerhub] Tracking order #${orderId} from ${restaurant} (${currentStatus})`);

            if (currentStatus !== 'confirmed' && currentStatus !== 'pickup_started') {
              engine.broadcast({
                source: 'hungerhub',
                title: `${restaurant} - ${statusMessages[currentStatus] || currentStatus}`,
                body: `${restaurant} ${statusMessages[currentStatus] || currentStatus}\nItems: ${items}\nBag #${bagNumber} | ETA: ${deliveryEta}`,
              });
            }
            continue;
          }

          // Status changed — notify
          if (currentStatus !== prevStatus) {
            orderState.set(orderId, currentStatus);
            saveState();
            const msg = statusMessages[currentStatus] || currentStatus;
            engine.logger.info(`[hungerhub] Order #${orderId}: ${prevStatus} -> ${currentStatus}`);

            engine.broadcast({
              source: 'hungerhub',
              title: `${restaurant} - ${msg}`,
              body: `Your ${restaurant} order ${msg}\nItems: ${items}\nBag #${bagNumber} | ETA: ${deliveryEta}`,
            });
          }
        }

        // Clean up orders no longer active
        let cleaned = false;
        for (const id of orderState.keys()) {
          if (!orders.some(o => o.attributes.id === id)) {
            orderState.delete(id);
            cleaned = true;
          }
        }
        if (cleaned) saveState();
      } catch (err) {
        engine.logger.error(`[hungerhub] Poll error: ${err.message}`);
      }
    }

    await poll();
    setInterval(poll, pollInterval * 1000);
  },
};
