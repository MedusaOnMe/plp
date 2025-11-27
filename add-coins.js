import { FirebaseService } from './firebase-service.js';

const firebase = new FirebaseService();

async function addCoins() {
    try {
        await firebase.initialize();
        console.log('🔥 Firebase initialized successfully');

        // Contract addresses to add
        const contractAddresses = [
            'E8bGqV2GwYp422Bbm4ot4wwX3oodJTFSnemTxVQpump',
            '9zdV7hSbisPRfALAEosvRT9A6ZhMrGoUnEJ4738Mpump',
            '4dEQZ8Zmr4BPQgfpBh66GDHCKeuN5yo5XfdJWqQkpump',
            '6f3HrjW4g8ptwka7SRQi9TbXyb93L2uXEPSjoy32pBLV',
            'EVGox5PPxnFqTsMXMoUBSCUhszqK6UUYf9W7pkwfpump',
            '3n5FWFgWf3tFtbVVCvYz17yTUxGdfjexjQMzw9Xmpump',
            '3nKHept3MmkCPeRZXG6uxegbX9hq3LP5xkQFApufzdfq',
            'GJSt2k7vW2UCHatkQKkcDAxbbuLNM3uXLNK9jNGKpump',
            '3VtPuJQbYQTHVujGzRYSk2i7KyzQDgjCKCour2Hzpump',
            '9aPim6zMMXiJ1PsHCh64dA9QfRkFc1risxY4R49yJs6q'
        ];

        for (const contractAddress of contractAddresses) {
            console.log(`\n🚀 Adding coin: ${contractAddress}`);

            const coinData = {
                contractAddress: contractAddress,
                name: `TestCoin-${contractAddress.slice(0, 8)}`,
                ticker: contractAddress.slice(0, 6).toUpperCase(),
                creator: 'test-creator',
                description: `Test coin with contract ${contractAddress}`,
                imageUrl: 'https://via.placeholder.com/150',
                marketCap: Math.floor(Math.random() * 1000000) + 50000, // Random between 50K-1M
                price: (Math.random() * 0.001) + 0.0001, // Random small price
                volume24h: Math.floor(Math.random() * 100000),
                priceChange24h: (Math.random() - 0.5) * 20, // Random -10% to +10%
                createdAt: new Date().toISOString(),
                addedToDatabase: new Date().toISOString(),
                lastUpdate: new Date().toISOString()
            };

            await firebase.addCoin(contractAddress, coinData);
            console.log(`✅ Successfully added: ${coinData.name}`);
        }

        console.log('\n🎉 All coins added successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error adding coins:', error);
        process.exit(1);
    }
}

addCoins();