import { describe, expect, it } from "vitest";

import { compareLayoutField } from "../apps/pixso-layout-probe/src/compare";

describe("compareLayoutField", () => {
  it("reports exact raw values", () => {
    expect(
      compareLayoutField({
        figma: { observed: true, value: "HORIZONTAL" },
        pixso: { apiSupported: true, observed: true, value: "HORIZONTAL" }
      })
    ).toBe("exact-match");
  });

  it("keeps equivalent and normalized outcomes explicit", () => {
    expect(
      compareLayoutField({
        figma: { observed: true, value: "FILL" },
        pixso: { apiSupported: true, observed: true, value: 1 },
        equivalent: true
      })
    ).toBe("equivalent");
    expect(
      compareLayoutField({
        figma: { observed: true, value: "AUTO" },
        pixso: { apiSupported: true, observed: true, value: "HUG" },
        normalized: true
      })
    ).toBe("normalized");
  });

  it("distinguishes lost, unsupported, and unverified", () => {
    expect(
      compareLayoutField({
        figma: { observed: true, value: "FILL" },
        pixso: { apiSupported: true, observed: false, value: null }
      })
    ).toBe("lost");
    expect(
      compareLayoutField({
        figma: { observed: true, value: "FILL" },
        pixso: { apiSupported: false, observed: false, value: null }
      })
    ).toBe("unsupported");
    expect(
      compareLayoutField({
        figma: { observed: false, value: null },
        pixso: { apiSupported: true, observed: true, value: "FIXED" }
      })
    ).toBe("unverified");
  });
});
