import { chromium } from 'playwright';
import { appendFileSync, writeFileSync } from 'fs';
import { FirebaseService } from './firebase-service.js';
import { WalletVerificationServiceV2 } from './wallet-verification-service-v2.js';
import { PumpFunAPI } from './pump-api.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class PersistentChatScraper {
  constructor() {
    this.seenMessages = new Set();
    this.messageCount = 0;
    this.browser = null;
    this.page = null;
    this.reportFile = `chat-persistent-${Date.now()}.md`;
    this.isRunning = false;
    this.firebase = new FirebaseService();
    this.walletVerification = new WalletVerificationServiceV2();

    // Initialize PumpFun API
    const apiKey = process.env.PUMPPORTAL_API_KEY;
    this.pumpApi = new PumpFunAPI(apiKey);
    this.useMockMode = !apiKey;

    // Wallet configuration
    this.walletConfig = {
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
      walletPublicKey: process.env.WALLET_PUBLIC_KEY,
      initialBuyAmount: parseFloat(process.env.INITIAL_BUY_AMOUNT) || 0
    };

    if (this.useMockMode) {
      this.log('⚠️ Running in MOCK mode - no real tokens will be created');
    } else {
      this.log('🚀 Running in LIVE mode - real tokens will be created');
    }
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    appendFileSync(this.reportFile, `[${timestamp}] ${message}\n`, 'utf8');
  }

  generateTicker(coinName) {
    // Comprehensive list of words to exclude from ticker generation
    const excludeWords = [
      // Articles
      "the", "a", "an",
      // Pronouns
      "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its", "we", "us", "our", "they", "them", "their",
      // Prepositions
      "of", "to", "in", "on", "at", "by", "for", "with", "from", "up", "out", "off", "over", "under", "into", "onto", "about", "above", "across", "after", "against", "along", "among", "around", "before", "behind", "below", "beneath", "beside", "between", "beyond", "down", "during", "inside", "near", "through", "toward", "towards", "within", "without", "via", "per", "plus", "minus", "versus", "vs",
      // Conjunctions
      "and", "or", "but", "so", "yet", "nor", "if", "unless", "because", "since", "while", "although", "though",
      // Common verbs (small/meaningless ones)
      "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "must", "go", "get", "got", "put", "see", "say", "come", "take", "make", "give", "know", "think", "feel", "look", "want", "need", "like", "love",
      // Question words
      "what", "who", "when", "where", "why", "how", "which", "whose",
      // Common filler/meaningless words
      "very", "really", "quite", "just", "only", "also", "too", "so", "such", "much", "many", "more", "most", "less", "some", "any", "all", "each", "every", "other", "another", "same", "different", "new", "old", "first", "last", "next", "previous", "this", "that", "these", "those", "here", "there", "now", "then", "today", "tomorrow", "yesterday", "soon", "later", "early", "late", "always", "never", "sometimes", "often", "usually", "maybe", "perhaps", "probably", "possibly", "definitely", "certainly", "sure", "yes", "no", "not", "never", "nothing", "something", "anything", "everything",
      // Numbers as words
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "hundred", "thousand", "million", "billion",
      // Generic descriptors that make boring tickers
      "big", "small", "little", "tiny", "huge", "large", "good", "bad", "great", "best", "worst", "nice", "cool", "awesome", "amazing", "incredible", "fantastic", "wonderful", "terrible", "horrible", "awful", "perfect", "excellent", "outstanding", "remarkable", "extraordinary", "ordinary", "normal", "regular", "standard", "basic", "simple", "easy", "hard", "difficult", "impossible", "possible"
    ];

    // Clean and split the coin name into words
    const words = coinName
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map(word => word.replace(/[^a-z0-9]/g, '')); // Remove special characters

    // Filter out excluded words
    const meaningfulWords = words.filter(word => !excludeWords.includes(word));

    // Choose which words to pick from
    const wordsToPickFrom = meaningfulWords.length > 0 ? meaningfulWords : words;

    // If no words left, fallback to "TOKEN"
    if (wordsToPickFrom.length === 0) {
      return "TOKEN";
    }

    // Randomly pick one word
    const randomWord = wordsToPickFrom[Math.floor(Math.random() * wordsToPickFrom.length)];

    // Ensure ticker is max 10 chars and uppercase
    const ticker = randomWord.substring(0, 10).toUpperCase();

    this.log(`🎲 Generated ticker "${ticker}" from "${coinName}" (picked from: [${wordsToPickFrom.join(', ')}])`);

    return ticker;
  }

  async initialize() {
    this.log('🎯 Starting persistent chat scraper...');
    writeFileSync(this.reportFile, `# Persistent Chat Messages\n\nStarted: ${new Date().toLocaleString()}\n\n`, 'utf8');

    try {
      // Use one working proxy
      const proxyConfig = {
        server: 'http://45.86.94.114:43260',
        username: 'Q8raEgCj0c00Der',
        password: 'J1HEHSaDvbhNCP2'
      };

      this.browser = await chromium.launch({
        headless: true,
        proxy: proxyConfig
      });

      this.page = await this.browser.newPage();

      // Handle page crashes
      this.page.on('crash', () => {
        this.log('❌ Page crashed - restarting...');
        this.restart();
      });

      return true;
    } catch (error) {
      this.log(`❌ Failed to initialize: ${error.message}`);
      return false;
    }
  }

  async loadPage(coinUrl) {
    try {
      this.log(`🌐 Loading page: ${coinUrl}`);
      await this.page.goto(coinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      this.log('⏰ Waiting 15 seconds for chat to fully load...');
      await this.page.waitForTimeout(15000);

      // Test if chat loaded
      const messageCount = await this.page.$$eval('[data-message-id]', els => els.length);
      this.log(`✅ Initial check: ${messageCount} messages found`);

      if (messageCount === 0) {
        this.log('⚠️ No messages found initially - chat may still be loading');
      }

      return true;
    } catch (error) {
      this.log(`❌ Failed to load page: ${error.message}`);
      return false;
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

          // Extract profile image URL from the first img element (user's profile picture)
          const profileImgEl = el.querySelector('img[alt*="profile picture"]');
          if (profileImgEl) {
            const rawSrc = profileImgEl.getAttribute('src');
            // Clean up the URL by removing query parameters for API usage
            profileImageUrl = rawSrc ? rawSrc.split('?')[0] : null;
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

          this.log(`🚨 NEW MESSAGE #${this.messageCount}:`);
          this.log(`👤 User: ${msg.user || 'Unknown'}`);
          this.log(`💬 Text: ${msg.text}`);
          this.log(`🕐 Time: ${msg.time || 'Unknown'}`);
          this.log(`💰 Wallet: ${msg.walletAddress || 'None'}`);
          this.log(`🖼️ Profile Image: ${msg.profileImageUrl || 'None'}`);
          this.log(`🆔 ID: ${msg.id}`);

          // Check for /launch command
          await this.checkForLaunchCommand(msg);

          this.log('─'.repeat(50));

          appendFileSync(this.reportFile,
            `\n**Message ${this.messageCount}:**\n` +
            `- **User:** ${msg.user || 'Unknown'}\n` +
            `- **Text:** ${msg.text}\n` +
            `- **Time:** ${msg.time || 'Unknown'}\n` +
            `- **Wallet:** ${msg.walletAddress || 'None'}\n` +
            `- **Profile Image:** ${msg.profileImageUrl || 'None'}\n` +
            `- **ID:** ${msg.id}\n\n`
          );
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

  async checkForLaunchCommand(message) {
    const text = message.text?.toLowerCase();
    if (!text || !text.startsWith('/launch')) {
      return;
    }

    // Parse the command: /launch Token Name (everything after /launch)
    const parts = message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      this.log(`⚠️ Invalid /launch command format: ${message.text}`);
      return;
    }

    // Everything after "/launch" becomes the coin name
    const coinName = parts.slice(1).join(' ').trim();

    // Validate coin name length (max 32 characters)
    if (coinName.length === 0) {
      this.log(`⚠️ Token name cannot be empty: ${message.text}`);
      return;
    }

    if (coinName.length > 32) {
      this.log(`⚠️ Token name too long (${coinName.length} chars, max 32): "${coinName}"`);
      return;
    }

    // Generate ticker automatically
    const ticker = this.generateTicker(coinName);
    const username = message.user;

    this.log(`🚀 LAUNCH COMMAND DETECTED:`);
    this.log(`   User: ${username}`);
    this.log(`   Coin: ${coinName}`);
    this.log(`   Ticker: ${ticker}`);

    // Broadcast launch attempt to live feed
    this.broadcastActivity(`Launch detected - ${username} wants to create "${coinName}" ($${ticker})`, 'info');

    // Check rate limit
    try {
      const rateCheck = await this.firebase.checkUserRateLimit(username);

      if (!rateCheck.allowed) {
        this.log(`🚫 RATE LIMITED: ${rateCheck.message}`);
        this.broadcastActivity(`Launch blocked - ${username} rate limited (${rateCheck.timeRemaining || 'wait'} min remaining)`, 'error');
        return;
      }

      this.log(`✅ Rate limit check passed: ${rateCheck.message}`);

      // Wallet verification - check if user holds the required token "t"
      // this.log(`🔍 Starting wallet verification for ${username} - checking for required token: t...`);
      // const walletVerification = await this.walletVerification.verifyUserHoldsTokens(username, "t", true); // Always check for token "t"

      // if (!walletVerification.verified) {
      //   this.log(`🚫 WALLET VERIFICATION FAILED: ${walletVerification.reason}`);
      //   this.broadcastActivity(`Launch blocked - ${username} failed wallet verification (${walletVerification.reason})`, 'error');
      //   return;
      // }

      // this.log(`✅ Wallet verification passed: ${walletVerification.reason}`);
      this.log(`✅ Wallet verification SKIPPED (temporarily disabled)`);

      // 🚀 CREATE THE ACTUAL TOKEN (after all verifications passed)
      this.broadcastActivity(`Launching "${coinName}" for ${username}...`, 'info');
      this.log(`🎯 CREATING TOKEN (All verifications passed):`);
      this.log(`   Name: ${coinName}`);
      this.log(`   Ticker: ${ticker}`);
      this.log(`   Creator: ${username}`);
      this.log(`   🖼️ Coin Image (User's Profile): ${message.profileImageUrl || 'None'}`);
      this.log(`   Wallet: ${message.walletAddress || 'None'}`);

      try {
        // Prepare token data
        const tokenData = {
          name: coinName,
          ticker: ticker,
          imageUrl: message.profileImageUrl,
          description: `${coinName} - Created by ${username} during live stream!`
        };

        const options = {
          initialBuy: this.walletConfig.initialBuyAmount || 0,
          slippage: 10,
          priorityFee: 0.00001
        };

        this.log(`🔧 Creating token with PumpFun API...`);

        let tokenResult;
        if (this.useMockMode) {
          this.log('🧪 Using mock mode (no real API calls)');
          tokenResult = await this.pumpApi.createTokenMock(tokenData, options);
        } else {
          this.log('🚀 Using real API calls - creating actual token!');
          tokenResult = await this.pumpApi.createToken(tokenData, options);
        }

        if (tokenResult.success) {
          this.log(`✅ TOKEN CREATED SUCCESSFULLY!`);
          this.log(`   Contract Address: ${tokenResult.mint}`);
          this.log(`   Transaction: ${tokenResult.signature}`);
          this.log(`   Metadata URI: ${tokenResult.metadataUri}`);

          this.broadcastActivity(`Success! ${username} created "${coinName}" ($${ticker}) - Contract: ${tokenResult.mint.slice(0,8)}...`, 'success');

          // Add to Firebase database
          const firebaseData = {
            name: coinName,
            ticker: ticker,
            creator: username,
            createdAt: new Date().toISOString(),
            imageUrl: message.profileImageUrl || null,
            description: tokenData.description,
            marketCap: 5000, // Starting market cap
            price: 0.000005, // Starting price
            highestMarketCap: 5000,
            contractAddress: tokenResult.mint,
            signature: tokenResult.signature,
            metadataUri: tokenResult.metadataUri
          };

          const firebaseSuccess = await this.firebase.addCoin(tokenResult.mint, firebaseData);

          if (firebaseSuccess) {
            this.log(`✅ Token added to Firebase database`);
          } else {
            this.log(`⚠️ Failed to add token to Firebase database`);
          }

          this.log(`🎉 LAUNCH COMPLETE: ${coinName} (${ticker}) by ${username}`);
        } else {
          this.log(`❌ TOKEN CREATION FAILED: ${tokenResult.error}`);
        }
      } catch (error) {
        this.log(`❌ Error during token creation: ${error.message}`);
      }

      // Log to file for tracking
      appendFileSync(this.reportFile,
        `\n**🚀 LAUNCH COMMAND #${this.messageCount}:**\n` +
        `- **User:** ${username}\n` +
        `- **Coin Name:** ${coinName}\n` +
        `- **Ticker:** ${ticker}\n` +
        `- **Profile Image:** ${message.profileImageUrl || 'None'}\n` +
        `- **Wallet:** ${message.walletAddress || 'None'}\n` +
        `- **Rate Check:** ${rateCheck.message}\n` +
        `- **Wallet Verification:** SKIPPED (temporarily disabled)\n\n`
      );

    } catch (error) {
      this.log(`❌ Error during verification checks: ${error.message}`);
    }
  }

  async broadcastActivity(message, type = 'info') {
    try {
      // Send HTTP request to dashboard server
      const response = await fetch('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: message,
          type: type
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Silently fail if dashboard server not available
      this.log(`⚠️ Activity broadcast failed: ${error.message}`);
    }
  }

  async restart() {
    this.log('🔄 Restarting browser and page...');

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
    }

    const initialized = await this.initialize();
    if (initialized) {
      await this.loadPage(this.currentUrl);
    }
  }

  async start(coinUrl) {
    this.currentUrl = coinUrl;

    const initialized = await this.initialize();
    if (!initialized) return;

    const loaded = await this.loadPage(coinUrl);
    if (!loaded) {
      await this.browser.close();
      return;
    }

    this.isRunning = true;
    this.log('🔍 Starting message monitoring (persistent page)...');
    this.log('💡 Page stays open - just checking for new messages every second');

    // Check every second - no page reloads!
    const monitorInterval = setInterval(() => {
      if (this.isRunning) {
        this.checkForNewMessages();
      } else {
        clearInterval(monitorInterval);
      }
    }, 1000);

    // Status every 30 seconds
    const statusInterval = setInterval(() => {
      if (this.isRunning) {
        this.log(`📊 Status: ${this.messageCount} total messages captured`);
      } else {
        clearInterval(statusInterval);
      }
    }, 30000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      this.log(`\n🛑 Stopping... (Captured ${this.messageCount} messages)`);
      this.stop();
    });

    this.log('\n💡 Persistent scraper running! Press Ctrl+C to stop');
    this.log(`📄 Messages saved to: ${this.reportFile}\n`);
  }

  async stop() {
    this.isRunning = false;

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        this.log(`⚠️ Error closing browser: ${error.message}`);
      }
    }

    this.log('✅ Scraper stopped');
    this.log(`📊 Total messages captured: ${this.messageCount}`);
    process.exit(0);
  }
}

// Usage
async function main() {
  let contractAddress;

  if (process.argv[2]) {
    contractAddress = process.argv[2];
  } else {
    console.log('🎯 Persistent Chat Scraper (Single Proxy)');
    console.log('Please enter the contract address (CA):');

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

  const coinUrl = `https://pump.fun/coin/${contractAddress}`;
  const scraper = new PersistentChatScraper();
  await scraper.start(coinUrl);
}

main().catch(console.error);

export { PersistentChatScraper };