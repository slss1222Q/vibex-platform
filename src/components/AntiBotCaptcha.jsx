import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, Sparkle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function AntiBotCaptcha({ open, onPass, onFail }) {
  const [seconds, setSeconds] = useState(3);
  const [passed, setPassed] = useState(false);

  const target = useMemo(
    () => ({
      x: Math.round(24 + Math.random() * 180),
      y: Math.round(54 + Math.random() * 130),
    }),
    [open],
  );

  useEffect(() => {
    if (!open) return undefined;
    setSeconds(3);
    setPassed(false);

    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          onFail();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [open, onFail]);

  function handlePass() {
    setPassed(true);
    window.setTimeout(onPass, 380);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/72 px-5 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            className="w-full max-w-[340px] rounded-[8px] border border-white/12 bg-ink-800 p-5 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-telegram/15 text-telegram">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold">Anti-Bot Check</h2>
                <p className="text-xs text-white/50">Tap the moving star in {seconds}s</p>
              </div>
            </div>

            <div className="relative mt-5 h-56 overflow-hidden rounded-[8px] border border-white/10 bg-black">
              <motion.button
                type="button"
                aria-label="Moving star captcha target"
                onClick={handlePass}
                className="absolute grid h-12 w-12 place-items-center rounded-full bg-coin text-black shadow-glow"
                initial={{ x: target.x, y: target.y }}
                animate={{
                  x: [target.x, 210 - target.x / 3, 34 + target.x / 2, target.x],
                  y: [target.y, 24 + target.y / 2, 168 - target.y / 4, target.y],
                  rotate: [0, 30, -22, 0],
                }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkle className="h-6 w-6 fill-black" />
              </motion.button>

              {passed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 grid place-items-center bg-black/70 text-sm font-bold text-coin"
                >
                  Verified
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
