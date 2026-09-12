'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { fetchProfileAvatarObjectUrl } from '@/lib/api/profileAvatar';

type ProfileAvatarProps = {
    handle?: string | null;
    avatarUri?: string | null;
    className?: string;
    alt?: string;
    fallback: ReactNode;
};

export default function ProfileAvatar({
    handle,
    avatarUri,
    className,
    alt = '',
    fallback,
}: ProfileAvatarProps) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const httpSrc = avatarUri && /^https?:\/\//i.test(avatarUri) ? avatarUri : null;

    useEffect(() => {
        if (httpSrc || !handle || !avatarUri) {
            setObjectUrl(null);
            return;
        }
        let cancelled = false;
        void fetchProfileAvatarObjectUrl(handle, avatarUri).then((url) => {
            if (!cancelled) {
                setObjectUrl(url);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [avatarUri, handle, httpSrc]);

    const src = httpSrc || objectUrl;
    if (!src) {
        return <>{fallback}</>;
    }

    return <img className={className} src={src} alt={alt} />;
}
