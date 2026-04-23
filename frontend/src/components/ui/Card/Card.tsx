'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './Card.module.css';

export type CardState = 'ore' | 'alloy' | 'crystal';
export type AlloyHeatState = 'active' | 'cooling' | 'frozen';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    state?: CardState;
    heatState?: AlloyHeatState;
    selected?: boolean;
    ephemeral?: boolean;
    header?: ReactNode;
    footer?: ReactNode;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
    (
        {
            state = 'ore',
            heatState,
            selected = false,
            ephemeral = false,
            header,
            footer,
            children,
            className = '',
            ...props
        },
        ref
    ) => {
        const heatClass =
            state === 'alloy' && heatState
                ? heatState === 'active'
                    ? styles.alloyActive
                    : heatState === 'cooling'
                        ? styles.alloyCooling
                        : styles.alloyFrozen
                : '';

        const classes = [
            styles.card,
            styles[state],
            heatClass,
            selected ? styles.selected : '',
            ephemeral ? styles.ephemeral : '',
            className,
        ]
            .filter(Boolean)
            .join(' ');

        return (
            <div ref={ref} className={classes} {...props}>
                {header && <div className={styles.header}>{header}</div>}
                <div className={styles.content}>{children}</div>
                {footer && <div className={styles.footer}>{footer}</div>}
            </div>
        );
    }
);

Card.displayName = 'Card';

export default Card;
