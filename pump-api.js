import fetch from 'node-fetch';
import FormData from 'form-data';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

class PumpFunAPI {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://pumpportal.fun/api';
    this.ipfsUrl = 'https://pump.fun/api/ipfs';
  }

  generateRandomKeypair() {
    return Keypair.generate();
  }

  async downloadImage(imageUrl, tempDir = './temp') {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      const fileName = `coin_image_${Date.now()}.${this.getImageExtension(imageUrl)}`;
      const filePath = path.join(tempDir, fileName);

      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (error) {
      console.error('Failed to download image:', error);
      return null;
    }
  }

  getImageExtension(url) {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    return match ? match[1] : 'png';
  }

  async getDefaultImage() {
    // Create a simple 100x100 orange PNG as default
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Minimal valid PNG (1x1 orange pixel, but we'll use a proper one)
    // This is a base64 encoded 100x100 solid orange PNG
    const orangePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkRpr/UAAABKSURBVHic7cExAQAAAMKg9U9tCj+gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN4GVOgAAX9HCJIAAAAASUVORK5CYII=';

    const filePath = path.join(tempDir, `default_coin_${Date.now()}.png`);
    const buffer = Buffer.from(orangePngBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    return filePath;
  }

  async uploadMetadataToIPFS(tokenData) {
    try {
      const form = new FormData();

      // Add token metadata
      form.append('name', tokenData.name);
      form.append('symbol', tokenData.ticker);
      form.append('description', tokenData.description || `Created using $STREAML`);

      // Add optional social links
      if (tokenData.twitter) form.append('twitter', tokenData.twitter);
      if (tokenData.telegram) form.append('telegram', tokenData.telegram);
      form.append('website', 'https://pump.fun/coin/DYa1hHcFih5Q811ZJJkRxh9HPtFFw4AG4gwwgoiWAbWc');

      // Handle image
      let imagePath = null;
      if (tokenData.imageUrl) {
        imagePath = await this.downloadImage(tokenData.imageUrl);
      }

      if (!imagePath) {
        imagePath = await this.getDefaultImage();
      }

      if (imagePath && fs.existsSync(imagePath)) {
        form.append('file', fs.createReadStream(imagePath));
      }

      const response = await fetch(this.ipfsUrl, {
        method: 'POST',
        body: form
      });

      const result = await response.json();

      // Clean up temporary image file
      if (imagePath && fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

      if (!response.ok) {
        throw new Error(`IPFS upload failed: ${result.error || response.statusText}`);
      }

      return result;
    } catch (error) {
      console.error('IPFS upload error:', error);
      throw error;
    }
  }

  async createToken(tokenData, options = {}) {
    try {
      console.log(`Creating token: ${tokenData.name} (${tokenData.ticker})`);

      // Generate keypair for the new token
      const mintKeypair = this.generateRandomKeypair();

      // Upload metadata to IPFS first
      const metadataResult = await this.uploadMetadataToIPFS(tokenData);
      console.log('Metadata uploaded to IPFS:', metadataResult.metadataUri);

      // Prepare transaction data - Lightning API format
      const transactionData = {
        "action": "create",
        "tokenMetadata": {
          "name": tokenData.name,
          "symbol": tokenData.ticker,
          "uri": metadataResult.metadataUri
        },
        "mint": bs58.encode(mintKeypair.secretKey), // Lightning API needs mint keypair secret key
        "denominatedInSol": "true",
        "amount": options.initialBuy || 0, // Initial dev buy amount
        "slippage": options.slippage || 10,
        "priorityFee": options.priorityFee || 0.00001,
        "pool": "pump"
      };

      let apiUrl = `${this.baseUrl}/trade-local`; // Use local for testing

      // If API key is provided, use lightning endpoint
      if (this.apiKey) {
        apiUrl = `${this.baseUrl}/trade?api-key=${this.apiKey}`;
      }

      console.log('Sending transaction to:', apiUrl);
      console.log('Transaction data:', JSON.stringify(transactionData, null, 2));

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transactionData)
      });

      const result = await response.json();

      console.log('API Response Status:', response.status);
      console.log('API Response:', JSON.stringify(result, null, 2));

      if (!response.ok) {
        throw new Error(`Token creation failed: ${JSON.stringify(result)}`);
      }

      // Check if we actually got a signature
      if (!result.signature) {
        throw new Error(`No transaction signature returned. Response: ${JSON.stringify(result)}`);
      }

      return {
        success: true,
        mint: mintKeypair.publicKey.toString(),
        signature: result.signature,
        metadataUri: metadataResult.metadataUri,
        transactionData: result
      };

    } catch (error) {
      console.error('Token creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mock function for testing without actual API calls
  async createTokenMock(tokenData, options = {}) {
    console.log(`[MOCK] Creating token: ${tokenData.name} (${tokenData.ticker})`);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mintKeypair = this.generateRandomKeypair();

    return {
      success: true,
      mint: mintKeypair.publicKey.toString(),
      signature: `mock_signature_${Date.now()}`,
      metadataUri: `https://ipfs.io/ipfs/mock_hash_${Date.now()}`,
      transactionData: {
        mock: true,
        timestamp: new Date().toISOString()
      }
    };
  }
}

export { PumpFunAPI };