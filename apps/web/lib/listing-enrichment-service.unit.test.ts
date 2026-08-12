import { describe, expect, it, vi } from "vitest";

import type { UserRepositories } from "@vera/db";
import type {
  ListingEnrichmentRecord,
  ListingSourceRecord,
  RawListing,
  SearchProfile
} from "@vera/domain";

import {
  processEnrichment,
  resolveEnrichmentProfile,
  type ListingEnrichmentDependencies
} from "./listing-enrichment-service.ts";

function sourceRecord(rawListingId = "raw-listing-1"): ListingSourceRecord {
  return { rawListingId } as ListingSourceRecord;
}

function profile(id: string): SearchProfile {
  return { id } as SearchProfile;
}

function repositories(input: {
  readonly captureMetadata: RawListing["captureMetadata"];
  readonly profiles: readonly SearchProfile[];
}): Pick<UserRepositories, "rawListings" | "searchProfiles"> {
  return {
    rawListings: {
      getById: vi.fn(async () => ({ captureMetadata: input.captureMetadata }) as RawListing)
    } as Pick<UserRepositories["rawListings"], "getById"> as UserRepositories["rawListings"],
    searchProfiles: {
      getById: vi.fn(
        async (id: string) => input.profiles.find((candidate) => candidate.id === id) ?? null
      ),
      list: vi.fn(async () => input.profiles)
    } as Pick<
      UserRepositories["searchProfiles"],
      "getById" | "list"
    > as UserRepositories["searchProfiles"]
  };
}

describe("listing enrichment profile resolution", () => {
  it("uses persisted capture provenance when several profile versions exist", async () => {
    const older = profile("profile-boston-v1");
    const selected = profile("profile-boston-v2");
    const fixture = repositories({
      captureMetadata: { searchProfileId: selected.id },
      profiles: [older, selected]
    });

    await expect(resolveEnrichmentProfile(sourceRecord(), fixture)).resolves.toBe(selected);
    expect(fixture.searchProfiles.getById).toHaveBeenCalledWith(selected.id);
    expect(fixture.searchProfiles.list).not.toHaveBeenCalled();
  });

  it("uses the sole profile for a legacy capture without profile provenance", async () => {
    const only = profile("profile-only");
    const fixture = repositories({ captureMetadata: {}, profiles: [only] });

    await expect(resolveEnrichmentProfile(sourceRecord(), fixture)).resolves.toBe(only);
  });

  it.each([
    { captureMetadata: {}, description: "missing provenance" },
    {
      captureMetadata: { searchProfileId: "invalid profile id" },
      description: "invalid provenance"
    },
    { captureMetadata: { searchProfileId: "profile-deleted" }, description: "deleted profile" }
  ])("fails closed for $description when the profile is not exact", async ({ captureMetadata }) => {
    const fixture = repositories({
      captureMetadata,
      profiles: [profile("profile-boston-v1"), profile("profile-boston-v2")]
    });

    await expect(resolveEnrichmentProfile(sourceRecord(), fixture)).rejects.toThrow(
      "enrichment_profile_unavailable"
    );
  });

  it("fails the durable lease instead of leaving enrichment stuck when provenance is ambiguous", async () => {
    const fail = vi.fn(async (input: unknown) => input);
    const append = vi.fn(async (input: unknown) => input);
    const run = vi.fn();
    const record = {
      id: "source-record-1",
      rawListingId: "raw-listing-1",
      source: "zillow",
      sourceUrl: "https://www.zillow.com/homedetails/observed-listing/"
    } as ListingSourceRecord;
    const dependencies = {
      userId: "founder-user",
      repositories: {
        sourceRecords: { getById: vi.fn(async () => record) },
        rawListings: {
          getById: vi.fn(async () => ({ captureMetadata: {} }) as RawListing)
        },
        searchProfiles: {
          getById: vi.fn(async () => null),
          list: vi.fn(async () => [profile("profile-v1"), profile("profile-v2")])
        },
        listingEnrichments: { fail },
        activityEvents: { append }
      } as unknown as UserRepositories,
      repositoryProvider: {} as ListingEnrichmentDependencies["repositoryProvider"],
      browserResearch: { run },
      founderUserId: "founder-user",
      browserDisabled: false,
      enabledSources: new Set(["zillow"]),
      planSigningKey: "a".repeat(32),
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      createId: () => "generated-id"
    } as ListingEnrichmentDependencies;

    await processEnrichment(
      {
        listingSourceRecordId: record.id,
        leaseOwner: "enrichment-lease"
      } as ListingEnrichmentRecord,
      dependencies
    );

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        listingSourceRecordId: record.id,
        leaseOwner: "enrichment-lease",
        errorCode: "enrichment_profile_unavailable",
        retryable: false
      })
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "listing.enrichment_failed", targetId: record.id })
    );
    expect(run).not.toHaveBeenCalled();
  });
});
