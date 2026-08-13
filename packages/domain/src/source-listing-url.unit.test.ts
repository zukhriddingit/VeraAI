import { describe, expect, it } from "vitest";

import { classifyObservedListingUrl } from "./source-listing-url.ts";

describe("observed listing URL classification", () => {
  it.each([
    ["https://www.apartments.com/boston-ma/parking/", "non_listing"],
    ["https://www.apartments.com/boston-ma/balcony/", "non_listing"],
    ["https://www.apartments.com/beacon-hill-boston-ma/abc123/", "listing"],
    ["https://offcampus.bu.edu/housing/campus-Charles+River+Campus_bw971e9", "non_listing"],
    ["https://offcampus.bu.edu/housing/neighborhood-Somerville_drq13kk", "non_listing"],
    ["https://offcampus.bu.edu/housing/property/the-longwood/boston/abc123", "listing"],
    [
      "https://www.craigslist.org/view/d/somerville-renovated-apartment/eok9SmyfAgVn49wCv4TNYh",
      "listing"
    ],
    ["https://www.craigslist.org/search/area/boston?cat=apa", "non_listing"]
  ])("classifies %s as %s", (url, expected) => {
    const source = url.includes("apartments.com")
      ? "apartments_com"
      : url.includes("offcampus.bu.edu")
        ? "bu_off_campus"
        : "craigslist";
    expect(classifyObservedListingUrl({ source, url })).toBe(expected);
  });

  it("ignores harmless URL fragments when classifying observed listing paths", () => {
    expect(
      classifyObservedListingUrl({
        source: "zillow",
        url: "https://www.zillow.com/apartments/allston-ma/217-221-kelton-st/CrJbYn/#bedrooms-1"
      })
    ).toBe("listing");
    expect(
      classifyObservedListingUrl({
        source: "zillow",
        url: "https://www.zillow.com/apartments/allston-ma/217-221-kelton-st/CrJbYn/#token=secret"
      })
    ).toBe("non_listing");
  });

  it("keeps unrecognized safe custom layouts unknown and rejects unsafe or off-domain URLs", () => {
    expect(
      classifyObservedListingUrl({
        source: "custom_website",
        url: "https://housing.example.edu/unit/42",
        allowedDomain: "housing.example.edu"
      })
    ).toBe("unknown");
    expect(
      classifyObservedListingUrl({
        source: "custom_website",
        url: "https://evil.example/unit/42",
        allowedDomain: "housing.example.edu"
      })
    ).toBe("non_listing");
    expect(
      classifyObservedListingUrl({
        source: "zillow",
        url: "https://user:pass@www.zillow.com/homedetails/42"
      })
    ).toBe("non_listing");
    expect(
      classifyObservedListingUrl({
        source: "zillow",
        url: "https://www.zillow.com/homedetails/42?token=secret"
      })
    ).toBe("non_listing");
  });
});
