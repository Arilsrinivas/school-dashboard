interface EduConnectBrandProps {
  className?: string;
  inverse?: boolean;
  compact?: boolean;
}

export default function EduConnectBrand({ className = '', inverse = false, compact = false }: EduConnectBrandProps) {
  return (
    <span className={`brand educonnect-brand${inverse ? ' inverse' : ''}${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}>
      <img className="brand-mark" src="/brand/educonnect-mark.svg" alt="" aria-hidden="true" />
      <span className="brand-copy">
        <strong>EduConnect</strong>
        <small>Powered by CalmStacks</small>
      </span>
    </span>
  );
}
