import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.proxyUsage = new Map(); // Track last used time for each proxy
    this.currentIndex = 0;
    this.cooldownPeriod = 76000; // 76 seconds (slightly more than 75 for safety)
    this.loadProxies();
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[ProxyManager ${timestamp}] ${message}`);
  }

  loadProxies() {
    const proxiesFile = join(__dirname, 'proxies.txt');

    if (!existsSync(proxiesFile)) {
      this.log('⚠️ proxies.txt not found, using fallback proxies');
      // Fallback to original hardcoded proxies
      this.proxies = [
        { server: 'http://91.207.57.22:10041', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
        { server: 'http://91.207.57.22:10043', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
        { server: 'http://91.207.57.22:10046', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
        { server: 'http://91.207.57.22:10047', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
        { server: 'http://91.207.57.22:10052', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
        { server: 'http://91.207.57.22:10053', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' }
      ];
      this.cooldownPeriod = 10000; // 10 seconds for smaller proxy pool
      return;
    }

    try {
      const fileContent = readFileSync(proxiesFile, 'utf8');
      const lines = fileContent.split('\n').filter(line => line.trim());

      this.proxies = lines.map(line => {
        const trimmed = line.trim();
        // Expected format: username:password@host:port
        const match = trimmed.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);

        if (!match) {
          this.log(`⚠️ Invalid proxy format: ${trimmed}`);
          return null;
        }

        return {
          server: `http://${match[3]}:${match[4]}`,
          username: match[1],
          password: match[2]
        };
      }).filter(proxy => proxy !== null);

      this.log(`✅ Loaded ${this.proxies.length} proxies from proxies.txt`);

      if (this.proxies.length === 0) {
        throw new Error('No valid proxies found');
      }

    } catch (error) {
      this.log(`❌ Error loading proxies: ${error.message}`);
      this.log('Using fallback proxies');
      this.loadProxies(); // Fallback to hardcoded proxies
    }
  }

  getNextAvailableProxy() {
    const now = Date.now();

    // Try to find an available proxy (not used recently)
    for (let i = 0; i < this.proxies.length; i++) {
      const proxyIndex = (this.currentIndex + i) % this.proxies.length;
      const proxy = this.proxies[proxyIndex];
      const proxyId = `${proxy.server}-${proxy.username}`;

      const lastUsed = this.proxyUsage.get(proxyId) || 0;
      const timeSinceLastUse = now - lastUsed;

      if (timeSinceLastUse >= this.cooldownPeriod) {
        // Mark this proxy as used
        this.proxyUsage.set(proxyId, now);
        this.currentIndex = (proxyIndex + 1) % this.proxies.length;

        const waitTime = Math.max(0, this.cooldownPeriod - timeSinceLastUse);
        this.log(`✅ Selected proxy ${proxyIndex + 1}/${this.proxies.length} (${proxy.server}) - cooldown: ${Math.floor(waitTime/1000)}s`);

        return proxy;
      }
    }

    // All proxies are in cooldown, return the one with longest wait time
    let oldestProxy = null;
    let oldestTime = now;
    let oldestIndex = 0;

    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[i];
      const proxyId = `${proxy.server}-${proxy.username}`;
      const lastUsed = this.proxyUsage.get(proxyId) || 0;

      if (lastUsed < oldestTime) {
        oldestTime = lastUsed;
        oldestProxy = proxy;
        oldestIndex = i;
      }
    }

    if (oldestProxy) {
      const waitTime = Math.max(0, this.cooldownPeriod - (now - oldestTime));
      this.log(`⏰ All proxies in cooldown, using oldest: ${oldestIndex + 1}/${this.proxies.length} (wait: ${Math.floor(waitTime/1000)}s)`);

      // Mark as used
      const proxyId = `${oldestProxy.server}-${oldestProxy.username}`;
      this.proxyUsage.set(proxyId, now);

      return oldestProxy;
    }

    // Fallback to first proxy
    this.log(`⚠️ Fallback to first proxy`);
    return this.proxies[0];
  }

  getProxyStats() {
    const now = Date.now();
    const stats = {
      totalProxies: this.proxies.length,
      availableProxies: 0,
      cooldownProxies: 0,
      averageCooldown: 0
    };

    let totalCooldown = 0;

    for (const proxy of this.proxies) {
      const proxyId = `${proxy.server}-${proxy.username}`;
      const lastUsed = this.proxyUsage.get(proxyId) || 0;
      const timeSinceLastUse = now - lastUsed;

      if (timeSinceLastUse >= this.cooldownPeriod) {
        stats.availableProxies++;
      } else {
        stats.cooldownProxies++;
        totalCooldown += (this.cooldownPeriod - timeSinceLastUse);
      }
    }

    if (stats.cooldownProxies > 0) {
      stats.averageCooldown = Math.floor(totalCooldown / stats.cooldownProxies / 1000);
    }

    return stats;
  }

  getCooldownPeriod() {
    return this.cooldownPeriod;
  }
}

export { ProxyManager };