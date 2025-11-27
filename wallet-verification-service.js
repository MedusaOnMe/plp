import { chromium } from 'playwright';

class WalletVerificationService {
  constructor() {
    this.proxies = [
      { server: 'http://91.207.57.22:10041', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://91.207.57.22:10043', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://91.207.57.22:10046', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://91.207.57.22:10047', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://91.207.57.22:10052', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://91.207.57.22:10053', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' }
    ];
    this.currentProxyIndex = 0;
    this.verificationQueue = [];
    this.isProcessing = false;
    this.walletCache = new Map(); // Cache wallet addresses to avoid re-scraping
    this.holdingsCache = new Map(); // Cache holdings checks (expire after 5 minutes)
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[WalletVerification ${timestamp}] ${message}`);
  }

  getNextProxy() {
    const proxy = this.proxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    return proxy;
  }

  async verifyUserHoldsTokens(username, currentCoinCA = null) {
    return new Promise((resolve) => {
      // Add to queue for processing
      this.verificationQueue.push({
        username,
        currentCoinCA,
        resolve,
        timestamp: Date.now()
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.verificationQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const request = this.verificationQueue.shift();

    try {
      const result = await this.checkUserHoldings(request.username, request.currentCoinCA);
      request.resolve(result);
    } catch (error) {
      this.log(`❌ Error verifying ${request.username}: ${error.message}`);
      request.resolve({
        verified: false,
        reason: `Verification failed: ${error.message}`,
        hasTokens: false
      });
    }

    // Process next item after a brief delay
    setTimeout(() => this.processQueue(), 1000);
  }

  async checkUserHoldings(username, currentCoinCA = null) {
    const cacheKey = `${username}:${currentCoinCA || 'any'}`;
    const cachedResult = this.holdingsCache.get(cacheKey);

    // Return cached result if less than 5 minutes old
    if (cachedResult && (Date.now() - cachedResult.timestamp) < 5 * 60 * 1000) {
      this.log(`✅ Using cached result for ${username}`);
      return cachedResult.result;
    }

    this.log(`🔍 Checking holdings for user: ${username}`);

    const proxy = this.getNextProxy();
    this.log(`🌐 Using proxy: ${proxy.server}`);

    let browser = null;
    let page = null;

    try {
      // Launch browser with proxy
      browser = await chromium.launch({
        headless: true, // Headless for production (set to false for debugging)
        proxy: proxy
      });

      page = await browser.newPage();

      // Navigate to user's balances page
      const profileUrl = `https://pump.fun/profile/${username}?tab=balances`;
      this.log(`📄 Loading: ${profileUrl}`);

      await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for the balances to load
      this.log(`⏰ Waiting for balances to load...`);
      await page.waitForTimeout(5000);

      // Check if the balances tab is active and has content
      try {
        await page.waitForSelector('[href*="/coin/"]', { timeout: 10000 });
      } catch (e) {
        this.log(`⚠️ No holdings found or page didn't load properly for ${username}`);
        return {
          verified: false,
          reason: 'No holdings found or page failed to load',
          hasTokens: false
        };
      }

      // Extract all token holdings
      const holdings = await page.$$eval('[href*="/coin/"]', (elements) => {
        return elements.map(el => {
          // Extract contract address from href
          const href = el.getAttribute('href');
          const caMatch = href.match(/\/coin\/([A-Za-z0-9]+)$/);
          const contractAddress = caMatch ? caMatch[1] : null;

          // Find the balance text (like "0 Smushy" or "1.5K PEPE")
          const balanceEl = el.querySelector('.truncate.text-xs.text-gray-500, .truncate.text-sm.text-gray-500');
          const balanceText = balanceEl ? balanceEl.textContent.trim() : '';

          // Extract amount from balance text
          const amountMatch = balanceText.match(/^([\d.,K]+)\s+/);
          const amount = amountMatch ? amountMatch[1] : '0';

          // Check if amount is greater than 0
          const isNonZero = amount !== '0' && amount !== '0.0' && !amount.startsWith('0 ');

          return {
            contractAddress,
            balanceText,
            amount,
            isNonZero
          };
        });
      });

      this.log(`📊 Found ${holdings.length} token holdings for ${username}`);

      // Log all holdings for debugging
      holdings.forEach(holding => {
        this.log(`  💰 ${holding.contractAddress}: ${holding.balanceText} (Non-zero: ${holding.isNonZero})`);
      });

      // Check if user has any non-zero holdings
      const hasAnyTokens = holdings.some(holding => holding.isNonZero);

      let result;
      if (currentCoinCA) {
        // Check if they hold the specific coin
        const holdsSpecificCoin = holdings.some(holding =>
          holding.contractAddress === currentCoinCA && holding.isNonZero
        );

        result = {
          verified: holdsSpecificCoin,
          reason: holdsSpecificCoin
            ? `User holds ${currentCoinCA}`
            : `User does not hold ${currentCoinCA}`,
          hasTokens: hasAnyTokens,
          holdings: holdings.length,
          specificCoinHolding: holdsSpecificCoin
        };
      } else {
        // Check if they hold any tokens at all
        result = {
          verified: hasAnyTokens,
          reason: hasAnyTokens
            ? `User holds ${holdings.filter(h => h.isNonZero).length} different tokens`
            : 'User has no token holdings',
          hasTokens: hasAnyTokens,
          holdings: holdings.length
        };
      }

      // Cache the result
      this.holdingsCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      this.log(`✅ Verification result for ${username}: ${result.verified ? 'PASSED' : 'FAILED'} - ${result.reason}`);
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

  // Clear old cache entries
  clearExpiredCache() {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 minutes

    for (const [key, value] of this.holdingsCache.entries()) {
      if (now - value.timestamp > expireTime) {
        this.holdingsCache.delete(key);
      }
    }
  }
}

export { WalletVerificationService };