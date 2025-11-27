import { io } from 'socket.io-client';
import { appendFileSync, writeFileSync } from 'fs';
import { FirebaseService } from './firebase-service.js';
import { PumpFunAPI } from './pump-api.js';
import dotenv from 'dotenv';

dotenv.config();

class PumpWebSocketScraper {
  constructor() {
    this.seenMessages = new Set();
    this.messageCount = 0;
    this.socket = null;
    this.reportFile = `chat-websocket-${Date.now()}.md`;
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.connected = false;

    // Services for token creation
    this.firebase = new FirebaseService();
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
    const excludeWords = [
      "the", "a", "an",
      "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its", "we", "us", "our", "they", "them", "their",
      "of", "to", "in", "on", "at", "by", "for", "with", "from", "up", "out", "off", "over", "under", "into", "onto", "about", "above", "across", "after", "against", "along", "among", "around", "before", "behind", "below", "beneath", "beside", "between", "beyond", "down", "during", "inside", "near", "through", "toward", "towards", "within", "without", "via", "per", "plus", "minus", "versus", "vs",
      "and", "or", "but", "so", "yet", "nor", "if", "unless", "because", "since", "while", "although", "though",
      "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "must", "go", "get", "got", "put", "see", "say", "come", "take", "make", "give", "know", "think", "feel", "look", "want", "need", "like", "love",
      "what", "who", "when", "where", "why", "how", "which", "whose",
      "very", "really", "quite", "just", "only", "also", "too", "so", "such", "much", "many", "more", "most", "less", "some", "any", "all", "each", "every", "other", "another", "same", "different", "new", "old", "first", "last", "next", "previous", "this", "that", "these", "those", "here", "there", "now", "then", "today", "tomorrow", "yesterday", "soon", "later", "early", "late", "always", "never", "sometimes", "often", "usually", "maybe", "perhaps", "probably", "possibly", "definitely", "certainly", "sure", "yes", "no", "not", "never", "nothing", "something", "anything", "everything",
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "hundred", "thousand", "million", "billion",
      "big", "small", "little", "tiny", "huge", "large", "good", "bad", "great", "best", "worst", "nice", "cool", "awesome", "amazing", "incredible", "fantastic", "wonderful", "terrible", "horrible", "awful", "perfect", "excellent", "outstanding", "remarkable", "extraordinary", "ordinary", "normal", "regular", "standard", "basic", "simple", "easy", "hard", "difficult", "impossible", "possible"
    ];

    const words = coinName
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map(word => word.replace(/[^a-z0-9]/g, ''));

    const meaningfulWords = words.filter(word => !excludeWords.includes(word));
    const wordsToPickFrom = meaningfulWords.length > 0 ? meaningfulWords : words;

    if (wordsToPickFrom.length === 0) {
      return "TOKEN";
    }

    const randomWord = wordsToPickFrom[Math.floor(Math.random() * wordsToPickFrom.length)];
    const ticker = randomWord.substring(0, 10).toUpperCase();

    this.log(`🎲 Generated ticker "${ticker}" from "${coinName}"`);
    return ticker;
  }

  initialize() {
    this.log('🎯 Starting WebSocket chat scraper for Stream Launch...');
    writeFileSync(this.reportFile, `# Stream Launch WebSocket Chat\n\nStarted: ${new Date().toLocaleString()}\n\n`, 'utf8');
    return true;
  }

