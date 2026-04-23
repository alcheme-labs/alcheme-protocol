'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

/**
 * Landing / Splash Page
 *
 * 移动端设计最终版 §9:
 * "一个简洁淡雅的启动界面：Alcheme 的标志和一句贴心的标语，缓缓淡入视野。
 *  整个启动过程控制在 2 秒左右，随后自然过渡到主界面。"
 */
export default function LandingPage() {
  const router = useRouter();
  const t = useI18n('LandingPage');
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter');

  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase('hold'), 600);
    const exitTimer = setTimeout(() => setPhase('exit'), 2200);
    const navTimer = setTimeout(() => router.push('/home'), 2800);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(exitTimer);
      clearTimeout(navTimer);
    };
  }, [router]);

  return (
    <div className={styles.landing}>

      <AnimatePresence>
        {phase !== 'exit' && (
          <motion.div
            className={styles.center}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              duration: 0.8,
              ease: [0.2, 0.8, 0.2, 1],
            }}
          >
            {/* Logo Mark */}
            <div className={styles.logoMark}>
              <svg
                width="56"
                height="56"
                viewBox="0 0 56 56"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M28 4L8 18v20l20 14 20-14V18L28 4z"
                  stroke="var(--color-accent-gold)"
                  strokeWidth="1.5"
                  fill="none"
                  opacity="0.8"
                />
                <path
                  d="M28 12L14 22v12l14 10 14-10V22L28 12z"
                  stroke="var(--color-accent-ivory-glow)"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.5"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="4"
                  fill="var(--color-accent-gold)"
                  opacity="0.9"
                />
              </svg>
            </div>

            {/* Wordmark */}
            <h1 className={styles.wordmark}>Alcheme</h1>

            {/* Tagline */}
            <motion.p
              className={styles.tagline}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              {t('tagline')}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
