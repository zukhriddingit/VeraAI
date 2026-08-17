import Link from "next/link";

export type SettingsSection = "integrations" | "availability" | "notifications" | "privacy";

const settingsLinks = [
  { section: "integrations", href: "/settings/integrations", label: "Integrations" },
  {
    section: "availability",
    href: "/settings/availability",
    label: "Viewing availability"
  },
  { section: "notifications", href: "/settings/notifications", label: "Notifications" },
  { section: "privacy", href: "/settings/privacy", label: "Privacy" }
] as const satisfies ReadonlyArray<{
  readonly section: SettingsSection;
  readonly href: string;
  readonly label: string;
}>;

export function SettingsNav({ current }: { readonly current: SettingsSection }) {
  return (
    <nav className="page-nav" aria-label="Vera settings navigation">
      <Link href="/">Listings</Link>
      {settingsLinks.map((link) => (
        <Link
          key={link.section}
          href={link.href}
          aria-current={link.section === current ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