  connect(contractAddress) {
    try {
      this.log(`🌐 Connecting to pump.fun WebSocket...`);

      this.socket = io('wss://livechat.pump.fun', {
        transports: ['websocket'],
        query: {
          EIO: '4',
          transport: 'websocket'
        },
        extraHeaders: {
          'Origin': 'https://pump.fun',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        timeout: 20000
      });

      this.setupEventHandlers(contractAddress);
      return true;

    } catch (error) {
      this.log(`❌ Failed to connect: ${error.message}`);
      return false;
    }
  }

  setupEventHandlers(contractAddress) {
    this.socket.on('connect', () => {
      this.log('✅ Connected to pump.fun WebSocket');
      this.connected = true;
      this.reconnectAttempts = 0;

      const handshake = {
        origin: "https://pump.fun",
        timestamp: Date.now(),
        token: null
      };

      this.log(`🤝 Sending handshake: ${JSON.stringify(handshake)}`);
      this.socket.emit('handshake', handshake);

      setTimeout(() => {
        this.log(`🏠 Joining room: ${contractAddress}`);
        this.socket.emit('joinRoom', {
          roomId: contractAddress,
          username: 'streamlaunch_' + Math.random().toString(36).substring(2, 11)
        });
      }, 1000);
    });

    this.socket.on('disconnect', (reason) => {
      this.log(`❌ Disconnected: ${reason}`);
      this.connected = false;
      if (reason === 'io server disconnect') {
        this.socket.connect();
      }
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      this.log(`❌ Connection error (attempt ${this.reconnectAttempts}): ${error.message}`);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.log('❌ Max reconnection attempts reached. Stopping...');
        this.stop();
      }
    });

    this.socket.on('connected', (data) => {
      this.log(`🎉 Successfully joined chat: ${JSON.stringify(data)}`);
    });

    this.socket.on('message', (data) => {
      this.handleMessage(data);
    });

    this.socket.on('serverError', (error) => {
      this.log(`🚨 Server error: ${JSON.stringify(error)}`);
    });

    this.socket.on('message', (rawMsg) => {
      if (typeof rawMsg === 'string') {
        if (rawMsg.startsWith('42')) {
          try {
            const jsonPart = rawMsg.substring(2);
            const parsed = JSON.parse(jsonPart);
            this.handleMessage(parsed[1]);
          } catch (e) {
            this.log(`⚠️ Failed to parse message: ${rawMsg}`);
          }
        }
      }
    });

    this.socket.on('newMessage', (data) => {
      if (Array.isArray(data) && data.length > 0) {
        this.handleMessage(data[0]);
      } else if (data && typeof data === 'object') {
        this.handleMessage(data);
      }
    });

    // Log all events for debugging (can be disabled in production)
    this.socket.onAny((eventName) => {
      if (eventName !== 'message' && eventName !== 'newMessage') {
        this.log(`🔍 Event: ${eventName}`);
      }
    });
  }

  handleMessage(data) {
    try {
      let message = data;
      if (typeof data === 'string') {
        try {
          message = JSON.parse(data);
        } catch (e) {
          message = { text: data, id: Date.now() + Math.random() };
        }
      }


      const messageId = message.id || message._id || message.messageId || `${Date.now()}-${Math.random()}`;

      if (this.seenMessages.has(messageId)) {
        return;
      }

      this.seenMessages.add(messageId);
      this.messageCount++;

      const msgData = {
        id: messageId,
        text: message.message || message.text || message.content || 'No text',
        user: message.username || message.user || message.sender || message.name || 'Unknown',
        time: message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
        walletAddress: message.userAddress || message.walletAddress || message.wallet || message.address || message.mint || null,
        profileImageUrl: message.profile_image || message.profileImage || message.profileImageUrl || message.avatar || null
      };

      this.log(`🚨 NEW MESSAGE #${this.messageCount}:`);
      this.log(`👤 User: ${msgData.user}`);
      this.log(`💬 Text: ${msgData.text}`);
      this.log(`💰 Wallet: ${msgData.walletAddress || 'None'}`);
      this.log(`🖼️ Profile: ${msgData.profileImageUrl || 'None'}`);

      // Check for /launch command
      if (msgData.text && msgData.text.toLowerCase().startsWith('/launch')) {
        this.handleLaunchCommand(msgData);
      }

      this.log('─'.repeat(50));

      appendFileSync(this.reportFile,
        `\n**Message ${this.messageCount}:**\n` +
        `- **User:** ${msgData.user}\n` +
        `- **Text:** ${msgData.text}\n` +
        `- **Wallet:** ${msgData.walletAddress || 'None'}\n` +
        `- **ID:** ${msgData.id}\n\n`
      );

    } catch (error) {
      this.log(`❌ Error handling message: ${error.message}`);
    }
  }

