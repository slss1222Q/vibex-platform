import { Clapperboard, Hash, Music2, UploadCloud } from 'lucide-react';
import { ScreenHeader } from '../components/ScreenHeader.jsx';

export function CreateScreen() {
  return (
    <section className="h-dvh overflow-y-auto bg-black safe-bottom hide-scrollbar">
      <ScreenHeader title="Create" subtitle="Upload video layout" />

      <div className="px-5">
        <div className="grid aspect-[9/13] place-items-center rounded-[8px] border border-dashed border-white/20 bg-ink-800">
          <div className="text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white text-black">
              <UploadCloud className="h-8 w-8" />
            </div>
            <p className="mt-4 text-base font-black">Upload vertical video</p>
            <p className="mt-1 text-sm text-white/42">Max 60 seconds</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Field icon={Clapperboard} label="Caption" value="Write a short caption" />
          <Field icon={Hash} label="Hashtags" value="#flixcoin #watchtoearn" />
          <Field icon={Music2} label="Music" value="Original audio" />
        </div>

        <button
          type="button"
          className="mt-5 h-14 w-full rounded-[8px] bg-white text-sm font-black text-black"
        >
          Publish Preview
        </button>
      </div>
    </section>
  );
}

function Field({ icon: Icon, label, value }) {
  return (
    <button
      type="button"
      className="flex h-14 w-full items-center gap-3 rounded-[8px] border border-white/10 bg-ink-800 px-4 text-left"
    >
      <Icon className="h-5 w-5 text-white/42" />
      <div>
        <p className="text-xs text-white/42">{label}</p>
        <p className="text-sm font-bold">{value}</p>
      </div>
    </button>
  );
}
