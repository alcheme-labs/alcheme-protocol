import { notFound } from 'next/navigation';

import { HostedAppFrame } from '@/features/hosted-app-runtime/HostedAppFrame';

interface HostedAppLaunchPageProps {
    params: Promise<{ appId?: string | string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HostedAppLaunchPage({
    params,
    searchParams,
}: HostedAppLaunchPageProps) {
    if (process.env.NODE_ENV !== 'development') {
        notFound();
    }

    const resolvedParams = await params;
    const resolvedSearchParams = await searchParams;
    const rawAppId = Array.isArray(resolvedParams.appId)
        ? resolvedParams.appId[0]
        : resolvedParams.appId;
    const appId = typeof rawAppId === 'string' ? decodeURIComponent(rawAppId) : '';
    if (!appId) notFound();

    const circleId = Number(readSingleParam(resolvedSearchParams.circleId) || 0);
    const releaseId = readSingleParam(resolvedSearchParams.releaseId) || 'dev-release';
    const manifestHash = readSingleParam(resolvedSearchParams.manifestHash) || 'sha256:dev-manifest';
    const bundleUrl = normalizeDevBundleUrl(readSingleParam(resolvedSearchParams.bundleUrl));

    return (
        <main style={{ minHeight: '100dvh', height: '100dvh' }}>
            <HostedAppFrame
                appId={appId}
                appName={appId}
                releaseId={releaseId}
                circleId={Number.isFinite(circleId) ? circleId : 0}
                manifestHash={manifestHash}
                bundleUrl={bundleUrl}
            />
        </main>
    );
}

function readSingleParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function normalizeDevBundleUrl(value: string | undefined): string {
    if (!value) return failHostedAppLaunch('hosted_app_origin_not_managed');
    const parsed = new URL(value, 'http://localhost');
    if (parsed.protocol === 'data:' || parsed.protocol === 'javascript:' || parsed.protocol === 'about:') {
        return failHostedAppLaunch('hosted_app_origin_not_managed');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return failHostedAppLaunch('hosted_app_origin_not_managed');
    }
    if (!parsed.hostname.endsWith('.apps.alchemeusercontent.local')) {
        return failHostedAppLaunch('hosted_app_origin_not_managed');
    }
    return parsed.toString();
}

function failHostedAppLaunch(_code: 'hosted_app_origin_not_managed'): never {
    notFound();
}
