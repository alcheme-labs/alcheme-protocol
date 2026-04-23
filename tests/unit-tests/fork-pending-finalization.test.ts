import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'mocha';

import {
  clearPendingForkFinalization,
  readPendingForkFinalization,
  writePendingForkFinalization,
} from '../../frontend/src/features/fork-lineage/pendingFinalization';

describe('fork pending finalization storage', () => {
  const originalWindow = (globalThis as Record<string, unknown>).window;
  let storage = new Map<string, string>();

  beforeEach(() => {
    storage = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem(key: string) {
          return storage.has(key) ? storage.get(key)! : null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        removeItem(key: string) {
          storage.delete(key);
        },
      },
    };
  });

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as Record<string, unknown>).window;
      return;
    }
    (globalThis as Record<string, unknown>).window = originalWindow;
  });

  it('round-trips pending fork finalization by source circle id', () => {
    const pending = {
      sourceCircleId: 7,
      declarationId: 'fork-7-abc',
      declarationText: 'We need a different governance path.',
      targetCircleId: 71,
      executionAnchorDigest: 'd'.repeat(64),
      originAnchorRef: 'circle:7',
      inheritanceSnapshot: {
        sourceCircleName: 'Circle Seven',
      },
    };

    writePendingForkFinalization(pending);

    assert.deepEqual(readPendingForkFinalization(7), pending);

    clearPendingForkFinalization(7);
    assert.equal(readPendingForkFinalization(7), null);
  });

  it('drops malformed persisted payloads instead of reviving broken recovery state', () => {
    storage.set(
      'alcheme_pending_fork_finalization:9',
      JSON.stringify({
        sourceCircleId: 9,
        declarationId: 'fork-9-bad',
      }),
    );

    assert.equal(readPendingForkFinalization(9), null);
    assert.equal(storage.has('alcheme_pending_fork_finalization:9'), false);
  });
});
