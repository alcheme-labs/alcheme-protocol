import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { getPublicNodeGraphqlUrl } from '@/lib/api/nodeRouting';
import { authenticatedApiFetch } from '@/lib/api/fetch';

const GRAPHQL_ENDPOINT = getPublicNodeGraphqlUrl();

export function createAlchemeApolloClient(graphqlEndpoint: string = GRAPHQL_ENDPOINT): ApolloClient {
    const httpLink = new HttpLink({
        uri: graphqlEndpoint,
        fetch: (uri, options) => authenticatedApiFetch(uri, options),
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

    return new ApolloClient({
        link: httpLink,
        cache,
        defaultOptions: {
            watchQuery: {
                fetchPolicy: 'cache-and-network',
                nextFetchPolicy: 'cache-first',
            },
        },
    });
}

export const apolloClient = createAlchemeApolloClient();
