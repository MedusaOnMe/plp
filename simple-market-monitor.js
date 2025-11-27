import WebSocket from 'ws';
import { FirebaseService } from './firebase-service.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

class SimpleMarketMonitor {
  constructor() {
    this.firebase = new FirebaseService();
    this.apiKey = process.env.PUMPPORTAL_API_KEY;
    this.ws = null;
    this.coinData = new Map(); // Store latest data for each coin
    this.subscribedTokens = new Set();
    this.updateInterval = null;
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[MarketMonitor ${timestamp}] ${message}`);
  }

  async start() {
    this.log('🚀 Starting simple market monitor...');

    // Update every 30 seconds
    this.updateInterval = setInterval(() => {
      this.updateAllCoins();
    }, 30000);

    // Do initial update
    this.updateAllCoins();
  }

  async updateAllCoins() {
    try {
      this.log('🔄 Starting 30-second update cycle...');

      // 1. Get only the coins we need to display on dashboard
      const firebaseCoins = await this.firebase.getAllCoins();
      this.log(`📊 Found ${firebaseCoins.length} total coins in Firebase`);

      if (firebaseCoins.length === 0) {
        this.log('📭 No coins to monitor');
        return;
      }

      // 2. Select only coins that will be displayed on dashboard
      // Get top 3 by market cap
      const topMarketCapCoins = [...firebaseCoins]
        .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
        .slice(0, 3);

      // Get most recent 12 coins
      const recentCoins = [...firebaseCoins]
        .sort((a, b) => {
          const dateA = new Date(a.createdAt || a.addedToDatabase || 0);
          const dateB = new Date(b.createdAt || b.addedToDatabase || 0);
          return dateB - dateA;
        })
        .slice(0, 12);

      // Combine and deduplicate
      const coinsToUpdate = new Map();
      [...topMarketCapCoins, ...recentCoins].forEach(coin => {
        coinsToUpdate.set(coin.contractAddress, coin);
      });

      const selectedCoins = Array.from(coinsToUpdate.values());
      this.log(`🎯 Selected ${selectedCoins.length} coins for update (top 3 mcap + recent 12, deduplicated)`);

      // 3. Fetch market data from DexScreener API for selected coins only
      this.log('💾 Fetching latest market data from DexScreener API...');

      // Since we have max 15 coins (3 top + 12 recent), no need for batching
      const tokenAddresses = selectedCoins.map(coin => coin.contractAddress).join(',');
      const apiUrl = `https://api.dexscreener.com/tokens/v1/solana/${tokenAddresses}`;

      try {
        this.log(`🔍 Fetching data for ${selectedCoins.length} tokens from DexScreener...`);
        const response = await fetch(apiUrl);

        if (response.ok) {
          const apiData = await response.json();

          // Process each token's data
          for (const coin of selectedCoins) {
            // Find matching pair data for this token
            const pairData = apiData.find(pair =>
              pair.baseToken?.address === coin.contractAddress
            );

              if (pairData && pairData.priceUsd) {
                // Calculate market cap from price and total supply
                const priceUsd = parseFloat(pairData.priceUsd);
                const totalSupply = 1000000000; // 1B tokens (standard for pump.fun)
                const marketCap = priceUsd * totalSupply;

                // Update Firebase with new market data (keep original image)
                const updateData = {
                  marketCap: Math.round(marketCap),
                  price: priceUsd,
                  volume24h: pairData.volume?.h24 || 0,
                  priceChange24h: pairData.priceChange?.h24 || 0,
                  lastUpdate: new Date().toISOString()
                  // Don't update imageUrl - keep the original from PumpPortal
                };

                // Track highest market cap
                if (marketCap > (coin.highestMarketCap || 0)) {
                  updateData.highestMarketCap = Math.round(marketCap);
                }

                await this.firebase.updateCoinData(coin.contractAddress, updateData);
                this.log(`✅ Updated ${coin.name}: $${this.formatNumber(marketCap)} (${priceUsd} USD)`);

              } else {
                this.log(`⚠️ No market data found for ${coin.name} on DexScreener`);
              }
            }

        } else {
          this.log(`❌ DexScreener API error: ${response.status}`);
        }

      } catch (error) {
        this.log(`❌ Error fetching data: ${error.message}`);
      }

      // Calculate and store global stats after all updates
      await this.calculateAndStoreGlobalStats();

      this.log('✅ Update cycle complete');

    } catch (error) {
      this.log(`❌ Error during update: ${error.message}`);
    }
  }

  async calculateAndStoreGlobalStats() {
    try {
      this.log('📊 Calculating global stats...');

      // Get all coins from Firebase
      const firebaseCoins = await this.firebase.getAllCoins();

      if (firebaseCoins.length === 0) {
        this.log('📭 No coins found for stats calculation');
        return;
      }

      // Calculate stats
      const totalCoins = firebaseCoins.length;
      const totalMarketCap = firebaseCoins.reduce((sum, coin) => sum + (coin.marketCap || 0), 0);
      const avgMarketCap = totalCoins > 0 ? Math.round(totalMarketCap / totalCoins) : 0;
      const totalVolume24h = firebaseCoins.reduce((sum, coin) => sum + (coin.volume24h || 0), 0);
      const highestMarketCap = Math.max(...firebaseCoins.map(coin => coin.highestMarketCap || coin.marketCap || 0), 0);

      const globalStats = {
        totalCoins,
        totalMarketCap: Math.round(totalMarketCap),
        avgMarketCap,
        totalVolume24h: Math.round(totalVolume24h),
        highestMarketCap: Math.round(highestMarketCap)
      };

      // Store in Firebase
      await this.firebase.updateGlobalStats(globalStats);

      this.log(`📊 Global stats updated: ${totalCoins} coins, $${this.formatNumber(totalMarketCap)} total cap, $${this.formatNumber(avgMarketCap)} avg cap`);

    } catch (error) {
      this.log(`❌ Error calculating global stats: ${error.message}`);
    }
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.apiKey ?
        `wss://pumpportal.fun/api/data?api-key=${this.apiKey}` :
        'wss://pumpportal.fun/api/data';

      this.log('🔌 Connecting to PumpPortal WebSocket...');
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.log('✅ WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMarketData(message);
        } catch (error) {
          this.log(`❌ Error parsing message: ${error.message}`);
        }
      });

      this.ws.on('error', (error) => {
        this.log(`❌ WebSocket error: ${error.message}`);
        reject(error);
      });

      this.ws.on('close', () => {
        this.log('🔌 WebSocket disconnected');
      });
    });
  }

  async subscribeToTokens(contractAddresses) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('❌ WebSocket not connected');
      return;
    }

    // Clear old subscriptions
    this.coinData.clear();
    this.subscribedTokens.clear();

    this.log(`📡 Subscribing to ${contractAddresses.length} tokens...`);

    const subscribeMessage = {
      method: "subscribeTokenTrade",
      keys: contractAddresses
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    contractAddresses.forEach(addr => this.subscribedTokens.add(addr));

    this.log(`✅ Subscribed to all tokens`);
  }

  handleMarketData(message) {
    if (!message || !message.mint) return;

    const contractAddress = message.mint;

    // Calculate market cap from PumpPortal data
    let marketCap = 0;
    let price = 0;

    if (message.vSolInBondingCurve && message.vTokensInBondingCurve) {
      price = parseFloat(message.vSolInBondingCurve) / parseFloat(message.vTokensInBondingCurve);
      marketCap = price * 1000000000; // 1B total supply
    } else if (message.marketCapSol) {
      marketCap = parseFloat(message.marketCapSol) * 200; // ~$200/SOL
      price = marketCap / 1000000000;
    }

    if (marketCap > 0) {
      this.coinData.set(contractAddress, {
        marketCap,
        price,
        lastTrade: new Date().toISOString(),
        tradeType: message.txType
      });

      this.log(`📊 ${message.txType?.toUpperCase()}: ${contractAddress.slice(0,8)}... - $${this.formatNumber(marketCap)}`);
    }
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    } else {
      return num.toFixed(2);
    }
  }

  stop() {
    this.log('🛑 Stopping market monitor...');
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

export { SimpleMarketMonitor };