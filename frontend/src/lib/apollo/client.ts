import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { getPublicNodeGraphqlUrl } from '@/lib/config/nodeRouting';
import {
    DEFAULT_LOCALE,
    isSupportedLocale,
    LOCALE_COOKIE_NAME,
    REQUEST_LOCALE_HEADER,
} from '@/i18n/config';

const GRAPHQL_ENDPOINT = getPublicNodeGraphqlUrl();

function readLocaleCookie(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]+)`));
    if (!match?.[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

function resolveGraphqlLocale(): string {
    if (typeof document !== 'undefined') {
        const htmlLang = document.documentElement.lang?.trim().toLowerCase().split(/[-_]/)[0];
        if (htmlLang && isSupportedLocale(htmlLang)) {
            return htmlLang;
        }

        const cookieLocale = readLocaleCookie()?.trim().toLowerCase().split(/[-_]/)[0];
        if (cookieLocale && isSupportedLocale(cookieLocale)) {
            return cookieLocale;
        }
    }

    return DEFAULT_LOCALE;
}

const httpLink = new HttpLink({
    uri: GRAPHQL_ENDPOINT,
    credentials: 'include',
    fetch: (uri, options) => {
        const headers = new Headers(options?.headers);
        headers.set(REQUEST_LOCALE_HEADER, resolveGraphqlLocale());
        return fetch(uri, {
            ...options,
            headers,
        });
    },
});

const cache = new InMemoryCache({
    typePolicies: {
        Query: {
            fields: {
                feed: {
                    keyArgs: ['filter'],
                    merge(existing = [], incoming) {
                        return [...existing, ...incoming];
                    },
                },
            },
        },
        Circle: {
            fields: {
                posts: {
                    keyArgs: false,
                    merge(existing = [], incoming) {
                        return [...existing, ...incoming];
                    },
                },
            },
        },
    },
});

export const apolloClient = new ApolloClient({
    link: httpLink,
    cache,
    defaultOptions: {
        watchQuery: {
            fetchPolicy: 'cache-and-network',
            nextFetchPolicy: 'cache-first',
        },
    },
});
