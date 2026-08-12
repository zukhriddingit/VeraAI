import { describe, expect, it } from "vitest";

import {
  BOSTON_CRAIGSLIST_CONFIGURATION,
  BU_OFF_CAMPUS_CONFIGURATION,
  HousingSourceConfigurationSchema,
  SelectedHousingSourceConfigurationSchema
} from "./housing-source.ts";

describe("housing-source configuration", () => {
  it("pins BU Off-Campus to the reviewed portal without university-specific code", () => {
    expect(BU_OFF_CAMPUS_CONFIGURATION).toEqual({
      sourceId: "bu_off_campus",
      displayName: "BU Off-Campus Housing",
      adapterKind: "offcampus_partners",
      startingUrl: "https://offcampus.bu.edu/housing",
      allowedDomain: "offcampus.bu.edu",
      loginRequired: "unknown",
      defaultInclude: false
    });

    expect(
      HousingSourceConfigurationSchema.parse({
        ...BU_OFF_CAMPUS_CONFIGURATION,
        sourceId: "another_off_campus",
        displayName: "Another Off-Campus Portal",
        startingUrl: "https://housing.example.edu/search",
        allowedDomain: "housing.example.edu"
      })
    ).toMatchObject({
      adapterKind: "offcampus_partners",
      allowedDomain: "housing.example.edu"
    });
  });

  it("requires exact HTTPS start-domain alignment and reviewed Craigslist housing paths", () => {
    expect(() =>
      HousingSourceConfigurationSchema.parse({
        sourceId: "unsafe",
        displayName: "Unsafe",
        adapterKind: "generic",
        startingUrl: "https://housing.example.org/search",
        allowedDomain: "evil.example.org",
        loginRequired: "no",
        defaultInclude: false
      })
    ).toThrow(/exact allowed domain/iu);

    expect(() =>
      HousingSourceConfigurationSchema.parse({
        sourceId: "craigslist",
        displayName: "Craigslist",
        adapterKind: "craigslist",
        startingUrl: "https://boston.craigslist.org/about/help",
        allowedDomain: "boston.craigslist.org",
        loginRequired: "no",
        defaultInclude: false
      })
    ).toThrow(/housing search surface/iu);
  });

  it("pins Craigslist to the observed Boston-area route after the regional redirect", () => {
    expect(BOSTON_CRAIGSLIST_CONFIGURATION).toEqual({
      sourceId: "craigslist",
      displayName: "Craigslist",
      adapterKind: "craigslist",
      startingUrl: "https://www.craigslist.org/search/area/boston?cat=apa",
      allowedDomain: "www.craigslist.org",
      loginRequired: "no",
      defaultInclude: false
    });

    expect(() =>
      HousingSourceConfigurationSchema.parse({
        ...BOSTON_CRAIGSLIST_CONFIGURATION,
        startingUrl: "https://www.craigslist.org/search/area/newyork?cat=apa"
      })
    ).toThrow(/Boston housing search surface/iu);
    expect(() =>
      SelectedHousingSourceConfigurationSchema.parse({
        ...BOSTON_CRAIGSLIST_CONFIGURATION,
        source: "craigslist",
        startingUrl: "https://www.craigslist.org/search/area/boston?cat=sss",
        captureCurrentPage: false
      })
    ).toThrow(/cannot be widened/iu);
  });

  it("does not let a request widen the built-in BU configuration", () => {
    expect(() =>
      SelectedHousingSourceConfigurationSchema.parse({
        ...BU_OFF_CAMPUS_CONFIGURATION,
        source: "bu_off_campus",
        startingUrl: "https://offcampus.bu.edu/account",
        captureCurrentPage: false
      })
    ).toThrow(/cannot be widened/iu);
  });
});
