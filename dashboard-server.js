import express from 'express';
import { readFileSync, existsSync, watchFile } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import { FirebaseService } from './firebase-service.js';
import { SimpleMarketMonitor } from './simple-market-monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.clients = new Set();
    this.coinsFile = path.join(__dirname, 'launched-coins.json');
    this.usersFile = path.join(__dirname, 'launched-users.json');
    this.firebaseService = new FirebaseService();
    this.marketMonitor = new SimpleMarketMonitor();
    this.updateInterval = null;
    this.lastUpdateTime = 0;
    this.cachedCoins = [];
    this.cacheTime = 0;
    this.setupRoutes();
    this.setupWebSocket();
    this.watchDataFiles();
  }

  setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.static(__dirname));

    this.app.post('/api/activity', (req, res) => {
      try {
        const { message, type } = req.body;
        if (message) {
          this.broadcastActivity(message, type || 'info');
          res.json({ success: true });
        } else {
          res.status(400).json({ error: 'Message required' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to broadcast activity' });
      }
    });

    this.app.get('/api/coins', async (req, res) => {
      try {
        const coins = await this.getLatestCoinsData();
        res.json(coins);
      } catch (error) {
        res.status(500).json({ error: 'Failed to load coins data' });
      }
    });

    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = await this.firebaseService.getGlobalStats();
        stats.lastUpdated = new Date().toISOString();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: 'Failed to load stats' });
      }
    });

    this.app.get('/api/activity', async (req, res) => {
      try {
        const activity = await this.firebaseService.getRecentActivity(50);
        res.json(activity);
      } catch (error) {
        res.status(500).json({ error: 'Failed to load activity' });
      }
    });

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard.html'));
    });
  }

  setupWebSocket() {
    this.wss.on('connection', async (ws) => {
      this.clients.add(ws);

      // Send cached data immediately, then fetch fresh data
      if (this.cachedCoins.length > 0) {
        ws.send(JSON.stringify({
          type: 'init',
          data: { coins: this.cachedCoins, users: [] }
        }));
      }

      // Fetch fresh data in background
      const coins = await this.getLatestCoinsData();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'update',
          data: { coins, users: [], timestamp: new Date().toISOString() }
        }));
      }

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  watchDataFiles() {
    if (existsSync(this.coinsFile)) {
      watchFile(this.coinsFile, { interval: 1000 }, () => {
        this.broadcastUpdate();
      });
    }

    if (existsSync(this.usersFile)) {
      watchFile(this.usersFile, { interval: 1000 }, () => {
        this.broadcastUpdate();
      });
    }
  }

  loadCoinsData() {
    if (!existsSync(this.coinsFile)) return [];

    try {
      const data = readFileSync(this.coinsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  loadUsersData() {
    if (!existsSync(this.usersFile)) return [];

    try {
      const data = readFileSync(this.usersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async getLatestCoinsData() {
    try {
      const firebaseCoins = await this.firebaseService.getAllCoins();

      if (firebaseCoins.length === 0) {
        return this.loadCoinsData();
      }

      const formattedCoins = firebaseCoins.map(coin => ({
        id: coin.contractAddress,
        ...coin,
        lastUpdate: coin.lastUpdated || coin.lastUpdate || new Date().toISOString()
      }));

      // Update cache
      this.cachedCoins = formattedCoins;
      this.cacheTime = Date.now();

      return formattedCoins;

    } catch (error) {
      return this.loadCoinsData();
    }
  }

  async broadcastUpdate() {
    const coinsData = await this.getLatestCoinsData();

    const now = Date.now();
    const secondsInCurrentCycle = Math.floor((now / 1000) % 30);
    const nextUpdateTimestamp = now + ((30 - secondsInCurrentCycle) * 1000);

    const data = {
      type: 'update',
      data: {
        coins: coinsData,
        users: this.loadUsersData(),
        timestamp: new Date().toISOString(),
        nextUpdateTimestamp: nextUpdateTimestamp
      }
    };

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });

    this.lastUpdateTime = Date.now();
  }

  getNextUpdateTime() {
    const now = Date.now();
    const secondsInCurrentCycle = Math.floor((now / 1000) % 30);
    return 30 - secondsInCurrentCycle;
  }

  startAutoUpdates() {
    this.marketMonitor.start();

    const now = Date.now();
    const secondsInCurrentCycle = Math.floor((now / 1000) % 30);
    const millisecondsToNextCycle = (30 - secondsInCurrentCycle) * 1000;

    setTimeout(() => {
      this.broadcastUpdate();

      this.updateInterval = setInterval(async () => {
        await this.broadcastUpdate();
      }, 30000);
    }, millisecondsToNextCycle);

    // Immediate update
    setTimeout(() => this.broadcastUpdate(), 500);
  }

  stopAutoUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.marketMonitor) {
      this.marketMonitor.stop();
    }
  }

  async start() {
    // Pre-initialize Firebase before starting server
    await this.firebaseService.initialize();

    // Pre-fetch coins data
    this.cachedCoins = await this.getLatestCoinsData();

    // Setup Firebase real-time listener
    await this.setupFirebaseRealtimeListener();

    this.server.listen(this.port, () => {
      console.log(`🚀 Dashboard: http://localhost:${this.port}`);
      this.startAutoUpdates();
    });
  }

  async setupFirebaseRealtimeListener() {
    try {
      if (!this.firebaseService.db) return;

      const coinsRef = this.firebaseService.db.ref('coins');

      coinsRef.on('child_added', async (snapshot) => {
        const coinData = snapshot.val();
        const contractAddress = snapshot.key;

        if (coinData) {
          const formattedCoin = {
            id: contractAddress,
            contractAddress,
            ...coinData
          };

          this.broadcastNewCoin(formattedCoin);
        }
      });

      const activityRef = this.firebaseService.db.ref('activity');
      activityRef.on('child_added', (snapshot) => {
        const activityData = snapshot.val();
        if (activityData) {
          this.broadcastActivity(activityData.message, activityData.type);
        }
      });

    } catch (error) {
      // Silent fail
    }
  }

  broadcastNewCoin(coinData) {
    const message = {
      type: 'new_coin',
      data: coinData,
      timestamp: new Date().toISOString()
    };

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  broadcastActivity(messageText, type = 'info') {
    const message = {
      type: 'activity',
      data: {
        type: type,
        message: messageText
      },
      timestamp: new Date().toISOString()
    };

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  stop() {
    this.stopAutoUpdates();
    this.server.close();
  }
}

const server = new DashboardServer(3000);
server.start();

global.dashboardServer = server;

process.on('SIGINT', () => {
  server.stop();
  process.exit(0);
});

export { DashboardServer };
