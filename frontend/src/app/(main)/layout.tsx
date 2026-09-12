import { BottomNav } from '@/components/layout/BottomNav';

export default function MainLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <main className="screen-with-nav">{children}</main>
            <BottomNav />
        </>
    );
}
