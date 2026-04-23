import jwt from 'jsonwebtoken';
import { describe, expect, test } from '@jest/globals';

import { generateToken } from '../src/middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

describe('legacy login JWT claims', () => {
    test('generates legacy login tokens with explicit typ and aud claims', () => {
        const token = generateToken('11111111111111111111111111111111', '42');
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

        expect(decoded.typ).toBe('legacy_login');
        expect(decoded.aud).toBe('query_api');
        expect(decoded.publicKey).toBe('11111111111111111111111111111111');
        expect(decoded.userId).toBe('42');
    });

    test('plain JWTs without legacy typ and aud are distinguishable from accepted legacy login tokens', () => {
        const token = jwt.sign(
            {
                publicKey: '11111111111111111111111111111111',
                userId: '42',
            },
            JWT_SECRET,
            { expiresIn: '7d' },
        );
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

        expect(decoded.typ).not.toBe('legacy_login');
        expect(decoded.aud).not.toBe('query_api');
    });
});
