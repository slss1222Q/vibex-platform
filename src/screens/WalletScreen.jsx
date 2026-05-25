import { ArrowDownToLine, CalendarClock, CircleDollarSign, Coins, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScreenHeader } from '../components/ScreenHeader.jsx';

export function WalletScreen({ appState }) {
  const canWithdraw = appState.user.coins >= 200;
  const uzsValue = Math.floor((appState.user.coins / 200) * 20000);

  return (
    <section className="h-dvh overflow-y-auto bg-black safe-bottom hide-scrollbar">
      <ScreenHeader title="Wallet" subtitle="Watch-to-Earn balance" />

      <div className="px-5">
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-[8px] border border-coin/25 bg-[radial-gradient(circle_at_top_right,rgba(245,196,81,0.22),transparent_34%),#121212] p-5 shadow-glow"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/52">Available Coins</p>
              <h2 className="mt-2 text-5xl font-black tracking-normal text-white">
                {appState.user.coins.toLocaleString()}
              </h2>
            </div>
            <div className="grid h-16 w-16 place-items-center rounded-full bg-coin text-black">
              <Coins className="h-8 w-8" />
            </div>
          </div>
          <p className="mt-4 text-sm font-semibold text-coin">Estimated value: {uzsValue.toLocaleString()} UZS</p>
        </motion.div>

        <div className="mt-4 rounded-[8px] border border-white/10 bg-ink-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="h-4 w-4 text-telegram" />
            Rule Info
          </div>
          <div className="space-y-3 text-sm text-white/70">
            <Rule icon={Coins} text="1 Video = 2 Coins." />
            <Rule icon={CircleDollarSign} text="200 Coins = 20,000 UZS." />
            <Rule icon={CalendarClock} text="Automatic Payouts every 10 days." />
          </div>
        </div>

        <button
          type="button"
          disabled={!canWithdraw}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-white text-sm font-black text-black transition disabled:bg-white/10 disabled:text-white/32"
        >
          <ArrowDownToLine className="h-5 w-5" />
          {canWithdraw ? 'Withdraw 20,000 UZS' : `${200 - appState.user.coins} more coins to withdraw`}
        </button>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniStat label="Pending" value="0" />
          <MiniStat label="Next payout" value="10 days" />
        </div>
      </div>
    </section>
  );
}

function Rule({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-white/42" />
      <span>{text}</span>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-ink-800 p-4">
      <p className="text-xs text-white/42">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}
