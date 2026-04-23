export type BrowserOnlyMockUnsupportedAction =
    | 'identity_registration'
    | 'create_circle'
    | 'join_circle'
    | 'leave_circle'
    | 'update_member_role'
    | 'remove_member';

export function getBrowserOnlyMockUnsupportedError(
    action: BrowserOnlyMockUnsupportedAction,
): string {
    switch (action) {
        case 'identity_registration':
            return '当前浏览器 mock 钱包模式不支持注册链上身份，请使用真实钱包手动验证该流程。';
        case 'create_circle':
            return '当前浏览器 mock 钱包模式不支持创建链上圈层，请使用真实钱包手动验证该流程。';
        case 'join_circle':
            return '当前浏览器 mock 钱包模式不支持完成链上成员确认，请使用真实钱包手动验证该流程。';
        case 'leave_circle':
            return '当前浏览器 mock 钱包模式不支持完成链上退圈确认，请使用真实钱包手动验证该流程。';
        case 'update_member_role':
            return '当前浏览器 mock 钱包模式不支持完成链上角色变更，请使用真实钱包手动验证该流程。';
        case 'remove_member':
            return '当前浏览器 mock 钱包模式不支持完成链上移除成员，请使用真实钱包手动验证该流程。';
        default:
            return '当前浏览器 mock 钱包模式不支持该链上操作，请使用真实钱包手动验证该流程。';
    }
}
