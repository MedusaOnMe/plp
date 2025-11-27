import { WalletVerificationServiceV2 } from './wallet-verification-service-v2.js';

async function testWalletVerificationV2() {
  console.log('🧪 Testing Wallet Verification Service V2');
  console.log('==========================================');

  const verificationService = new WalletVerificationServiceV2();

  // Wait a moment for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 1: Check if SmushyCrew holds any tokens
  console.log('\n📋 TEST 1: Check if SmushyCrew holds any tokens');
  try {
    const result1 = await verificationService.verifyUserHoldsTokens('SmushyCrew');
    console.log('\n✅ Test 1 Results:');
    console.log(`   Verified: ${result1.verified}`);
    console.log(`   Reason: ${result1.reason}`);
    console.log(`   Has Tokens: ${result1.hasTokens}`);
    console.log(`   Total Holdings: ${result1.holdings}`);
  } catch (error) {
    console.log(`❌ Test 1 Failed: ${error.message}`);
  }

  // Test 2: Test the same user again (should use cache)
  console.log('\n📋 TEST 2: Same user again (should use cache)');
  try {
    const result2 = await verificationService.verifyUserHoldsTokens('SmushyCrew');
    console.log('\n✅ Test 2 Results:');
    console.log(`   Verified: ${result2.verified}`);
    console.log(`   Reason: ${result2.reason}`);
  } catch (error) {
    console.log(`❌ Test 2 Failed: ${error.message}`);
  }

  // Test 3: Test multiple users simultaneously (queue test)
  console.log('\n📋 TEST 3: Multiple users simultaneously (queue test)');
  try {
    const users = ['SmushyCrew', 'testuser1', 'testuser2'];
    const promises = users.map(user =>
      verificationService.verifyUserHoldsTokens(user).catch(err => ({
        error: err.message,
        user
      }))
    );

    const results = await Promise.all(promises);
    console.log('\n✅ Test 3 Results:');
    results.forEach((result, index) => {
      if (result.error) {
        console.log(`   ${users[index]}: ERROR - ${result.error}`);
      } else {
        console.log(`   ${users[index]}: ${result.verified ? 'VERIFIED' : 'NOT VERIFIED'} - ${result.reason}`);
      }
    });
  } catch (error) {
    console.log(`❌ Test 3 Failed: ${error.message}`);
  }

  // Show system status
  console.log('\n📊 SYSTEM STATUS:');
  const status = verificationService.getSystemStatus();
  console.log(`   Queue: ${status.queue.pending} pending, ${status.queue.processing} processing, ${status.queue.completed} completed`);
  console.log(`   Proxies: ${status.proxies.availableProxies}/${status.proxies.totalProxies} available`);
  console.log(`   Cache: ${status.cache.size} cached, ${status.cache.pending} pending`);

  // Wait a moment to see queue processing
  console.log('\n⏳ Waiting 10 seconds to observe queue processing...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Final status
  console.log('\n📊 FINAL STATUS:');
  const finalStatus = verificationService.getSystemStatus();
  console.log(`   Queue: ${finalStatus.queue.pending} pending, ${finalStatus.queue.processing} processing, ${finalStatus.queue.completed} completed`);
  console.log(`   Proxies: ${finalStatus.proxies.availableProxies}/${finalStatus.proxies.totalProxies} available`);

  console.log('\n🏁 Testing Complete!');

  // Graceful shutdown
  verificationService.shutdown();

  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// Run the test
testWalletVerificationV2().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});