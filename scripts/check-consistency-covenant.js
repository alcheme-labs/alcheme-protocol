#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function read(relPath) {
    const fullPath = path.join(ROOT, relPath);
    return fs.readFileSync(fullPath, 'utf8');
}

function fail(message) {
    failures.push(message);
}

const failures = [];

function assertForbidden(relPath, patterns, title) {
    const content = read(relPath);
    for (const pattern of patterns) {
        if (pattern.test(content)) {
            fail(`${title}: found forbidden pattern ${pattern} in ${relPath}`);
        }
    }
}

function assertRequired(relPath, patterns, title) {
    const content = read(relPath);
    for (const pattern of patterns) {
        if (!pattern.test(content)) {
            fail(`${title}: missing required pattern ${pattern} in ${relPath}`);
        }
    }
}

// 1) query-api schema must not expose chain-authoritative write mutations.
assertForbidden(
    'services/query-api/src/graphql/schema.ts',
    [/createPost\s*\(/, /deletePost\s*\(/, /joinCircle\s*\(/, /leaveCircle\s*\(/],
    'Schema Contract',
);

// 2) query-api resolvers must not implement those removed mutations.
assertForbidden(
    'services/query-api/src/graphql/resolvers.ts',
    [/async\s+createPost\s*\(/, /async\s+deletePost\s*\(/, /async\s+joinCircle\s*\(/, /async\s+leaveCircle\s*\(/],
    'Resolver Contract',
);

// 3) frontend GraphQL layer must not expose removed mutation constants.
assertForbidden(
    'frontend/src/lib/apollo/queries.ts',
    [/export\s+const\s+CREATE_POST\b/, /export\s+const\s+DELETE_POST\b/, /export\s+const\s+JOIN_CIRCLE\b/, /export\s+const\s+LEAVE_CIRCLE\b/],
    'Frontend Query Contract',
);

// 4) write hooks must perform read-your-writes sync wait.
assertRequired(
    'frontend/src/hooks/useCreateContent.ts',
    [/waitForSignatureSlot\s*\(/, /waitForIndexedSlot\s*\(/],
    'CreateContent Hook Contract',
);
assertRequired(
    'frontend/src/hooks/useCreateCircle.ts',
    [/waitForSignatureSlot\s*\(/, /waitForIndexedSlot\s*\(/],
    'CreateCircle Hook Contract',
);
assertRequired(
    'frontend/src/hooks/useDeleteContent.ts',
    [/waitForSignatureSlot\s*\(/, /waitForIndexedSlot\s*\(/],
    'DeleteContent Hook Contract',
);

// 5) query-api must expose consistency status endpoint and headers.
assertRequired(
    'services/query-api/src/app.ts',
    [/\/sync\/status/, /X-Alcheme-Indexed-Slot/, /X-Alcheme-Read-Commitment/],
    'Query API Consistency Contract',
);

// 6) SDK main entry should not re-export optional storage adapters by default.
assertForbidden(
    'sdk/src/index.ts',
    [/utils\/storage/],
    'SDK Export Contract',
);

if (failures.length > 0) {
    console.error('Consistency covenant check failed:');
    for (const item of failures) {
        console.error(`- ${item}`);
    }
    process.exit(1);
}

console.log('Consistency covenant check passed.');
