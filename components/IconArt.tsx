export function IconArt({ size }: { size: number }) {
  return (
    <div style={{
      width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f59e0b', color: 'white', fontSize: size * 0.45, fontWeight: 700,
    }}>
      IC
    </div>
  );
}
