export function BrandMark({ size = 30 }: { size?: number }) {
  return <img className="brand-mark" src="/logo-icon.png" alt="Ecom4all" style={{ width: size, height: size }} />;
}

export function BrandLogo({ height = 32 }: { height?: number }) {
  return (
    <span className="brand-logo">
      <img src="/logo-full.png" alt="Ecom4all" style={{ height }} />
    </span>
  );
}

export function BrandCredit() {
  return (
    <span className="credit-logo">
      <span className="ai">ai</span>
      <span className="four">4</span>
      <span className="work">work</span>
    </span>
  );
}
