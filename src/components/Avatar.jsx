import { VerifiedBadge } from './VerifiedBadge.jsx';

export function Avatar({ user, size = 'h-12 w-12', showBadge = false }) {
  return (
    <div className={`relative shrink-0 ${size}`}>
      <img
        src={user.avatar}
        alt={user.fullUsername}
        className="h-full w-full rounded-full border border-white/20 object-cover"
      />
      {showBadge && user.verified && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-black">
          <VerifiedBadge className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
