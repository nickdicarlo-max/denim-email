import { BottomNav } from "@/components/nav/bottom-nav";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface pb-16">
      {children}
      <BottomNav />
    </div>
  );
}
