import { BadgeCheck } from 'lucide-react';

export function VerifiedBadge({ className = 'h-4 w-4' }) {
  return <BadgeCheck className={`${className} fill-telegram text-white`} strokeWidth={2.3} />;
}