  async handleLaunchCommand(msgData) {
    const text = msgData.text.trim();
    const parts = text.split(/\s+/);

    if (parts.length < 2) {
      this.log(`⚠️ Invalid /launch command format: ${text}`);
      return;
    }

    const coinName = parts.slice(1).join(' ').trim();

    if (coinName.length === 0) {
      this.log(`⚠️ Token name cannot be empty`);
      return;
    }

    if (coinName.length > 32) {
      this.log(`⚠️ Token name too long (${coinName.length} chars, max 32): "${coinName}"`);
      return;
    }

    const ticker = this.generateTicker(coinName);
    const username = msgData.user;

    this.log(`🚀 LAUNCH COMMAND DETECTED:`);
    this.log(`   User: ${username}`);
    this.log(`   Coin: ${coinName}`);
    this.log(`   Ticker: ${ticker}`);

    this.broadcastActivity(`Launch detected - ${username} wants to create "${coinName}" ($${ticker})`, 'info');

    try {
      // Create the token
      this.broadcastActivity(`Launching "${coinName}" for ${username}...`, 'info');
      this.log(`🎯 CREATING TOKEN:`);
      this.log(`   Name: ${coinName}`);
      this.log(`   Ticker: ${ticker}`);
      this.log(`   Creator: ${username}`);
      this.log(`   Profile Image: ${msgData.profileImageUrl || 'None'}`);

      const tokenData = {
        name: coinName,
        ticker: ticker,
        imageUrl: msgData.profileImageUrl,
        description: `${coinName} - Created by ${username} during live stream!`
      };

      const options = {
        initialBuy: this.walletConfig.initialBuyAmount || 0,
        slippage: 10,
        priorityFee: 0.00001
      };

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

        this.broadcastActivity(`Success! ${username} created "${coinName}" ($${ticker}) - Contract: ${tokenResult.mint.slice(0,8)}...`, 'success');

        // Add to Firebase
        const firebaseData = {
          name: coinName,
          ticker: ticker,
          creator: username,
          createdAt: new Date().toISOString(),
          imageUrl: msgData.profileImageUrl || null,
          description: tokenData.description,
          marketCap: 5000,
          price: 0.000005,
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
  }

  async broadcastActivity(message, type = 'info') {
    // Write to Firebase - dashboard will pick it up via real-time listener
    await this.firebase.addActivity(message, type);
  }

  async start(contractAddress) {
    const initialized = this.initialize();
    if (!initialized) return;

    const connected = this.connect(contractAddress);
    if (!connected) return;

    this.isRunning = true;
    this.log('🔍 Starting WebSocket message monitoring for Stream Launch...');
    this.log('💡 Listening for /launch commands!');

    const statusInterval = setInterval(() => {
      if (this.isRunning) {
        this.log(`📊 Status: ${this.messageCount} messages captured, Connected: ${this.connected}`);
      } else {
        clearInterval(statusInterval);
      }
    }, 30000);

    process.on('SIGINT', () => {
      this.log(`\n🛑 Stopping... (Captured ${this.messageCount} messages)`);
      this.stop();
    });

    this.log('\n💡 Stream Launch WebSocket scraper running! Press Ctrl+C to stop');
    this.log(`📄 Messages saved to: ${this.reportFile}\n`);
  }

  stop() {
    this.isRunning = false;

    if (this.socket) {
      this.socket.disconnect();
      this.log('🔌 WebSocket disconnected');
    }

    this.log('✅ Scraper stopped');
    this.log(`📊 Total messages captured: ${this.messageCount}`);
    process.exit(0);
  }
}

// Usage
async function main() {
  const apiKey = process.env.PUMPPORTAL_API_KEY;
  const walletPublicKey = process.env.WALLET_PUBLIC_KEY;

  if (!apiKey) {
    console.log('⚠️ No PUMPPORTAL_API_KEY found - running in mock mode');
  } else {
    console.log(`🔑 API Key: ${apiKey.substring(0, 8)}...`);
  }

  if (walletPublicKey) {
    console.log(`👛 Wallet: ${walletPublicKey.substring(0, 8)}...`);
  }

  let contractAddress;

  if (process.argv[2]) {
    contractAddress = process.argv[2];
  } else {
    console.log('🎯 Stream Launch WebSocket Scraper');
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

  console.log(`🎯 Using contract address: ${contractAddress}`);

  const scraper = new PumpWebSocketScraper();
  await scraper.start(contractAddress);
}

export { PumpWebSocketScraper };

main().catch(console.error);
