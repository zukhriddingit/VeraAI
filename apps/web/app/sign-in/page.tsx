import { SignInButton } from "./sign-in-button";

export default function SignInPage() {
  return (
    <main className="cockpit-main">
      <header className="cockpit-hero">
        <p className="eyebrow">Vera · renter-controlled search</p>
        <h1>Find fast. Rent safely.</h1>
        <p className="lede">
          Sign in to access your private search profiles, listings, jobs, and activity history. Vera
          requests identity scopes only here; Gmail and Calendar permissions are separate and are
          never requested during sign-in.
        </p>
        <SignInButton />
      </header>
    </main>
  );
}
