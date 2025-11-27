import { PersistentChatScraper } from './persistent-chat-scraper.js';

async function testIntegratedLaunch() {
  console.log('🧪 Testing Integrated Launch System');
  console.log('=====================================');

  const scraper = new PersistentChatScraper();

  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Create a mock message with launch command
  const mockMessage = {
    id: `test-${Date.now()}`,
    text: '/launch TestCoin TEST',
    user: 'TestUser',
    time: new Date().toLocaleTimeString(),
    walletAddress: 'TestWallet123',
    profileImageUrl: 'https://ipfs.io/ipfs/QmTestHash123'
  };

  console.log('\n📋 Testing launch command processing:');
  console.log(`Command: ${mockMessage.text}`);
  console.log(`User: ${mockMessage.user}`);
  console.log(`Profile Image: ${mockMessage.profileImageUrl}`);

  try {
    // Test the launch command processing
    await scraper.checkForLaunchCommand(mockMessage);
    console.log('\n✅ Launch command processing completed');
  } catch (error) {
    console.log(`\n❌ Launch command processing failed: ${error.message}`);
  }

  // Graceful shutdown
  console.log('\n🛑 Shutting down test...');
  scraper.walletVerification.shutdown();

  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// Run the test
testIntegratedLaunch().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});