// Firebase Realtime Database service for Pump Live Pad
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

class FirebaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.coinsCache = null;
    this.coinsCacheTime = 0;
    this.cacheTTL = 5000; // 5 second cache
  }

  async initialize() {
    try {
      if (this.initialized) return true;

      let serviceAccount;

      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
      } else {
        this.initialized = true;
        return false;
      }

      let app;
      try {
        app = admin.app();
      } catch (error) {
        app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
        });
      }

      this.db = admin.database();
      this.initialized = true;
      return true;
    } catch (error) {
      this.initialized = true;
      return false;
    }
  }

  async addCoin(contractAddress, coinData) {
    await this.initialize();

    if (!this.db) return true;

    try {
      const coinRef = this.db.ref(`coins/${contractAddress}`);
      await coinRef.set({
        contractAddress,
        name: coinData.name,
        ticker: coinData.ticker,
        creator: coinData.creator,
        createdAt: coinData.createdAt || new Date().toISOString(),
        imageUrl: coinData.imageUrl,
        description: coinData.description,
        marketCap: coinData.marketCap || 0,
        price: coinData.price || 0,
        highestMarketCap: coinData.highestMarketCap || coinData.marketCap || 0,
        addedToDatabase: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });

      // Invalidate cache
      this.coinsCache = null;
      return true;
    } catch (error) {
      return false;
    }
  }

  async getAllCoins() {
    await this.initialize();

    if (!this.db) return [];

    // Return cached data if fresh
    if (this.coinsCache && (Date.now() - this.coinsCacheTime) < this.cacheTTL) {
      return this.coinsCache;
    }

    try {
      const coinsRef = this.db.ref('coins');
      const snapshot = await coinsRef.once('value');
      const data = snapshot.val();

      if (!data) return [];

      const coins = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      }));

      // Update cache
      this.coinsCache = coins;
      this.coinsCacheTime = Date.now();

      return coins;
    } catch (error) {
      return [];
    }
  }

  async removeCoin(contractAddress) {
    await this.initialize();

    if (!this.db) return true;

    try {
      const coinRef = this.db.ref(`coins/${contractAddress}`);
      await coinRef.remove();
      this.coinsCache = null;
      return true;
    } catch (error) {
      return false;
    }
  }

  async updateCoinData(contractAddress, updateData) {
    await this.initialize();

    if (!this.db) return true;

    try {
      const coinRef = this.db.ref(`coins/${contractAddress}`);
      await coinRef.update({
        ...updateData,
        lastUpdated: new Date().toISOString()
      });

      this.coinsCache = null;
      return true;
    } catch (error) {
      return false;
    }
  }

  async updateGlobalStats(stats) {
    await this.initialize();

    if (!this.db) return true;

    try {
      const statsRef = this.db.ref('globalStats');
      await statsRef.set({
        ...stats,
        lastUpdated: new Date().toISOString()
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  async getGlobalStats() {
    await this.initialize();

    if (!this.db) {
      return {
        totalCoins: 0,
        totalMarketCap: 0,
        avgMarketCap: 0,
        totalVolume24h: 0,
        highestMarketCap: 0
      };
    }

    try {
      const statsRef = this.db.ref('globalStats');
      const snapshot = await statsRef.once('value');
      const data = snapshot.val();

      if (!data) {
        return {
          totalCoins: 0,
          totalMarketCap: 0,
          avgMarketCap: 0,
          totalVolume24h: 0,
          highestMarketCap: 0
        };
      }

      return data;
    } catch (error) {
      return {
        totalCoins: 0,
        totalMarketCap: 0,
        avgMarketCap: 0,
        totalVolume24h: 0,
        highestMarketCap: 0
      };
    }
  }

  async addActivity(message, type = 'info') {
    await this.initialize();

    if (!this.db) return true;

    try {
      const activityRef = this.db.ref('activity').push();
      await activityRef.set({
        message,
        type,
        timestamp: new Date().toISOString()
      });

      // Keep only last 100 activities (async cleanup)
      this.cleanupActivity();

      return true;
    } catch (error) {
      return false;
    }
  }

  async cleanupActivity() {
    try {
      const allActivityRef = this.db.ref('activity');
      const snapshot = await allActivityRef.orderByChild('timestamp').once('value');
      const activities = snapshot.val();
      if (activities) {
        const keys = Object.keys(activities);
        if (keys.length > 100) {
          const keysToDelete = keys.slice(0, keys.length - 100);
          for (const key of keysToDelete) {
            await this.db.ref(`activity/${key}`).remove();
          }
        }
      }
    } catch (error) {
      // Silent fail for cleanup
    }
  }

  async getRecentActivity(limit = 50) {
    await this.initialize();

    if (!this.db) return [];

    try {
      const activityRef = this.db.ref('activity');
      const snapshot = await activityRef.orderByChild('timestamp').limitToLast(limit).once('value');
      const data = snapshot.val();

      if (!data) return [];

      return Object.keys(data)
        .map(key => ({ id: key, ...data[key] }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      return [];
    }
  }

  async checkUserRateLimit(username) {
    await this.initialize();

    if (!this.db) {
      return { allowed: true, message: 'Mock mode - rate limit check bypassed' };
    }

    try {
      const coinsRef = this.db.ref('coins');
      const snapshot = await coinsRef.orderByChild('creator').equalTo(username).once('value');
      const userCoins = snapshot.val();

      if (!userCoins) {
        return { allowed: true, message: 'User has not created any coins yet' };
      }

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      for (const contractAddress in userCoins) {
        const coin = userCoins[contractAddress];
        const createdAt = new Date(coin.createdAt || coin.addedToDatabase);

        if (createdAt > fiveMinutesAgo) {
          const timeRemaining = Math.ceil((createdAt.getTime() + 5 * 60 * 1000 - Date.now()) / 1000 / 60);
          return {
            allowed: false,
            message: `Rate limit: User created a coin ${Math.floor((Date.now() - createdAt.getTime()) / 1000 / 60)} minutes ago. Must wait ${timeRemaining} more minutes.`,
            timeRemaining: timeRemaining
          };
        }
      }

      return { allowed: true, message: 'User is within rate limit' };
    } catch (error) {
      return { allowed: false, message: 'Error checking rate limit' };
    }
  }
}

export { FirebaseService };
