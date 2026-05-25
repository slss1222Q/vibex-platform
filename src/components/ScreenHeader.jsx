export function ScreenHeader({ title, subtitle, right }) {
  return (
    <header className="flex items-center justify-between px-5 pb-4 pt-[calc(env(safe-area-inset-top)+18px)]">
      <div>
        <h1 className="text-2xl font-black tracking-normal text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
