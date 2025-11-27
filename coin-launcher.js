import { PersistentChatScraper } from './persistent-chat-scraper.js';
import { PumpFunAPI } from './pump-api.js';
import { FirebaseService } from './firebase-service.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class CoinLauncher extends PersistentChatScraper {
  constructor(apiKey = null, walletConfig = {}) {
    super();
    this.launchedUsers = new Set();
    this.createdCoins = [];
    this.dataFile = 'launched-coins.json';
    this.usersFile = 'launched-users.json';
    this.pumpApi = new PumpFunAPI(apiKey);
    this.firebaseService = new FirebaseService();
    this.useMockMode = !apiKey; // Use mock mode if no API key provided
    this.walletConfig = walletConfig;
    this.loadData();
  }

  loadData() {
    // Load previously launched users
    if (existsSync(this.usersFile)) {
      try {
        const userData = JSON.parse(readFileSync(this.usersFile, 'utf8'));
        this.launchedUsers = new Set(userData);
      } catch (error) {
        console.log('Failed to load user data:', error.message);
      }
    }

    // Load created coins data
    if (existsSync(this.dataFile)) {
      try {
        this.createdCoins = JSON.parse(readFileSync(this.dataFile, 'utf8'));
      } catch (error) {
        console.log('Failed to load coins data:', error.message);
      }
    }
  }

  saveData() {
    // Save launched users
    writeFileSync(this.usersFile, JSON.stringify([...this.launchedUsers], null, 2));

    // Save created coins
    writeFileSync(this.dataFile, JSON.stringify(this.createdCoins, null, 2));
  }

  parseLaunchCommand(text) {
    // Support formats:
    // !launch NAME TICKER
    // !launch NAME TICKER imageUrl
    const regex = /^!launch\s+(\S+)\s+(\S+)(?:\s+(https?:\/\/\S+))?/i;
    const match = text.trim().match(regex);

    if (match) {
      return {
        name: match[1],
        ticker: match[2],
        imageUrl: match[3] || null
      };
    }
    return null;
  }

  async handleLaunchCommand(user, command, messageId, profileImageUrl) {
    // Broadcast launch attempt
    this.broadcastActivity(`Launch detected - ${user} wants to create "${command.name}" ($${command.ticker})`, 'info');

    // Check if user already launched
    if (this.launchedUsers.has(user)) {
      this.log(`❌ User ${user} already launched a coin - ignoring`);
      this.broadcastActivity(`Launch blocked - ${user} already created a token`, 'error');
      return;
    }

    // Check Firebase rate limiting
    const rateLimitCheck = await this.firebaseService.checkUserRateLimit(user);
    if (!rateLimitCheck.allowed) {
      this.log(`❌ Rate limit check failed for ${user}: ${rateLimitCheck.message}`);
      this.broadcastActivity(`Launch blocked - ${user} rate limited (${rateLimitCheck.timeRemaining || 'wait'} min remaining)`, 'error');
      return;
    }

    this.log(`🚀 Processing launch command from ${user}: ${command.name} (${command.ticker})`);
    this.broadcastActivity(`Launching "${command.name}" for ${user}...`, 'info');

    if (profileImageUrl) {
      this.log(`🖼️ Using profile image: ${profileImageUrl}`);
    }

    try {
      // Create the coin, using profile image if no image URL provided in command
      const imageUrl = command.imageUrl || profileImageUrl;
      const coinData = await this.createCoin(command, user, imageUrl);

      if (coinData.success) {
        // Track user as having launched
        this.launchedUsers.add(user);

        // Store coin data
        const coinInfo = {
          id: coinData.mint,
          name: command.name,
          ticker: command.ticker,
          creator: user,
          createdAt: new Date().toISOString(),
          messageId: messageId,
          contractAddress: coinData.mint,
          imageUrl: imageUrl,
          signature: coinData.signature,
          marketCap: 0,
          highestMarketCap: 0
        };

        this.createdCoins.push(coinInfo);
        this.saveData();

        // Add to Firebase database with initial market cap
        const firebaseSuccess = await this.firebaseService.addCoin(coinData.mint, {
          name: command.name,
          ticker: command.ticker,
          creator: user,
          createdAt: new Date().toISOString(),
          imageUrl: imageUrl,
          description: `${command.name} - Created by ${user} during live stream!`,
          marketCap: 5000, // Starting market cap for new coins
          price: 0.000005, // Starting price
          highestMarketCap: 5000
        });

        this.log(`✅ Successfully created coin: ${command.name} (${command.ticker})`);
        this.log(`📊 Contract Address: ${coinData.mint}`);
        this.log(`🔗 Transaction: ${coinData.signature}`);

        this.broadcastActivity(`Success! ${user} created "${command.name}" ($${command.ticker}) - Contract: ${coinData.mint.slice(0,8)}...`, 'success');

        if (firebaseSuccess) {
          this.log(`✅ Added to Firebase database`);
        } else {
          this.log(`⚠️ Failed to add to Firebase database`);
        }
      } else {
        this.log(`❌ Failed to create coin: ${coinData.error}`);
        // Don't broadcast failed launches to live feed
      }
    } catch (error) {
      this.log(`❌ Error creating coin: ${error.message}`);
      // Don't broadcast failed launches to live feed
    }
  }

  async createCoin(command, creator, imageUrl) {
    this.log(`🔧 Creating coin ${command.name} (${command.ticker}) for ${creator}...`);

    try {
      const tokenData = {
        name: command.name,
        ticker: command.ticker,
        imageUrl: imageUrl,
        description: `${command.name} - Created by ${creator} during live stream!`
      };

      const options = {
        initialBuy: this.walletConfig.initialBuyAmount || 0,
        slippage: 10,
        priorityFee: 0.00001,
        creatorWallet: this.walletConfig.walletPublicKey
      };

      let result;
      if (this.useMockMode) {
        this.log('🧪 Using mock mode (no real API calls)');
        result = await this.pumpApi.createTokenMock(tokenData, options);
      } else {
        this.log('🚀 Using real API calls');
        result = await this.pumpApi.createToken(tokenData, options);
      }

      return result;
    } catch (error) {
      this.log(`❌ Error in createCoin: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkForNewMessages() {
    if (!this.page || this.page.isClosed()) {
      this.log('❌ Page unavailable - restarting...');
      this.restart();
      return;
    }

    try {
      const messages = await this.page.$$eval('[data-message-id]', elements => {
        return elements.map(el => {
          const id = el.getAttribute('data-message-id');
          let user = 'Unknown';
          let text = '';
          let time = 'Unknown';
          let walletAddress = null;
          let profileImageUrl = null;

          // Extract username from the profile link
          const userLinkEl = el.querySelector('a[href*="/profile/"]');
          if (userLinkEl) {
            user = userLinkEl.textContent?.trim();
            // Extract wallet address from profile URL
            const profileUrl = userLinkEl.getAttribute('href');
            if (profileUrl) {
              const walletMatch = profileUrl.match(/\/profile\/([A-Za-z0-9]+)$/);
              if (walletMatch) {
                walletAddress = walletMatch[1];
              }
            }
          }

          // Extract profile image URL - look for img elements near the username
          const profileImgEl = el.querySelector('img[src*="ipfs.io"], img[src*="ipfs://"]');
          if (profileImgEl) {
            profileImageUrl = profileImgEl.getAttribute('src');
          }

          // Extract message text from the paragraph with break-words class
          const messageEl = el.querySelector('p.break-words');
          if (messageEl) {
            text = messageEl.textContent?.trim();
          }

          // Extract timestamp
          const timeEl = el.querySelector('span[class*="text-gray-300"]');
          if (timeEl) {
            time = timeEl.textContent?.trim();
          }

          return {
            id,
            text,
            user,
            time,
            walletAddress,
            profileImageUrl
          };
        }).filter(msg => msg.text && msg.text.length > 0);
      });

      let newCount = 0;
      for (const msg of messages) {
        if (!this.seenMessages.has(msg.id)) {
          this.seenMessages.add(msg.id);
          this.messageCount++;
          newCount++;

          // Filter for ! commands
          if (msg.text.startsWith('!')) {
            this.log(`🚨 COMMAND MESSAGE #${this.messageCount}:`);
            this.log(`👤 User: ${msg.user || 'Unknown'}`);
            this.log(`💬 Command: ${msg.text}`);
            this.log(`🆔 ID: ${msg.id}`);
            this.log('─'.repeat(50));

            // Check if it's a launch command
            const launchCommand = this.parseLaunchCommand(msg.text);
            if (launchCommand) {
              await this.handleLaunchCommand(msg.user, launchCommand, msg.id, msg.profileImageUrl);
            }
          }

          // Log all messages to file (existing functionality)
          this.log(`🚨 NEW MESSAGE #${this.messageCount}:`);
          this.log(`👤 User: ${msg.user || 'Unknown'}`);
          this.log(`💬 Text: ${msg.text}`);
          this.log(`🆔 ID: ${msg.id}`);
          this.log('─'.repeat(50));
        }
      }

      this.log(`✅ Checked: ${newCount} new, ${messages.length} total messages`);

    } catch (error) {
      this.log(`❌ Check error: ${error.message}`);
      if (error.message.includes('Target closed')) {
        this.restart();
      }
    }
  }

  broadcastActivity(message, type = 'info') {
    try {
      if (global.dashboardServer && global.dashboardServer.broadcastActivity) {
        global.dashboardServer.broadcastActivity(message, type);
      }
    } catch (error) {
      // Silently fail if dashboard server not available
      this.log(`⚠️ Activity broadcast failed: ${error.message}`);
    }
  }

  getStats() {
    return {
      totalLaunches: this.createdCoins.length,
      uniqueUsers: this.launchedUsers.size,
      totalMessages: this.messageCount
    };
  }
}

