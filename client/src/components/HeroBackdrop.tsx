/* Decorative backdrop for the page hero banners (self-contained, no image) */
export default function HeroBackdrop() {
  return (
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-sandstone),transparent_55%),linear-gradient(120deg,var(--color-eucalyptus),var(--color-ocean))]" />
  );
}
