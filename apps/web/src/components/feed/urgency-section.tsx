interface UrgencySectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
}

export function UrgencySection({ title, icon, children }: UrgencySectionProps) {
  return (
    <section className="px-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[20px] text-secondary">{icon}</span>
        <h2 className="font-serif text-lg font-bold text-primary tracking-wide">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
