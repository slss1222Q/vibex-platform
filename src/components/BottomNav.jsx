import { Home, PlusSquare, Search, UserRound, WalletCards } from 'lucide-react';
import { motion } from 'framer-motion';

const items = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'create', label: 'Create', icon: PlusSquare },
  { id: 'wallet', label: 'Wallet', icon: WalletCards },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

export function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/90 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className="relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-white/54 transition-colors data-[active=true]:text-white"
              data-active={active}
              aria-label={item.label}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-pill"
                  className="absolute inset-x-3 top-1 h-9 rounded-full bg-white/10"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative h-5 w-5" strokeWidth={active ? 2.7 : 2.2} />
              <span className="relative leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
