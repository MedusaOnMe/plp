import { chromium } from 'playwright';
import { ProxyManager } from './proxy-manager.js';
import { PersistentQueue } from './persistent-queue.js';

class WalletVerificationServiceV2 {
  constructor() {
    this.proxyManager = new ProxyManager();
    this.verificationQueue = new PersistentQueue('wallet-verification-queue');
    this.pendingResults = new Map(); // Store promises for pending verifications
    this.holdingsCache = new Map(); // Cache holdings checks (expire after 5 minutes)
    this.isInitialized = false;

    // Circuit breaker for high load protection
    this.circuitBreaker = {
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      isOpen: false,
      openUntil: 0,
      maxFailures: 10, // Open circuit after 10 failures
      resetTimeout: 60000, // Reset after 60 seconds
      maxQueueSize: 150 // Fail fast if queue > 150 (2x proxy count)
    };

    // Performance metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      responseTimes: []
    };

    this.initialize();
  }

  initialize() {
    if (this.isInitialized) return;

    // Set up the queue processor
    this.verificationQueue.setProcessor(async (requestData) => {
      return await this.processVerificationRequest(requestData);
    });

    this.isInitialized = true;
    this.log('✅ WalletVerificationServiceV2 initialized');

    // Log status every 30 seconds
    setInterval(() => {
      this.logStatus();
    }, 30000);
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[WalletVerificationV2 ${timestamp}] ${message}`);
  }

  logStatus() {
    const queueStats = this.verificationQueue.getStats();
    const proxyStats = this.proxyManager.getProxyStats();

    if (queueStats.pending > 0 || queueStats.processing > 0) {
      this.log(`📊 Queue: ${queueStats.pending} pending, ${queueStats.processing} processing | Proxies: ${proxyStats.availableProxies}/${proxyStats.totalProxies} available`);
    }
  }

  async verifyUserHoldsTokens(username, currentCoinCA = null, forceRefresh = false) {
    this.metrics.totalRequests++;

    // Circuit breaker check - fail fast if system is overloaded
    if (this.isCircuitBreakerOpen()) {
      this.log(`🚨 Circuit breaker OPEN - rejecting verification for ${username}`);
      this.metrics.failedRequests++;
      return {
        verified: false,
        reason: 'System overloaded - verification temporarily disabled',
        hasTokens: false
      };
    }

    // Backpressure check - fail fast if queue is too large
    const queueStats = this.verificationQueue.getStats();
    if (queueStats.pending > this.circuitBreaker.maxQueueSize) {
      this.log(`🚨 Queue overloaded (${queueStats.pending}/${this.circuitBreaker.maxQueueSize}) - rejecting verification for ${username}`);
      this.recordFailure();
      this.metrics.failedRequests++;
      return {
        verified: false,
        reason: 'Verification queue overloaded - try again later',
        hasTokens: false
      };
    }

    // Check cache first (unless forcing refresh for launch commands)
    const cacheKey = `${username}:${currentCoinCA || 'any'}`;
    const cachedResult = this.holdingsCache.get(cacheKey);

    if (!forceRefresh && cachedResult && (Date.now() - cachedResult.timestamp) < 5 * 60 * 1000) {
      this.log(`✅ Using cached result for ${username}`);
      return cachedResult.result;
    }

    if (forceRefresh) {
      this.log(`🔄 Force refresh requested for ${username} - bypassing cache`);
    }

    // Check if we already have a pending request for this user
    const pendingKey = `${username}:${currentCoinCA || 'any'}`;
    if (this.pendingResults.has(pendingKey)) {
      this.log(`⏳ Waiting for existing verification request: ${username}`);
      return await this.pendingResults.get(pendingKey);
    }

    // Create new verification request
    return new Promise((resolve, reject) => {
      const requestData = {
        username,
        currentCoinCA,
        cacheKey,
        pendingKey
      };

      // Store the promise so other requests can wait for it
      this.pendingResults.set(pendingKey, new Promise((res, rej) => {
        requestData.resolve = res;
        requestData.reject = rej;
      }));

      // Add to queue
      const queueId = this.verificationQueue.add(requestData);
      this.log(`📥 Queued verification request for ${username} (Queue ID: ${queueId})`);

      // Return the pending promise
      this.pendingResults.get(pendingKey).then(resolve).catch(reject);
    });
  }

  async processVerificationRequest(requestData) {
    const { username, currentCoinCA, cacheKey, pendingKey, resolve, reject } = requestData;
    const startTime = Date.now();

    try {
      this.log(`🔍 Processing verification for: ${username}`);

      // Get next available proxy
      const proxy = this.proxyManager.getNextAvailableProxy();

      // Perform the actual verification
      const result = await this.checkUserHoldings(username, currentCoinCA, proxy);

      // Record timing and success
      const responseTime = Date.now() - startTime;
      this.recordResponseTime(responseTime);
      this.recordSuccess();

      // Cache the result
      this.holdingsCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      // Resolve the pending promise
      if (resolve) {
        resolve(result);
      }

      // Clean up pending requests
      this.pendingResults.delete(pendingKey);

      this.log(`✅ Verification completed for ${username}: ${result.verified ? 'PASSED' : 'FAILED'} (${responseTime}ms)`);

      return { success: true, result };

    } catch (error) {
      // Record timing and failure
      const responseTime = Date.now() - startTime;
      this.recordResponseTime(responseTime);
      this.recordFailure();

      this.log(`❌ Verification failed for ${username}: ${error.message} (${responseTime}ms)`);

      // Create a failed result instead of rejecting
      const failedResult = {
        verified: false,
        reason: `Verification failed: ${error.message}`,
        hasTokens: false
      };

      // Resolve with failed result instead of rejecting
      if (resolve) {
        resolve(failedResult);
      }

      // Clean up pending requests
      this.pendingResults.delete(pendingKey);

      return { success: false, error: error.message };
    }
  }

  async checkUserHoldings(username, currentCoinCA = null, proxy) {
    let browser = null;
    let page = null;

    try {
      // Launch browser with proxy - optimized for speed
      browser = await chromium.launch({
        headless: true, // Production mode
        proxy: proxy,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-images', // Faster loading
          '--disable-web-security', // Faster loading
          '--disable-features=TranslateUI', // Faster loading
          '--disable-ipc-flooding-protection' // Better performance
        ]
      });

      page = await browser.newPage();

      // Optimize page for speed
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      });

      // Navigate to user's balances page - reduced timeout for high load
      const profileUrl = `https://pump.fun/profile/${username}?tab=balances`;
      this.log(`📄 Loading: ${profileUrl} (Proxy: ${proxy.server})`);

      await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000 // Reduced from 30s
      });

      // Reduced wait time for balances to load
      this.log(`⏰ Waiting for balances to load...`);
      await page.waitForTimeout(3000); // Reduced from 5s

      // Check if our new selectors exist
      try {
        await page.waitForSelector('.flex.min-w-0.flex-col.justify-start', { timeout: 8000 }); // Reduced from 10s
      } catch (e) {
        // Fallback: try to find any token-related content
        try {
          await page.waitForSelector('.truncate.font-bold', { timeout: 3000 });
        } catch (e2) {
          this.log(`⚠️ No token holdings found for ${username} - page may not have loaded properly`);
          return {
            verified: false,
            reason: 'No token holdings found or page failed to load',
            hasTokens: false
          };
        }
      }


      // Extract all token holdings using new pump.fun structure
      const holdings = await page.$$eval('.flex.min-w-0.flex-col.justify-start', (elements) => {
        return elements.map(el => {
          // Find token name in the bold div
          const nameEl = el.querySelector('.truncate.font-bold');
          const tokenName = nameEl ? nameEl.textContent.trim() : '';

          // Find balance in the gray text div
          const balanceEl = el.querySelector('.truncate.text-xs.text-gray-500, .truncate.text-sm.text-gray-500');
          const balanceText = balanceEl ? balanceEl.textContent.trim() : '';

          // Extract amount and ticker from balance text (like "51,107 Warfare")
          const balanceMatch = balanceText.match(/^([\d.,KM]+)\s+(.+)$/);
          const amountStr = balanceMatch ? balanceMatch[1] : '0';
          const ticker = balanceMatch ? balanceMatch[2] : '';

          // Parse amount handling different formats with validation
          let numericAmount = 0;
          try {
            if (amountStr.includes('K')) {
              // Handle K notation (like "1.5K" = 1500)
              const kValue = parseFloat(amountStr.replace('K', ''));
              numericAmount = isNaN(kValue) ? 0 : kValue * 1000;
            } else if (amountStr.includes('M')) {
              // Handle M notation (like "2.5M" = 2500000)
              const mValue = parseFloat(amountStr.replace('M', ''));
              numericAmount = isNaN(mValue) ? 0 : mValue * 1000000;
            } else {
              // Handle comma-separated numbers (like "51,107" = 51107)
              const cleanAmount = amountStr.replace(/,/g, '');
              numericAmount = isNaN(parseFloat(cleanAmount)) ? 0 : parseFloat(cleanAmount);
            }
          } catch (error) {
            numericAmount = 0; // Fallback to 0 on any parsing error
          }

          // Check if user has minimum 1.5M tokens (1,500,000)
          const hasTokens = numericAmount >= 1500000;

          return {
            tokenName,
            ticker,
            balanceText,
            amount: amountStr,
            numericAmount,
            hasTokens
          };
        }).filter(holding => holding.tokenName || holding.ticker); // Only include valid holdings
      });

      this.log(`📊 Found ${holdings.length} token holdings for ${username}`);

      // Log all holdings for debugging
      holdings.forEach(holding => {
        this.log(`  💰 ${holding.tokenName} (${holding.ticker}): ${holding.balanceText} (Amount: ${holding.numericAmount}) ${holding.hasTokens ? '✅ MEETS 1.5M' : '❌ BELOW 1.5M'}`);
      });

      // Check if user has STREAML token holdings >= 1.5M
      // const hasMinimumTokens = holdings.some(holding => holding.ticker && holding.ticker.toLowerCase() === 'streaml' && holding.hasTokens);
      const hasMinimumTokens = true; // Temporarily disabled token requirement

      let result;
      if (currentCoinCA) {
        // Check if user holds the specific ticker with minimum 1.5M tokens
        const holdsSpecificCoin = holdings.some(holding =>
          holding.ticker && holding.ticker.toLowerCase() === currentCoinCA.toLowerCase() &&
          holding.hasTokens // Must also meet 1.5M minimum
        );

        result = {
          verified: holdsSpecificCoin,
          reason: holdsSpecificCoin
            ? `User holds ${currentCoinCA} with minimum 1.5M tokens`
            : `User does not hold ${currentCoinCA} with minimum 1.5M tokens`,
          hasTokens: hasMinimumTokens,
          holdings: holdings.length,
          specificCoinHolding: holdsSpecificCoin,
          tokenDetails: holdings
        };
      } else {
        // Check if they hold any tokens with minimum 1.5M
        result = {
          verified: hasMinimumTokens,
          reason: hasMinimumTokens
            ? `User holds ${holdings.filter(h => h.hasTokens).length} tokens with minimum 1.5M requirement`
            : 'User has no token holdings meeting 1.5M minimum requirement',
          hasTokens: hasMinimumTokens,
          holdings: holdings.length,
          tokenDetails: holdings
        };
      }

      return result;

    } catch (error) {
      this.log(`❌ Error during verification: ${error.message}`);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }
      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
      }
    }
  }

  // Get verification queue statistics
  getQueueStats() {
    return this.verificationQueue.getStats();
  }

  // Get proxy statistics
  getProxyStats() {
    return this.proxyManager.getProxyStats();
  }

  // Get overall system status
  getSystemStatus() {
    return {
      queue: this.getQueueStats(),
      proxies: this.getProxyStats(),
      cache: {
        size: this.holdingsCache.size,
        pending: this.pendingResults.size
      }
    };
  }

  // Clear expired cache entries
  clearExpiredCache() {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 minutes

    for (const [key, value] of this.holdingsCache.entries()) {
      if (now - value.timestamp > expireTime) {
        this.holdingsCache.delete(key);
      }
    }
  }

  // Circuit breaker methods for high-load protection
  isCircuitBreakerOpen() {
    const now = Date.now();

    // If circuit is open, check if we should reset it
    if (this.circuitBreaker.isOpen) {
      if (now > this.circuitBreaker.openUntil) {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = 0;
        this.log(`🔄 Circuit breaker RESET - allowing requests again`);
        return false;
      }
      return true;
    }

    // Check if we should open the circuit
    if (this.circuitBreaker.failureCount >= this.circuitBreaker.maxFailures) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.openUntil = now + this.circuitBreaker.resetTimeout;
      this.log(`🚨 Circuit breaker OPENED due to ${this.circuitBreaker.failureCount} failures`);
      return true;
    }

    return false;
  }

  recordSuccess() {
    this.circuitBreaker.successCount++;
    this.metrics.successfulRequests++;

    // Gradually reduce failure count on success
    if (this.circuitBreaker.failureCount > 0) {
      this.circuitBreaker.failureCount = Math.max(0, this.circuitBreaker.failureCount - 1);
    }
  }

  recordFailure() {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();
    this.metrics.failedRequests++;
  }

  recordResponseTime(responseTime) {
    this.metrics.responseTimes.push(responseTime);

    // Keep only last 100 response times for average calculation
    if (this.metrics.responseTimes.length > 100) {
      this.metrics.responseTimes.shift();
    }

    // Calculate rolling average
    this.metrics.averageResponseTime = this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
  }

  // Enhanced system status with circuit breaker info
  getSystemStatus() {
    return {
      queue: this.getQueueStats(),
      proxies: this.getProxyStats(),
      cache: {
        size: this.holdingsCache.size,
        pending: this.pendingResults.size
      },
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failureCount: this.circuitBreaker.failureCount,
        successCount: this.circuitBreaker.successCount,
        openUntil: this.circuitBreaker.isOpen ? new Date(this.circuitBreaker.openUntil).toISOString() : null
      },
      metrics: {
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        successRate: this.metrics.totalRequests > 0 ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + '%' : '0%',
        averageResponseTime: Math.round(this.metrics.averageResponseTime) + 'ms'
      }
    };
  }

  // Graceful shutdown
  shutdown() {
    this.log('🛑 Shutting down verification service...');
    this.verificationQueue.stopProcessing();
  }
}

export { WalletVerificationServiceV2 };