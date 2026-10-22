/**
 * Where a visit takes place (owner, Oct 22, A): the office setting virtual_office.visit_location. 'client_home' (the
 * default) shows the client's address as before; 'office' shows the office (its note location name, else its name) and
 * the office address. Display only — client addresses stay in the client record.
 */
export interface OfficePlace {
  id: string; name: string; visit_location: string | null; note_location_default: string | null;
  address: string | null; city: string | null; state: string | null; zip_code: string | null;
  /** care-plan module on (pickup gate, owner Oct 22 decision 3) */
  care_plan_module_enabled?: boolean | null;
}
export interface PlaceClient { address?: string | null; city?: string | null; state?: string | null; zip_code?: string | null }
export interface VisitPlace {
  atOffice: boolean;
  /** office name (or note location) when at the office; null at the client's home */
  label: string | null;
  /** "city, ST" for compact rows */
  short: string | null;
  /** street, city, ST zip */
  full: string | null;
}

const join = (p: PlaceClient) => {
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  const tail = [cityState, p.zip_code].filter(Boolean).join(" ");
  return { short: cityState || null, full: [p.address, tail].filter(Boolean).join(", ") || null };
};

export function visitPlace(client: PlaceClient | null | undefined, office: OfficePlace | null | undefined): VisitPlace {
  if (office && office.visit_location === "office") {
    const j = join(office);
    return { atOffice: true, label: office.note_location_default?.trim() || office.name, short: j.short, full: j.full };
  }
  const j = join(client ?? {});
  return { atOffice: false, label: null, short: j.short, full: j.full };
}

/** One line for compact rows: "At <office>, City, ST" or the client's "City, ST". */
export const placeShort = (p: VisitPlace) => (p.atOffice ? [p.label, p.short].filter(Boolean).join(" · ") : p.short);
