import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchDraftReferenceLinks } from '../src/lib/drafts/referenceLinks.ts';

const clientSource = readFileSync(
    new URL('../src/lib/drafts/referenceLinks.ts', import.meta.url),
    'utf8',
);

test('shared draft reference client parses only valid rows from the dedicated route', async (t) => {
    const originalFetch = globalThis.fetch;
    const calls = [];

    globalThis.fetch = async (input, init) => {
        calls.push({ input: String(input), init });
        return {
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                referenceLinks: [
                    {
                        referenceId: 'ref-1',
                        draftPostId: 7,
                        draftVersion: 2,
                        sourceBlockId: 'paragraph:0',
                        crystalName: 'Onboarding Crystal',
                        crystalBlockAnchor: null,
                        status: 'parsed',
                    },
                    {
                        referenceId: '',
                        draftPostId: 7,
                        draftVersion: 2,
                        sourceBlockId: 'paragraph:1',
                        crystalName: 'Broken Crystal',
                        crystalBlockAnchor: null,
                        status: 'parsed',
                    },
                ],
            }),
        };
    };

    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const links = await fetchDraftReferenceLinks({ draftPostId: 7 });
    assert.equal(calls.length, 1);
    assert.match(calls[0].input, /\/api\/v1\/drafts\/7\/reference-links$/);
    assert.equal(calls[0].init?.credentials, 'include');
    assert.equal(calls[0].init?.cache, 'no-store');
    assert.deepEqual(links, [
        {
            referenceId: 'ref-1',
            draftPostId: 7,
            draftVersion: 2,
            sourceBlockId: 'paragraph:0',
            crystalName: 'Onboarding Crystal',
            crystalBlockAnchor: null,
            status: 'parsed',
        },
    ]);
});

test('shared draft reference client stays outside the circle-summary feature module', () => {
    assert.doesNotMatch(clientSource, /features\/circle-summary/);
    assert.match(clientSource, /pickDraftReferenceLinks/);
});
