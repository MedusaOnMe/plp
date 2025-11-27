import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PersistentQueue {
  constructor(queueName = 'verification-queue') {
    this.queueFile = join(__dirname, `${queueName}.json`);
    this.queue = [];
    this.processing = false;
    this.processInterval = null;
    this.loadQueue();
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[PersistentQueue ${timestamp}] ${message}`);
  }

  loadQueue() {
    try {
      if (existsSync(this.queueFile)) {
        const fileContent = readFileSync(this.queueFile, 'utf8');
        this.queue = JSON.parse(fileContent);
        this.log(`✅ Loaded ${this.queue.length} items from queue file`);
      } else {
        this.queue = [];
        this.saveQueue();
        this.log('📝 Created new queue file');
      }
    } catch (error) {
      this.log(`❌ Error loading queue: ${error.message}`);
      this.queue = [];
      this.saveQueue();
    }
  }

  saveQueue() {
    try {
      writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      this.log(`❌ Error saving queue: ${error.message}`);
    }
  }

  add(item) {
    const queueItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      data: item,
      addedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3,
      lastAttempt: null,
      status: 'pending' // pending, processing, completed, failed
    };

    this.queue.push(queueItem);
    this.saveQueue();

    this.log(`📥 Added item to queue: ${queueItem.id} (Queue size: ${this.queue.length})`);

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return queueItem.id;
  }

  remove(itemId) {
    const index = this.queue.findIndex(item => item.id === itemId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.saveQueue();
      this.log(`🗑️ Removed item from queue: ${itemId}`);
      return true;
    }
    return false;
  }

  markCompleted(itemId) {
    const item = this.queue.find(item => item.id === itemId);
    if (item) {
      item.status = 'completed';
      item.completedAt = new Date().toISOString();
      this.saveQueue();
      this.log(`✅ Marked item as completed: ${itemId}`);
      return true;
    }
    return false;
  }

  markFailed(itemId, error) {
    const item = this.queue.find(item => item.id === itemId);
    if (item) {
      item.attempts++;
      item.lastAttempt = new Date().toISOString();
      item.lastError = error;

      if (item.attempts >= item.maxAttempts) {
        item.status = 'failed';
        this.log(`❌ Item failed permanently: ${itemId} (${item.attempts}/${item.maxAttempts} attempts)`);
      } else {
        item.status = 'pending';
        this.log(`⚠️ Item failed, will retry: ${itemId} (${item.attempts}/${item.maxAttempts} attempts)`);
      }

      this.saveQueue();
      return item.status !== 'failed';
    }
    return false;
  }

  getNext() {
    // Find next pending item
    const nextItem = this.queue.find(item =>
      item.status === 'pending' &&
      item.attempts < item.maxAttempts
    );

    if (nextItem) {
      nextItem.status = 'processing';
      nextItem.lastAttempt = new Date().toISOString();
      this.saveQueue();
      return nextItem;
    }

    return null;
  }

  startProcessing() {
    if (this.processing) return;

    this.processing = true;
    this.log('🚀 Starting queue processor');

    // Process one item per second
    this.processInterval = setInterval(() => {
      this.processNext();
    }, 1000);

    // Clean up completed items every 5 minutes
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  stopProcessing() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    this.processing = false;
    this.log('🛑 Stopped queue processor');
  }

  async processNext() {
    const item = this.getNext();
    if (!item) {
      return; // No items to process
    }

    this.log(`🔄 Processing item: ${item.id}`);

    try {
      // Call the processor function if set
      if (this.processor) {
        const result = await this.processor(item.data);
        if (result && result.success) {
          this.markCompleted(item.id);
        } else {
          this.markFailed(item.id, result ? result.error : 'Unknown error');
        }
      } else {
        this.log(`⚠️ No processor function set for item: ${item.id}`);
        this.markFailed(item.id, 'No processor function set');
      }
    } catch (error) {
      this.log(`❌ Error processing item ${item.id}: ${error.message}`);
      this.markFailed(item.id, error.message);
    }
  }

  setProcessor(processorFunction) {
    this.processor = processorFunction;
    this.log('🔧 Queue processor function set');
  }

  cleanup() {
    const before = this.queue.length;

    // Remove completed items older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    this.queue = this.queue.filter(item => {
      if (item.status === 'completed' && item.completedAt) {
        const completedAt = new Date(item.completedAt);
        return completedAt > oneHourAgo;
      }
      return true;
    });

    const after = this.queue.length;
    if (before !== after) {
      this.saveQueue();
      this.log(`🧹 Cleanup: Removed ${before - after} completed items`);
    }
  }

  getStats() {
    const stats = {
      total: this.queue.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const item of this.queue) {
      stats[item.status]++;
    }

    return stats;
  }

  getPendingCount() {
    return this.queue.filter(item =>
      item.status === 'pending' &&
      item.attempts < item.maxAttempts
    ).length;
  }
}

export { PersistentQueue };