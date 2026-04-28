import Link from 'next/link';

import { parseCrystalReferenceText } from '@/lib/crystal/referenceMarkerText';
import styles from './CrystalReferenceText.module.css';

interface CrystalReferenceTextProps {
    text: string;
}

export default function CrystalReferenceText({ text }: CrystalReferenceTextProps) {
    const tokens = parseCrystalReferenceText(text);
    if (tokens.length === 0) {
        return <span className={styles.root}>{text}</span>;
    }

    return (
        <span className={styles.root}>
            {tokens.map((token, index) => {
                if (token.type === 'text') {
                    return <span key={`text:${index}`}>{token.text}</span>;
                }
                const label = `@${token.title}`;
                if (!token.knowledgeId) {
                    return (
                        <span key={`crystal:${index}`} className={styles.plainReference}>
                            {label}
                        </span>
                    );
                }
                return (
                    <Link
                        key={`crystal:${index}:${token.knowledgeId}`}
                        href={`/knowledge/${encodeURIComponent(token.knowledgeId)}`}
                        className={styles.reference}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {label}
                    </Link>
                );
            })}
        </span>
    );
}
