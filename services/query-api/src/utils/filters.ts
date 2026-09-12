export const verifiedUserFilter = {
    author: {
        verificationLevel: { gt: 0 }
    }
};

export enum FeedFilter {
    ALL = 'ALL',
    VERIFIED_ONLY = 'VERIFIED_ONLY',
    HIGH_QUALITY = 'HIGH_QUALITY'
}
