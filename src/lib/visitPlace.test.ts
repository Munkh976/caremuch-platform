import { describe, expect, it } from "vitest";
import { placeShort, visitPlace, type OfficePlace } from "./visitPlace";

const office = (mode: string, note: string | null = null): OfficePlace => ({ id: "o", name: "Ripple Effects – Demo", visit_location: mode, note_location_default: note,
  address: "200 Demo Center Dr", city: "Portage", state: "MI", zip_code: "49002" });
const client = { address: "12 Elm St", city: "Kalamazoo", state: "MI", zip_code: "49001" };

describe("where a visit takes place (owner, Oct 22, A)", () => {
  it("client's home (default, or no office): the client's address as before", () => {
    expect(visitPlace(client, office("client_home"))).toEqual({ atOffice: false, label: null, short: "Kalamazoo, MI", full: "12 Elm St, Kalamazoo, MI 49001" });
    expect(visitPlace(client, null).full).toBe("12 Elm St, Kalamazoo, MI 49001");
    expect(visitPlace({ city: "Kalamazoo" }, undefined).short).toBe("Kalamazoo");
    expect(visitPlace(null, null)).toEqual({ atOffice: false, label: null, short: null, full: null });
  });
  it("office: the note location name (else the office name) and the office address, never the client's", () => {
    const p = visitPlace(client, office("office", "Ripple Effects Community Inclusion Center"));
    expect(p).toEqual({ atOffice: true, label: "Ripple Effects Community Inclusion Center", short: "Portage, MI", full: "200 Demo Center Dr, Portage, MI 49002" });
    expect(placeShort(p)).toBe("Ripple Effects Community Inclusion Center · Portage, MI");
    expect(visitPlace(client, office("office")).label).toBe("Ripple Effects – Demo");
    expect(JSON.stringify(p)).not.toMatch(/Elm|Kalamazoo/);
  });
});
