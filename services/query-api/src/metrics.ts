import client from 'prom-client';

// Create a Registry
export const register = new client.Registry();

// Add default metrics (process CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// ========== HTTP Request Metrics ==========
export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
});

export const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    registers: [register],
});

// ========== GraphQL Query Metrics ==========
export const graphqlQueriesTotal = new client.Counter({
    name: 'alcheme_graphql_queries_total',
    help: 'Total number of GraphQL queries',
    labelNames: ['operation_name', 'operation_type'],
    registers: [register],
});

export const graphqlQueryDuration = new client.Histogram({
    name: 'alcheme_graphql_query_duration_seconds',
    help: 'GraphQL query duration in seconds',
    labelNames: ['operation_name', 'operation_type'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
});

// ========== Database Metrics ==========
export const dbQueriesTotal = new client.Counter({
    name: 'alcheme_db_queries_total',
    help: 'Total number of database queries',
    labelNames: ['operation', 'table'],
    registers: [register],
});

export const dbQueryDuration = new client.Histogram({
    name: 'alcheme_db_query_duration_seconds',
    help: 'Database query duration in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register],
});

export const dbConnectionPoolSize = new client.Gauge({
    name: 'alcheme_db_connection_pool_size',
    help: 'Current database connection pool size',
    registers: [register],
});

// ========== Cache Metrics ==========
export const cacheHitsTotal = new client.Counter({
    name: 'alcheme_cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['cache_name'],
    registers: [register],
});

export const cacheMissesTotal = new client.Counter({
    name: 'alcheme_cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['cache_name'],
    registers: [register],
});

// ========== Custom Application Metrics ==========
export const activeUsers = new client.Gauge({
    name: 'alcheme_active_users',
    help: 'Number of currently active users',
    registers: [register],
});

// Helper functions for recording metrics
export const recordHttpRequest = (method: string, route: string, status: number, duration: number) => {
    httpRequestsTotal.inc({ method, route, status: status.toString() });
    httpRequestDuration.observe({ method, route, status: status.toString() }, duration);
};

export const recordGraphQLQuery = (operationName: string, operationType: string, duration: number) => {
    graphqlQueriesTotal.inc({ operation_name: operationName, operation_type: operationType });
    graphqlQueryDuration.observe({ operation_name: operationName, operation_type: operationType }, duration);
};

export const recordDbQuery = (operation: string, table: string, duration: number) => {
    dbQueriesTotal.inc({ operation, table });
    dbQueryDuration.observe({ operation, table }, duration);
};

export const recordCacheHit = (cacheName: string) => {
    cacheHitsTotal.inc({ cache_name: cacheName });
};

export const recordCacheMiss = (cacheName: string) => {
    cacheMissesTotal.inc({ cache_name: cacheName });
};
