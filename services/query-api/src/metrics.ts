import client from 'prom-client';

// Create a Registry
export const register = new client.Registry();
const processWindowStartedAt = new Date().toISOString();

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

export interface GovernanceRuntimeMetricsReadback {
    schemaVersion: 1;
    scope: 'query_api_process_window';
    routeFamily: '/api/v1/governance';
    durability: 'process_memory_not_time_series';
    windowStartedAt: string;
    observedAt: string;
    requests: {
        total: number;
        successes: number;
        clientErrors: number;
        serverErrors: number;
    };
    latency: {
        sampleCount: number;
        averageMs: number;
        p95UpperBoundMs: number | null;
    };
    sloTarget: {
        status: 'not_configured';
    };
}

export async function readGovernanceRuntimeMetrics(): Promise<GovernanceRuntimeMetricsReadback> {
    const routeFamily = '/api/v1/governance' as const;
    const [counterMetric, durationMetric] = await Promise.all([
        httpRequestsTotal.get(),
        httpRequestDuration.get(),
    ]);
    const counterValues = counterMetric.values.filter(
        (value) => value.labels.route === routeFamily,
    );
    const durationValues = durationMetric.values.filter(
        (value) => value.labels.route === routeFamily,
    );
    const requestCount = counterValues.reduce((sum, value) => sum + value.value, 0);
    const statusCount = (prefix: string) => counterValues
        .filter((value) => String(value.labels.status ?? '').startsWith(prefix))
        .reduce((sum, value) => sum + value.value, 0);
    const sampleCount = durationValues
        .filter((value) => value.metricName === 'http_request_duration_seconds_count')
        .reduce((sum, value) => sum + value.value, 0);
    const durationSeconds = durationValues
        .filter((value) => value.metricName === 'http_request_duration_seconds_sum')
        .reduce((sum, value) => sum + value.value, 0);
    const bucketCounts = new Map<number, number>();
    for (const value of durationValues) {
        if (value.metricName !== 'http_request_duration_seconds_bucket') continue;
        const upperBound = Number((value.labels as Record<string, string | number>).le);
        if (!Number.isFinite(upperBound)) continue;
        bucketCounts.set(upperBound, (bucketCounts.get(upperBound) ?? 0) + value.value);
    }
    const p95Threshold = sampleCount * 0.95;
    const p95UpperBoundSeconds = [...bucketCounts.entries()]
        .sort(([left], [right]) => left - right)
        .find(([, count]) => count >= p95Threshold)?.[0] ?? null;
    return {
        schemaVersion: 1,
        scope: 'query_api_process_window',
        routeFamily,
        durability: 'process_memory_not_time_series',
        windowStartedAt: processWindowStartedAt,
        observedAt: new Date().toISOString(),
        requests: {
            total: requestCount,
            successes: statusCount('2') + statusCount('3'),
            clientErrors: statusCount('4'),
            serverErrors: statusCount('5'),
        },
        latency: {
            sampleCount,
            averageMs: sampleCount > 0 ? (durationSeconds * 1000) / sampleCount : 0,
            p95UpperBoundMs: p95UpperBoundSeconds === null ? null : p95UpperBoundSeconds * 1000,
        },
        sloTarget: {
            status: 'not_configured',
        },
    };
}

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
