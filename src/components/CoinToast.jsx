import { Coins } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export function CoinToast({ visible, amount = 2 }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ duration: 0.22 }}
          className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+18px)] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-coin/40 bg-black/82 px-4 py-2 text-sm font-bold text-coin shadow-glow backdrop-blur-xl"
        >
          <Coins className="h-4 w-4" />
          +{amount} Coins
        </motion.div>
      )}
    </AnimatePresence>
  );
}