// Usage
async function main() {
  // Get API key from environment variables (.env file)
  const apiKey = process.env.PUMPPORTAL_API_KEY;
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;
  const walletPublicKey = process.env.WALLET_PUBLIC_KEY;
  const initialBuyAmount = parseFloat(process.env.INITIAL_BUY_AMOUNT) || 0;

  if (!apiKey) {
    console.log('❌ PumpPortal API key required!');
    console.log('Create a .env file with: PUMPPORTAL_API_KEY=your_key_here');
    console.log('See .env.example for full configuration');
    process.exit(1);
  }

  if (!walletPrivateKey || !walletPublicKey) {
    console.log('⚠️  Warning: Wallet keys not configured in .env');
    console.log('Token creation may fail without proper wallet configuration');
  }

  let contractAddress;

  if (process.argv[2]) {
    contractAddress = process.argv[2];
  } else {
    console.log('🚀 Coin Launcher - Live Stream Token Creator');
    console.log('Please enter the contract address (CA) to monitor:');

    process.stdin.setEncoding('utf8');
    await new Promise((resolve) => {
      process.stdin.once('data', (data) => {
        contractAddress = data.toString().trim();
        process.stdin.pause();
        resolve();
      });
    });
  }

  contractAddress = contractAddress.replace(/.*\/coin\//, '').trim();

  if (!contractAddress) {
    console.log('❌ No contract address provided');
    process.exit(1);
  }

  console.log('✅ Using real API mode with PumpPortal API');
  console.log(`🔑 API Key: ${apiKey.substring(0, 8)}...`);
  if (walletPublicKey) {
    console.log(`👛 Wallet: ${walletPublicKey.substring(0, 8)}...`);
  }
  if (initialBuyAmount > 0) {
    console.log(`💰 Initial buy amount: ${initialBuyAmount} SOL`);
  }

  const coinUrl = `https://pump.fun/coin/${contractAddress}`;
  const launcher = new CoinLauncher(apiKey, {
    walletPrivateKey,
    walletPublicKey,
    initialBuyAmount
  });
  await launcher.start(coinUrl);
}

export { CoinLauncher };

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}