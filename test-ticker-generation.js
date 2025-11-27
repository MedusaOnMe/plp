import { PersistentChatScraper } from './persistent-chat-scraper.js';

async function testTickerGeneration() {
  console.log('🧪 Testing New Ticker Generation System');
  console.log('=====================================');

  // Create a scraper instance to access the generateTicker method
  const scraper = new PersistentChatScraper();

  // Test cases
  const testCases = [
    // Multiple meaningful words
    "Moon Rocket",
    "Super Doge Coin",
    "Diamond Hands Token",
    "Bull Market Pump",

    // With excluded words mixed in
    "The Amazing Token",
    "My Big Pump Coin",
    "A Very Cool Project",
    "The Best Token Ever",

    // Only excluded words (should pick one anyway)
    "The Very Best",
    "A Big New",
    "My Very Own",

    // Single words
    "Bitcoin",
    "Ethereum",
    "Solana",
    "PEPE",
    "t",

    // Edge cases
    "SuperLongTokenNameHere",
    "Token with Special!@# Characters",
    "   Spaced   Out   Token   ",
    "123 Number Token",

    // Extreme cases
    "The And Or But So",  // All excluded words
    "!@#$%^&*()",         // All special characters
    "",                   // Empty (this will be caught by validation)
    "A"                   // Single letter
  ];

  console.log('\n📋 Testing ticker generation for various inputs:\n');

  testCases.forEach((testCase, index) => {
    if (testCase === "") {
      console.log(`${index + 1:2}. "${testCase}" → [EMPTY - would be caught by validation]`);
      return;
    }

    try {
      const ticker = scraper.generateTicker(testCase);
      console.log(`${(index + 1).toString().padStart(2)}. "${testCase}" → "${ticker}"`);
    } catch (error) {
      console.log(`${(index + 1).toString().padStart(2)}. "${testCase}" → ERROR: ${error.message}`);
    }
  });

  console.log('\n🎯 Testing command parsing simulation:\n');

  // Test the full command parsing logic simulation
  const commandTests = [
    "/launch Moon Rocket",
    "/launch The Amazing Super Token",
    "/launch Bitcoin",
    "/launch My Very Cool Project Name",
    "/launch t",
    "/launch This is a really long token name here", // 32+ chars test
  ];

  commandTests.forEach((command, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. Command: "${command}"`);

    // Simulate the parsing logic
    const parts = command.trim().split(/\s+/);
    if (parts.length < 2) {
      console.log(`    → ERROR: Invalid format`);
      return;
    }

    const coinName = parts.slice(1).join(' ').trim();

    if (coinName.length === 0) {
      console.log(`    → ERROR: Empty token name`);
      return;
    }

    if (coinName.length > 32) {
      console.log(`    → ERROR: Token name too long (${coinName.length} chars, max 32)`);
      return;
    }

    const ticker = scraper.generateTicker(coinName);
    console.log(`    → Name: "${coinName}" (${coinName.length} chars)`);
    console.log(`    → Ticker: "${ticker}"`);
    console.log('');
  });

  console.log('🏁 Testing complete!');
  console.log('\n💡 How it works:');
  console.log('- Type: /launch Your Token Name');
  console.log('- System automatically generates ticker from meaningful words');
  console.log('- If only filler words, picks one anyway');
  console.log('- Max 32 chars for name, max 10 chars for ticker');

  // Don't start the actual scraper, just exit
  process.exit(0);
}

// Run the test
testTickerGeneration().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});