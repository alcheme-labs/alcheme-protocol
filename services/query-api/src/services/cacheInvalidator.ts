import Redis from 'ioredis';

export class CacheInvalidator {
    private subscriber: Redis;
    private redis: Redis;

    constructor(redisClient: Redis) {
        this.redis = redisClient;
        // Create a new connection for subscription
        this.subscriber = redisClient.duplicate();
    }

    public async start() {
        // Subscribe to the channel
        this.subscriber.subscribe('cache:invalidation', (err) => {
            if (err) {
                console.error('❌ Failed to subscribe to cache invalidation channel:', err);
                return;
            }
            console.log('✅ Listening for cache invalidation events');
        });

        // Handle messages
        this.subscriber.on('message', async (channel, message) => {
            if (channel === 'cache:invalidation') {
                await this.handleInvalidation(message);
            }
        });
    }

    private async handleInvalidation(message: string) {
        try {
            const event = JSON.parse(message);
            if (event.type === 'invalidation' && event.key) {
                await this.redis.del(event.key);
                console.log(`🧹 Cache invalidated: ${event.key}`);
            }
        } catch (error) {
            console.error('Failed to process invalidation message:', error);
        }
    }

    public async stop() {
        await this.subscriber.quit();
    }
}
