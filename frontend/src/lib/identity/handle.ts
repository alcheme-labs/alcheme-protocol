export function validateIdentityHandle(handle: string): string | null {
    const trimmed = String(handle || '').trim();

    if (trimmed.length < 3 || trimmed.length > 32) {
        return '身份 handle 需为 3-32 个字符。';
    }

    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
        return '身份 handle 仅支持字母、数字和下划线。';
    }

    if (/^[0-9]/.test(trimmed)) {
        return '身份 handle 不能以数字开头。';
    }

    if (trimmed.startsWith('_') || trimmed.endsWith('_')) {
        return '身份 handle 不能以下划线开头或结尾。';
    }

    if (trimmed.includes('__')) {
        return '身份 handle 不能包含连续下划线。';
    }

    return null;
}
