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
    this.setupRoutes();
    this.setupWebSocket();
    this.watchDataFiles();
    this.setupFirebaseRealtimeListener();
  }

  setupRoutes() {
    // Middleware for parsing JSON
    this.app.use(express.json());

    // Serve static files
    this.app.use(express.static(__dirname));

    // API endpoint for activity broadcasting
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

    // API endpoint for coins data
    this.app.get('/api/coins', async (req, res) => {
      try {
        const coins = await this.getLatestCoinsData();
        res.json(coins);
      } catch (error) {
        console.error('Error loading coins:', error);
        res.status(500).json({ error: 'Failed to load coins data' });
      }
    });

    // API endpoint for stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        // Get stats from Firebase (computed during market monitor updates)
        const stats = await this.firebaseService.getGlobalStats();

        // Add timestamp
        stats.lastUpdated = new Date().toISOString();

        res.json(stats);
      } catch (error) {
        console.error('Error loading stats:', error);
        res.status(500).json({ error: 'Failed to load stats' });
      }
    });

    // API endpoint for activity feed (from Firebase)
    this.app.get('/api/activity', async (req, res) => {
      try {
        const activity = await this.firebaseService.getRecentActivity(50);
        res.json(activity);
      } catch (error) {
        console.error('Error loading activity:', error);
        res.status(500).json({ error: 'Failed to load activity' });
      }
    });

    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard.html'));
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket client connected');
      this.clients.add(ws);

      // Send initial data
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          coins: this.loadCoinsData(),
          users: this.loadUsersData()
        }
      }));

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  watchDataFiles() {
    // Watch coins file for changes
    if (existsSync(this.coinsFile)) {
      watchFile(this.coinsFile, { interval: 1000 }, () => {
        console.log('Coins data updated, broadcasting to clients...');
        this.broadcastUpdate();
      });
    }

    // Watch users file for changes
    if (existsSync(this.usersFile)) {
      watchFile(this.usersFile, { interval: 1000 }, () => {
        console.log('Users data updated, broadcasting to clients...');
        this.broadcastUpdate();
      });
    }
  }

  loadCoinsData() {
    if (!existsSync(this.coinsFile)) {
      return [];
    }

    try {
      const data = readFileSync(this.coinsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading coins file:', error);
      return [];
    }
  }

  loadUsersData() {
    if (!existsSync(this.usersFile)) {
      return [];
    }

    try {
      const data = readFileSync(this.usersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading users file:', error);
      return [];
    }
  }

  async getLatestCoinsData() {
    try {
      // Simply get coins from Firebase - the market monitor handles updates
      const firebaseCoins = await this.firebaseService.getAllCoins();

      if (firebaseCoins.length === 0) {
        // Fallback to local file if Firebase is empty/unavailable
        return this.loadCoinsData();
      }

      // Format for dashboard
      const formattedCoins = firebaseCoins.map(coin => ({
        id: coin.contractAddress,
        ...coin,
        lastUpdate: coin.lastUpdated || coin.lastUpdate || new Date().toISOString()
      }));

      console.log(`📊 Retrieved ${formattedCoins.length} coins from Firebase`);
      return formattedCoins;

    } catch (error) {
      console.error('Error fetching latest coins data:', error);
      // Fallback to local file
      return this.loadCoinsData();
    }
  }

  async broadcastUpdate() {
    const coinsData = await this.getLatestCoinsData();

    // Calculate exact timestamp of next update (next 30-second boundary)
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
    console.log(`📡 Broadcasted update to ${this.clients.size} clients`);
  }

  getNextUpdateTime() {
    // Calculate seconds until next 30-second boundary
    const now = Date.now();
    const secondsInCurrentCycle = Math.floor((now / 1000) % 30);
    return 30 - secondsInCurrentCycle;
  }

  startAutoUpdates() {
    console.log('🔄 Starting market monitor and dashboard updates...');

    // Start the market monitor (handles PumpPortal data updates)
    this.marketMonitor.start();

    // Sync to 30-second boundaries for consistent timing
    const now = Date.now();
    const secondsInCurrentCycle = Math.floor((now / 1000) % 30);
    const millisecondsToNextCycle = (30 - secondsInCurrentCycle) * 1000;

    console.log(`⏰ Syncing to 30-second cycle. Next update in ${30 - secondsInCurrentCycle} seconds`);

    // Wait for next 30-second boundary, then start regular interval
    setTimeout(() => {
      // Do initial aligned update
      this.broadcastUpdate();

      // Now start the regular 30-second interval (aligned to boundaries)
      this.updateInterval = setInterval(async () => {
        console.log('📡 Broadcasting dashboard update...');
        await this.broadcastUpdate();
      }, 30000); // 30 seconds
    }, millisecondsToNextCycle);

    // Do immediate update for initial data
    setTimeout(() => this.broadcastUpdate(), 1000);
  }

  stopAutoUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.marketMonitor) {
      this.marketMonitor.stop();
    }
    console.log('🛑 Stopped automatic updates');
  }

  start() {
    this.server.listen(this.port, () => {
      console.log(`🚀 Dashboard server running at:`);
      console.log(`   Local:   http://localhost:${this.port}`);
      console.log(`   Network: http://0.0.0.0:${this.port}`);
      console.log('');
      console.log('🔧 API Endpoints:');
      console.log(`   Coins:   http://localhost:${this.port}/api/coins`);
      console.log(`   Stats:   http://localhost:${this.port}/api/stats`);
      console.log('');
      console.log('📊 Dashboard URL for streaming software:');
      console.log(`   http://localhost:${this.port}`);
      console.log('');
      console.log('🔄 Features:');
      console.log('   ✅ Firebase database integration');
      console.log('   ✅ Real-time market data from PumpPortal');
      console.log('   ✅ Automatic updates every 30 seconds');
      console.log('   ✅ Live countdown timer');

      // Start automatic updates
      this.startAutoUpdates();
    });
  }

  async setupFirebaseRealtimeListener() {
    try {
      await this.firebaseService.initialize();

      if (!this.firebaseService.db) {
        console.log('⚠️ Firebase not initialized - skipping real-time listener');
        return;
      }

      console.log('🔥 Setting up Firebase real-time listener for new coins...');

      const coinsRef = this.firebaseService.db.ref('coins');

      coinsRef.on('child_added', async (snapshot) => {
        const coinData = snapshot.val();
        const contractAddress = snapshot.key;

        if (coinData) {
          console.log(`🚀 REAL-TIME: New coin detected - ${coinData.name} (${contractAddress})`);

          // Format coin data for dashboard
          const formattedCoin = {
            id: contractAddress,
            contractAddress,
            ...coinData
          };

          // Broadcast immediately to all connected clients
          this.broadcastNewCoin(formattedCoin);
        }
      });

      console.log('✅ Firebase real-time listener active for coins');

      // Also listen for new activity
      const activityRef = this.firebaseService.db.ref('activity');
      activityRef.on('child_added', (snapshot) => {
        const activityData = snapshot.val();
        if (activityData) {
          // Broadcast activity to all connected clients
          this.broadcastActivity(activityData.message, activityData.type);
        }
      });

      console.log('✅ Firebase real-time listener active for activity');

    } catch (error) {
      console.error('❌ Failed to setup Firebase real-time listener:', error.message);
    }
  }

  broadcastNewCoin(coinData) {
    const message = {
      type: 'new_coin',
      data: coinData,
      timestamp: new Date().toISOString()
    };

    let clientCount = 0;
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
        clientCount++;
      }
    });

    console.log(`🚨 INSTANT BROADCAST: New coin sent to ${clientCount} clients`);
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

    let clientCount = 0;
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
        clientCount++;
      }
    });

    console.log(`📢 Activity broadcast: ${messageText}`);
  }

  stop() {
    this.stopAutoUpdates();
    this.server.close();
    console.log('🛑 Dashboard server stopped');
  }
}

// Create and start server
const port = process.env.PORT || 3000;
const server = new DashboardServer(port);
server.start();

// Make server accessible globally for coin launcher
global.dashboardServer = server;

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down dashboard server...');
  server.stop();
  process.exit(0);
});

export { DashboardServer };