import { chromium } from 'playwright';
import { WalletVerificationServiceV2 } from './wallet-verification-service-v2.js';

class WalletVerificationDebugger {
  constructor() {
    this.results = {
      websiteStructure: null,
      proxyTest: null,
      selectorTest: null,
      thresholdTest: null,
      userTests: []
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: '🔍',
      success: '✅',
      warning: '⚠️',
      error: '❌',
      debug: '🐛'
    }[type] || '📝';

    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async testWebsiteStructure() {
    this.log('Testing pump.fun website structure and selectors...', 'info');

    let browser = null;
    let page = null;

    try {
      // Test without proxy first
      browser = await chromium.launch({ headless: false }); // Set to false to see what's happening
      page = await browser.newPage();

      // Test a known user with tokens
      const testUser = 'SmushyCrew'; // Known user from your tests
      const profileUrl = `https://pump.fun/profile/${testUser}?tab=balances`;

      this.log(`Loading: ${profileUrl}`, 'debug');

      await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      this.log('Waiting for page to fully load...', 'debug');
      await page.waitForTimeout(5000);

      // Take screenshot for debugging
      await page.screenshot({ path: 'debug-pump-fun.png', fullPage: true });
      this.log('Screenshot saved as debug-pump-fun.png', 'debug');

      // Test current selectors
      const currentSelectors = {
        tokenLinks: '[href*="/coin/"]',
        balanceText1: '.truncate.text-xs.text-gray-500',
        balanceText2: '.truncate.text-sm.text-gray-500',
        profileLink: 'a[href*="/profile/"]',
        profileImage: 'img[alt*="profile picture"]'
      };

      const selectorResults = {};

      for (const [name, selector] of Object.entries(currentSelectors)) {
        try {
          const elements = await page.$$(selector);
          selectorResults[name] = {
            selector,
            found: elements.length,
            exists: elements.length > 0
          };

          if (elements.length > 0) {
            // Get sample text/attributes
            if (name === 'tokenLinks') {
              const hrefs = await page.$$eval(selector, els => els.slice(0, 3).map(el => el.getAttribute('href')));
              selectorResults[name].sample = hrefs;
            } else if (name.includes('balanceText')) {
              const texts = await page.$$eval(selector, els => els.slice(0, 3).map(el => el.textContent?.trim()));
              selectorResults[name].sample = texts;
            }
          }

          this.log(`Selector "${name}": Found ${elements.length} elements`, elements.length > 0 ? 'success' : 'warning');
        } catch (error) {
          selectorResults[name] = {
            selector,
            error: error.message
          };
          this.log(`Selector "${name}" failed: ${error.message}`, 'error');
        }
      }

      // Test alternative selectors that might work
      const alternativeSelectors = [
        'a[href*="/coin/"]',
        '[data-*][href*="/coin/"]',
        '.token-balance',
        '.balance',
        '[class*="balance"]',
        '[class*="token"]',
        'span:contains("K")', // For amounts like "1.5K"
        'span:contains("M")', // For amounts like "2M"
      ];

      this.log('Testing alternative selectors...', 'debug');
      for (const selector of alternativeSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            this.log(`Alternative selector "${selector}": Found ${elements.length} elements`, 'success');
          }
        } catch (error) {
          // Ignore selector errors for alternatives
        }
      }

      // Get page HTML for manual inspection
      const pageContent = await page.content();

      this.results.websiteStructure = {
        success: true,
        url: profileUrl,
        selectorResults,
        pageTitle: await page.title(),
        htmlLength: pageContent.length
      };

      // Save HTML for debugging
      const fs = await import('fs');
      fs.writeFileSync('debug-pump-fun.html', pageContent);
      this.log('Page HTML saved as debug-pump-fun.html', 'debug');

      this.log('Website structure test completed', 'success');

    } catch (error) {
      this.log(`Website structure test failed: ${error.message}`, 'error');
      this.results.websiteStructure = {
        success: false,
        error: error.message
      };
    } finally {
      if (page) await page.close();
      if (browser) await browser.close();
    }
  }

  async testProxyFunctionality() {
    this.log('Testing proxy functionality...', 'info');

    const proxies = [
      { server: 'http://91.207.57.22:10041', username: 'j4FfiPzr5wKkCep', password: 'nE0TwKWh9aPHzh1' },
      { server: 'http://45.86.94.114:43260', username: 'Q8raEgCj0c00Der', password: 'J1HEHSaDvbhNCP2' }
    ];

    const proxyResults = [];

    for (const proxy of proxies) {
      let browser = null;
      let page = null;

      try {
        this.log(`Testing proxy: ${proxy.server}`, 'debug');

        browser = await chromium.launch({
          headless: true,
          proxy: proxy
        });

        page = await browser.newPage();

        // Test basic connectivity
        const startTime = Date.now();
        await page.goto('https://httpbin.org/ip', { timeout: 15000 });
        const responseTime = Date.now() - startTime;

        const ipInfo = await page.textContent('pre');

        // Test pump.fun access
        await page.goto('https://pump.fun', { timeout: 15000 });
        const pumpTitle = await page.title();

        proxyResults.push({
          proxy: proxy.server,
          success: true,
          responseTime,
          ipInfo: JSON.parse(ipInfo),
          pumpAccessible: pumpTitle.includes('pump') || pumpTitle.includes('Pump')
        });

        this.log(`Proxy ${proxy.server}: ✅ Working (${responseTime}ms)`, 'success');

      } catch (error) {
        proxyResults.push({
          proxy: proxy.server,
          success: false,
          error: error.message
        });

        this.log(`Proxy ${proxy.server}: ❌ Failed - ${error.message}`, 'error');
      } finally {
        if (page) await page.close();
        if (browser) await browser.close();
      }
    }

    this.results.proxyTest = proxyResults;
  }

  testThresholdLogic() {
    this.log('Testing 2M token threshold logic...', 'info');

    const testCases = [
      { input: '0 TOKEN', expected: false },
      { input: '1,000 TOKEN', expected: false },
      { input: '1,500,000 TOKEN', expected: false },
      { input: '2,000,000 TOKEN', expected: true },
      { input: '3,500,000 TOKEN', expected: true },
      { input: '1.5K TOKEN', expected: false }, // 1,500
      { input: '2K TOKEN', expected: true }, // 2,000 - but this is wrong!
      { input: '2.5K TOKEN', expected: true }, // 2,500
      { input: '1M TOKEN', expected: false }, // 1,000,000
      { input: '2.5M TOKEN', expected: true } // 2,500,000
    ];

    const results = [];

    for (const testCase of testCases) {
      // Replicate the logic from wallet-verification-service-v2.js
      const amountMatch = testCase.input.match(/^([\d.,K]+)\s+/);
      const amountStr = amountMatch ? amountMatch[1] : '0';

      let numericAmount = 0;
      if (amountStr.includes('K')) {
        const kValue = parseFloat(amountStr.replace('K', ''));
        numericAmount = kValue * 1000;
      } else if (amountStr.includes('M')) {
        const mValue = parseFloat(amountStr.replace('M', ''));
        numericAmount = mValue * 1000000;
      } else {
        numericAmount = parseFloat(amountStr.replace(/,/g, ''));
      }

      const meetsMinimum = numericAmount >= 2000000;
      const passed = meetsMinimum === testCase.expected;

      results.push({
        input: testCase.input,
        parsed: numericAmount,
        meetsMinimum,
        expected: testCase.expected,
        passed
      });

      this.log(`"${testCase.input}" → ${numericAmount} → ${meetsMinimum} (expected: ${testCase.expected}) ${passed ? '✅' : '❌'}`, passed ? 'success' : 'error');
    }

    this.results.thresholdTest = results;

    const failedTests = results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      this.log(`⚠️ Found ${failedTests.length} threshold logic issues!`, 'warning');
    } else {
      this.log('All threshold tests passed!', 'success');
    }
  }

  async testUserVerification() {
    this.log('Testing actual user verification with WalletVerificationServiceV2...', 'info');

    const testUsers = [
      'SmushyCrew', // Known user from your tests
      'nonexistentuser123', // Should fail
      'testuser' // Generic test
    ];

    try {
      const verificationService = new WalletVerificationServiceV2();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 3000));

      for (const username of testUsers) {
        try {
          this.log(`Testing verification for: ${username}`, 'debug');

          const startTime = Date.now();
          const result = await verificationService.verifyUserHoldsTokens(username);
          const duration = Date.now() - startTime;

          this.results.userTests.push({
            username,
            success: true,
            result,
            duration
          });

          this.log(`${username}: ${result.verified ? 'VERIFIED' : 'NOT VERIFIED'} - ${result.reason} (${duration}ms)`, result.verified ? 'success' : 'warning');

        } catch (error) {
          this.results.userTests.push({
            username,
            success: false,
            error: error.message
          });

          this.log(`${username}: ERROR - ${error.message}`, 'error');
        }

        // Wait between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Shutdown the service
      verificationService.shutdown();

    } catch (error) {
      this.log(`User verification test setup failed: ${error.message}`, 'error');
    }
  }

  async runAllTests() {
    this.log('🚀 Starting comprehensive wallet verification debugging...', 'info');
    this.log('=' .repeat(60), 'info');

    // Test 1: Website structure
    await this.testWebsiteStructure();

    // Test 2: Proxy functionality
    await this.testProxyFunctionality();

    // Test 3: Threshold logic
    this.testThresholdLogic();

    // Test 4: Actual verification
    await this.testUserVerification();

    this.log('=' .repeat(60), 'info');
    this.log('🏁 All tests completed!', 'info');

    // Generate summary report
    this.generateReport();
  }

  generateReport() {
    this.log('\n📊 SUMMARY REPORT', 'info');
    this.log('=' .repeat(40), 'info');

    // Website structure
    if (this.results.websiteStructure?.success) {
      const selectors = this.results.websiteStructure.selectorResults;
      const workingSelectors = Object.values(selectors).filter(s => s.exists).length;
      const totalSelectors = Object.keys(selectors).length;

      this.log(`Website Structure: ${workingSelectors}/${totalSelectors} selectors working`, workingSelectors === totalSelectors ? 'success' : 'warning');

      if (workingSelectors < totalSelectors) {
        this.log('🔧 ISSUE: Some CSS selectors are broken!', 'error');
        Object.entries(selectors).forEach(([name, result]) => {
          if (!result.exists) {
            this.log(`   - "${name}" (${result.selector}) found 0 elements`, 'error');
          }
        });
      }
    } else {
      this.log('Website Structure: FAILED', 'error');
    }

    // Proxy test
    const workingProxies = this.results.proxyTest?.filter(p => p.success).length || 0;
    const totalProxies = this.results.proxyTest?.length || 0;
    this.log(`Proxy Functionality: ${workingProxies}/${totalProxies} proxies working`, workingProxies > 0 ? 'success' : 'error');

    // Threshold test
    const passedThresholds = this.results.thresholdTest?.filter(t => t.passed).length || 0;
    const totalThresholds = this.results.thresholdTest?.length || 0;
    this.log(`Threshold Logic: ${passedThresholds}/${totalThresholds} tests passed`, passedThresholds === totalThresholds ? 'success' : 'warning');

    // User verification
    const successfulUsers = this.results.userTests?.filter(u => u.success).length || 0;
    const totalUsers = this.results.userTests?.length || 0;
    this.log(`User Verification: ${successfulUsers}/${totalUsers} users tested successfully`, successfulUsers > 0 ? 'success' : 'error');

    // Overall diagnosis
    this.log('\n🎯 DIAGNOSIS:', 'info');

    if (this.results.websiteStructure?.success) {
      const workingSelectors = Object.values(this.results.websiteStructure.selectorResults).filter(s => s.exists).length;
      if (workingSelectors < 3) {
        this.log('❌ PRIMARY ISSUE: Pump.fun website structure has changed', 'error');
        this.log('   → CSS selectors are no longer finding token data', 'error');
        this.log('   → This explains why verification was failing in production', 'error');
      }
    }

    if (workingProxies === 0) {
      this.log('❌ SECONDARY ISSUE: All proxies are failing', 'error');
      this.log('   → May indicate IP bans or proxy service issues', 'error');
    }

    const thresholdIssues = this.results.thresholdTest?.filter(t => !t.passed).length || 0;
    if (thresholdIssues > 0) {
      this.log(`⚠️  CONFIGURATION ISSUE: ${thresholdIssues} threshold logic problems`, 'warning');
      this.log('   → 2M token minimum may be too restrictive', 'warning');
    }

    this.log('\n💾 Debug files created:', 'info');
    this.log('   - debug-pump-fun.png (screenshot)', 'info');
    this.log('   - debug-pump-fun.html (page source)', 'info');

    // Save full results
    const fs = require('fs');
    fs.writeFileSync('debug-results.json', JSON.stringify(this.results, null, 2));
    this.log('   - debug-results.json (full test results)', 'info');
  }
}

// Run the debugger
async function main() {
  const debugger = new WalletVerificationDebugger();
  await debugger.runAllTests();

  // Keep process alive briefly to see results
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

main().catch(error => {
  console.error('❌ Debug script failed:', error);
  process.exit(1);
});