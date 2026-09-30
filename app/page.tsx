import { CaptureBox } from '@/components/capture/CaptureBox';
import { RecentCaptures } from '@/components/capture/RecentCaptures';

export default function CapturePage() {
  return (
    <div className="mx-auto max-w-xl">
      <CaptureBox />
      <RecentCaptures />
    </div>
  );
}
