import fs from 'fs';
import path from 'path';

import { describe, expect, test } from '@jest/globals';

type IdlTypeEntry = {
    name: string;
    type?: unknown;
    docs?: unknown;
};

function pickRegistryTypes(filePath: string) {
    const idl = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        types?: IdlTypeEntry[];
    };

    const wanted = new Set([
        'ExtensionRegistryAccount',
        'ExtensionRegistry',
        'AuthorizedCaller',
        'CpiPermission',
    ]);

    return (idl.types || [])
        .filter((entry) => wanted.has(entry.name))
        .map((entry) => ({
            name: entry.name,
            type: entry.type,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

describe('registry_factory idl sync', () => {
    test('sdk and target idls stay aligned for extension registry types', () => {
        const sdkIdlTypes = pickRegistryTypes(
            path.resolve(__dirname, '../../../sdk/src/idl/registry_factory.json')
        );
        const targetIdlTypes = pickRegistryTypes(
            path.resolve(__dirname, '../../../target/idl/registry_factory.json')
        );

        expect(sdkIdlTypes).toEqual(targetIdlTypes);
    });

    test('query-api ships a registry_factory idl copy aligned with sdk types', () => {
        const queryApiIdlPath = path.resolve(
            __dirname,
            '../src/idl/registry_factory.json'
        );

        expect(fs.existsSync(queryApiIdlPath)).toBe(true);

        const sdkIdlTypes = pickRegistryTypes(
            path.resolve(__dirname, '../../../sdk/src/idl/registry_factory.json')
        );
        const queryApiIdlTypes = pickRegistryTypes(queryApiIdlPath);

        expect(queryApiIdlTypes).toEqual(sdkIdlTypes);
    });
});
