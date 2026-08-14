import { PublicDemo } from "./public-demo.tsx";
import { PUBLIC_DEMO_LISTINGS, PUBLIC_DEMO_PROFILE } from "./public-demo-fixtures.ts";

export const dynamic = "force-static";

export default function DemoPage() {
  return <PublicDemo listings={PUBLIC_DEMO_LISTINGS} profile={PUBLIC_DEMO_PROFILE} />;
}
