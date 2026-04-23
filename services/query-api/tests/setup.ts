// Jest setup file
import { PrismaClient } from '@prisma/client';

// 保留外部注入的测试环境；仅在完全缺失时回退默认值。
process.env.DATABASE_URL =
    process.env.DATABASE_URL
    || process.env.TEST_DATABASE_URL
    || 'postgresql://test_user:test_pass@localhost:5432/test_db';
process.env.NODE_ENV = 'test';
process.env.REDIS_URL =
    process.env.REDIS_URL
    || process.env.TEST_REDIS_URL
    || 'redis://localhost:6379';

// 全局测试钩子
beforeAll(async () => {
    // 可以在这里初始化测试数据库连接
    console.log('🧪 Test suite starting...');
});

afterAll(async () => {
    // 清理
    console.log('✅ Test suite completed');
});

// 全局错误处理
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});
