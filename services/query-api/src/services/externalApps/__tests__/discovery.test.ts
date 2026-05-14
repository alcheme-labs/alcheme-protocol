import { shouldIncludeInDiscovery } from "../discovery";

describe("external app discovery", () => {
  it("includes listed and limited production apps", () => {
    expect(shouldIncludeInDiscovery({ discoveryStatus: "listed", registryStatus: "active" })).toBe(true);
    expect(shouldIncludeInDiscovery({ discoveryStatus: "limited", registryStatus: "active" })).toBe(true);
  });

  it("excludes hidden, delisted, and revoked apps", () => {
    expect(shouldIncludeInDiscovery({ discoveryStatus: "hidden", registryStatus: "active" })).toBe(false);
    expect(shouldIncludeInDiscovery({ discoveryStatus: "delisted", registryStatus: "active" })).toBe(false);
    expect(shouldIncludeInDiscovery({ discoveryStatus: "listed", registryStatus: "revoked" })).toBe(false);
    expect(shouldIncludeInDiscovery({ status: "inactive", discoveryStatus: "listed", registryStatus: "active" })).toBe(false);
  });

  it("requires confirmed chain registry and receipt finality in required production mode", () => {
    expect(
      shouldIncludeInDiscovery({
        status: "active",
        environment: "mainnet_production",
        discoveryStatus: "listed",
        registryStatus: "active",
        registryMode: "required",
        registryAnchor: {
          registryStatus: "active",
          finalityStatus: "confirmed",
          receiptFinalityStatus: "confirmed",
        },
      }),
    ).toBe(true);

    expect(
      shouldIncludeInDiscovery({
        status: "active",
        environment: "mainnet_production",
        discoveryStatus: "listed",
        registryStatus: "active",
        registryMode: "required",
        registryAnchor: {
          registryStatus: "active",
          finalityStatus: "submitted",
          receiptFinalityStatus: "pending",
        },
      }),
    ).toBe(false);
  });
});
