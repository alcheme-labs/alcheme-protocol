import { createAlchemeApolloClient } from '@/lib/api/graphqlClient';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { GENERATE_ACCEPTED_ISSUE_REVISION } from '@/lib/apollo/queries';
import type {
    AcceptedIssueRevisionGenerateInput,
    AcceptedIssueRevisionJobResponse,
} from '@/lib/apollo/types';

function graphqlUrlFromBaseUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/graphql`;
}

export async function generateAcceptedIssueRevisionOnPrivateSidecar(
    input: AcceptedIssueRevisionGenerateInput,
): Promise<AcceptedIssueRevisionJobResponse['generateAcceptedIssueRevision']> {
    const route = await resolveNodeRoute('ghost_draft_private');
    const client = createAlchemeApolloClient(graphqlUrlFromBaseUrl(route.urlBase));
    const result = await client.mutate<
        AcceptedIssueRevisionJobResponse,
        { input: AcceptedIssueRevisionGenerateInput }
    >({
        mutation: GENERATE_ACCEPTED_ISSUE_REVISION,
        variables: { input },
        fetchPolicy: 'no-cache',
    });

    const payload = result.data?.generateAcceptedIssueRevision ?? null;
    if (!payload) {
        throw new Error('accepted_issue_revision_generate_failed');
    }
    return payload;
}
