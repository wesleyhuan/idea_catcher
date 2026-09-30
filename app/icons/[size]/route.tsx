import { ImageResponse } from 'next/og';
import { IconArt } from '@/components/IconArt';

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === '512' ? 512 : 192;
  return new ImageResponse(<IconArt size={size} />, { width: size, height: size });
}
