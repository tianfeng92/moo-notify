'use strict';

const https = require('https');

const API_URL = 'https://nbe.hungerhub.com/api/v1/company/orders';

module.exports = {
  name: 'hungerhub',

  async start(engine, config) {
    const employeeId = process.env.HUNGERHUB_EMPLOYEE_ID || config.employeeId;
    const accessToken = process.env.HUNGERHUB_TOKEN || config.accessToken;
    const pollInterval = config.pollInterval || 120;

    if (!employeeId || !accessToken) {
      engine.logger.error('[hungerhub] Missing HUNGERHUB_EMPLOYEE_ID or HUNGERHUB_TOKEN env vars');
      return;
    }

    // Track status per order to only notify on changes
    const orderState = new Map();

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
        for (const id of orderState.keys()) {
          if (!orders.some(o => o.attributes.id === id)) {
            orderState.delete(id);
          }
        }
      } catch (err) {
        engine.logger.error(`[hungerhub] Poll error: ${err.message}`);
      }
    }

    await poll();
    setInterval(poll, pollInterval * 1000);
  },
};
