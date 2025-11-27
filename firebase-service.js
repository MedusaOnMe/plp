// Firebase Realtime Database service for Pump Live Pad
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

class FirebaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (this.initialized) return true;

      // Initialize Firebase Admin with service account
      // Support both: JSON string in env var (for cloud) or file path (for local)
      let serviceAccount;

      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Cloud deployment: JSON string in environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('🔐 Using Firebase credentials from environment variable');
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        // Local development: file path
        serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
        console.log('📁 Using Firebase credentials from file');
      } else {
        console.log('⚠️ No Firebase credentials found - using mock mode');
        this.initialized = true;
        return false;
      }

      // Check if app already exists
      let app;
      try {
        app = admin.app();
        console.log('♻️ Using existing Firebase app');
      } catch (error) {
        // App doesn't exist, create new one
        app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
        });
        console.log('🆕 Created new Firebase app');
      }

      this.db = admin.database();
      this.initialized = true;
      console.log('✅ Firebase initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Firebase:', error.message);
      this.initialized = true; // Mark as initialized to avoid retry loops
      return false;
    }
  }

  async addCoin(contractAddress, coinData) {
    await this.initialize();

    if (!this.db) {
      console.log('📝 Mock: Adding coin to Firebase:', contractAddress);
      return true;
    }

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

      console.log(`✅ Added coin ${contractAddress} to Firebase`);
      return true;
    } catch (error) {
      console.error('❌ Failed to add coin to Firebase:', error.message);
      return false;
    }
  }

  async getAllCoins() {
    await this.initialize();

    if (!this.db) {
      // Return empty array when Firebase not connected
      return [];
    }

    try {
      const coinsRef = this.db.ref('coins');
      const snapshot = await coinsRef.once('value');
      const data = snapshot.val();

      if (!data) {
        console.log('📊 No coins found in Firebase');
        return [];
      }

      const coins = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      }));

      console.log(`📊 Retrieved ${coins.length} coins from Firebase`);
      return coins;
    } catch (error) {
      console.error('❌ Failed to get coins from Firebase:', error.message);
      return [];
    }
  }

  async removeCoin(contractAddress) {
    await this.initialize();

    if (!this.db) {
      console.log('📝 Mock: Removing coin from Firebase:', contractAddress);
      return true;
    }

    try {
      const coinRef = this.db.ref(`coins/${contractAddress}`);
      await coinRef.remove();
      console.log(`✅ Removed coin ${contractAddress} from Firebase`);
      return true;
    } catch (error) {
      console.error('❌ Failed to remove coin from Firebase:', error.message);
      return false;
    }
  }

  async updateCoinData(contractAddress, updateData) {
    await this.initialize();

    if (!this.db) {
      console.log('📝 Mock: Updating coin in Firebase:', contractAddress);
      return true;
    }

    try {
      const coinRef = this.db.ref(`coins/${contractAddress}`);
      await coinRef.update({
        ...updateData,
        lastUpdated: new Date().toISOString()
      });

      console.log(`✅ Updated coin ${contractAddress} in Firebase`);
      return true;
    } catch (error) {
      console.error('❌ Failed to update coin in Firebase:', error.message);
      return false;
    }
  }

  async updateGlobalStats(stats) {
    await this.initialize();

    if (!this.db) {
      console.log('📝 Mock: Updating global stats in Firebase');
      return true;
    }

    try {
      const statsRef = this.db.ref('globalStats');
      await statsRef.set({
        ...stats,
        lastUpdated: new Date().toISOString()
      });

      console.log('✅ Updated global stats in Firebase');
      return true;
    } catch (error) {
      console.error('❌ Failed to update global stats in Firebase:', error.message);
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
      console.error('❌ Failed to get global stats from Firebase:', error.message);
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

    if (!this.db) {
      console.log('📝 Mock: Adding activity to Firebase');
      return true;
    }

    try {
      const activityRef = this.db.ref('activity').push();
      await activityRef.set({
        message,
        type,
        timestamp: new Date().toISOString()
      });

      // Keep only last 100 activities
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

      return true;
    } catch (error) {
      console.error('❌ Failed to add activity to Firebase:', error.message);
      return false;
    }
  }

  async getRecentActivity(limit = 50) {
    await this.initialize();

    if (!this.db) {
      return [];
    }

    try {
      const activityRef = this.db.ref('activity');
      const snapshot = await activityRef.orderByChild('timestamp').limitToLast(limit).once('value');
      const data = snapshot.val();

      if (!data) return [];

      return Object.keys(data)
        .map(key => ({ id: key, ...data[key] }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('❌ Failed to get activity from Firebase:', error.message);
      return [];
    }
  }

  async checkUserRateLimit(username) {
    await this.initialize();

    if (!this.db) {
      console.log('📝 Mock: Checking rate limit for user');
      return { allowed: true, message: 'Mock mode - rate limit check bypassed' };
    }

    try {
      // Get all coins created by this user
      const coinsRef = this.db.ref('coins');
      const snapshot = await coinsRef.orderByChild('creator').equalTo(username).once('value');
      const userCoins = snapshot.val();

      if (!userCoins) {
        return { allowed: true, message: 'User has not created any coins yet' };
      }

      // Check if any coin was created in the last 5 minutes
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
      console.error('❌ Failed to check user rate limit:', error.message);
      return { allowed: false, message: 'Error checking rate limit' };
    }
  }
}

export { FirebaseService };