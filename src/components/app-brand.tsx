type AppBrandProps = {
  href?: string;
  compact?: boolean;
};

function BrandContent({ compact }: Pick<AppBrandProps, "compact">) {
  return (
    <>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 17.5 9.2 6.8l3.1 6.1 2.2-3.5L19 17.5H5Z" />
          <circle cx="17.5" cy="5.5" r="2" />
        </svg>
      </span>
      <span className="brand-copy">
        <strong>여행 플래너</strong>
        {compact ? null : <small>나만의 여행을 한곳에</small>}
      </span>
    </>
  );
}

export function AppBrand({ href, compact = false }: AppBrandProps) {
  if (href) {
    return (
      <a className="brand" href={href} aria-label="여행 플래너 홈">
        <BrandContent compact={compact} />
      </a>
    );
  }

  return (
    <div className="brand" aria-label="여행 플래너">
      <BrandContent compact={compact} />
    </div>
  );
}
