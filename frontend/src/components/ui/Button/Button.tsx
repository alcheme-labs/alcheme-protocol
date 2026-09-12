'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    fullWidth?: boolean;
    icon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            variant = 'primary',
            size = 'md',
            loading = false,
            fullWidth = false,
            disabled,
            icon,
            children,
            className = '',
            ...props
        },
        ref
    ) => {
        const classes = [
            styles.button,
            styles[variant],
            size !== 'md' ? styles[size] : '',
            disabled ? styles.disabled : '',
            loading ? styles.loading : '',
            fullWidth ? styles.fullWidth : '',
            className,
        ]
            .filter(Boolean)
            .join(' ');

        return (
            <button
                ref={ref}
                className={classes}
                disabled={disabled || loading}
                {...props}
            >
                {loading && <span className={styles.spinner} />}
                {!loading && icon}
                {children}
            </button>
        );
    }
);

Button.displayName = 'Button';

export default Button;
