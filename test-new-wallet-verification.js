import { WalletVerificationServiceV2 } from './wallet-verification-service-v2.js';

async function testNewWalletVerification() {
  console.log('🧪 Testing New Wallet Verification System');
  console.log('==========================================');

  const verificationService = new WalletVerificationServiceV2();

  // Wait for initialization
  console.log('⏰ Waiting for service initialization...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test 1: Known user with tokens
  console.log('\n📋 TEST 1: SmushyCrew (known user with tokens)');
  try {
    const result1 = await verificationService.verifyUserHoldsTokens('SmushyCrew');
    console.log(`✅ Result: ${result1.verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
    console.log(`📝 Reason: ${result1.reason}`);
    console.log(`💰 Has Tokens: ${result1.hasTokens}`);
    console.log(`📊 Holdings Count: ${result1.holdings}`);

    if (result1.tokenDetails && result1.tokenDetails.length > 0) {
      console.log('📋 Token Details:');
      result1.tokenDetails.slice(0, 3).forEach((token, i) => {
        console.log(`   ${i+1}. ${token.tokenName} (${token.ticker}): ${token.balanceText}`);
      });
    }
  } catch (error) {
    console.log(`❌ Test 1 Failed: ${error.message}`);
  }

  // Test 2: Circuit breaker simulation
  console.log('\n📋 TEST 2: Circuit Breaker Status');
  const systemStatus = verificationService.getSystemStatus();
  console.log('🔧 System Status:');
  console.log(`   Queue: ${systemStatus.queue.pending} pending, ${systemStatus.queue.processing} processing`);
  console.log(`   Proxies: ${systemStatus.proxies.availableProxies}/${systemStatus.proxies.totalProxies} available`);
  console.log(`   Circuit Breaker: ${systemStatus.circuitBreaker.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`   Failures: ${systemStatus.circuitBreaker.failureCount}`);
  console.log(`   Success Rate: ${systemStatus.metrics.successRate}`);
  console.log(`   Avg Response Time: ${systemStatus.metrics.averageResponseTime}`);

  // Test 3: Stress test with multiple users
  console.log('\n📋 TEST 3: Concurrent Verification Test (5 users)');
  const testUsers = ['SmushyCrew', 'testuser1', 'testuser2', 'testuser3', 'nonexistentuser'];

  try {
    const startTime = Date.now();
    const promises = testUsers.map(async (user, index) => {
      try {
        console.log(`🔍 Starting verification for ${user}...`);
        const result = await verificationService.verifyUserHoldsTokens(user);
        console.log(`✅ ${user}: ${result.verified ? 'VERIFIED' : 'NOT VERIFIED'} - ${result.reason}`);
        return { user, success: true, result };
      } catch (error) {
        console.log(`❌ ${user}: ERROR - ${error.message}`);
        return { user, success: false, error: error.message };
      }
    });

    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    console.log(`\n⏱️ Concurrent test completed in ${totalTime}ms`);
    console.log(`📊 Results: ${results.filter(r => r.success).length}/${results.length} successful`);

  } catch (error) {
    console.log(`❌ Concurrent test failed: ${error.message}`);
  }

  // Test 4: Final system status
  console.log('\n📋 TEST 4: Final System Status');
  const finalStatus = verificationService.getSystemStatus();
  console.log('📊 Final Metrics:');
  console.log(`   Total Requests: ${finalStatus.metrics.totalRequests}`);
  console.log(`   Successful: ${finalStatus.metrics.successfulRequests}`);
  console.log(`   Failed: ${finalStatus.metrics.failedRequests}`);
  console.log(`   Success Rate: ${finalStatus.metrics.successRate}`);
  console.log(`   Average Response Time: ${finalStatus.metrics.averageResponseTime}`);
  console.log(`   Circuit Breaker: ${finalStatus.circuitBreaker.isOpen ? 'OPEN' : 'CLOSED'}`);

  console.log('\n🏁 All tests completed!');
  console.log('💡 If you see "VERIFIED" results with token details, the new system is working!');

  // Graceful shutdown
  verificationService.shutdown();

  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// Run the test
testNewWalletVerification().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});