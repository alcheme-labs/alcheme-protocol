import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { getPublicNodeGraphqlUrl } from '@/lib/api/nodeRouting';
import { withRequestLocaleHeaders } from '@/lib/api/fetch';

const GRAPHQL_ENDPOINT = getPublicNodeGraphqlUrl();

const httpLink = new HttpLink({
    uri: GRAPHQL_ENDPOINT,
    credentials: 'include',
    fetch: (uri, options) => {
        return fetch(uri, {
            ...options,
            headers: withRequestLocaleHeaders(options?.headers),
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
                    merge(_existing = [], incoming) {
                        return incoming;
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
