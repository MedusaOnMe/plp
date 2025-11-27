import { WalletVerificationService } from './wallet-verification-service.js';

async function testWalletVerification() {
  console.log('🧪 Testing Wallet Verification Service');
  console.log('=====================================');

  const verificationService = new WalletVerificationService();

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

  // Test 2: Check if SmushyCrew holds the specific test CA
  console.log('\n📋 TEST 2: Check if SmushyCrew holds LGiKAMtb4BuPdhpThjEbNWbDddqdM5FnxMMHqtzpump');
  try {
    const result2 = await verificationService.verifyUserHoldsTokens('SmushyCrew', 'LGiKAMtb4BuPdhpThjEbNWbDddqdM5FnxMMHqtzpump');
    console.log('\n✅ Test 2 Results:');
    console.log(`   Verified: ${result2.verified}`);
    console.log(`   Reason: ${result2.reason}`);
    console.log(`   Has Tokens: ${result2.hasTokens}`);
    console.log(`   Total Holdings: ${result2.holdings}`);
    console.log(`   Holds Specific Coin: ${result2.specificCoinHolding}`);
  } catch (error) {
    console.log(`❌ Test 2 Failed: ${error.message}`);
  }

  console.log('\n🏁 Testing Complete!');
  process.exit(0);
}

// Run the test
testWalletVerification().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});