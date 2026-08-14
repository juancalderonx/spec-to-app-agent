import type { Car } from "@/types";

/** How the inventory list is ordered. `"none"` preserves the source order. */
export type SortKey = "none" | "year" | "make";

/** The sort keys in the order a control should offer them. */
export const SORT_KEYS: readonly SortKey[] = ["none", "year", "make"];

/** Human-readable label for each sort key, for a select or a toggle group. */
export function sortKeyLabel(key: SortKey): string {
  switch (key) {
    case "year":
      return "Year";
    case "make":
      return "Make";
    case "none":
      return "Unsorted";
  }
}

/** Narrows a type to one of the sort keys, for values arriving from the DOM. */
export function isSortKey(value: string): value is SortKey {
  return value === "none" || value === "year" || value === "make";
}

/**
 * Vehicles whose model contains `query`, compared without case.
 * An empty or whitespace-only query matches every vehicle.
 */
export function filterByModel(cars: readonly Car[], query: string): Car[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...cars];
  }
  return cars.filter((car) => car.model.toLowerCase().includes(needle));
}

/**
 * A new array ordered by `key`: year ascending, or make alphabetically.
 * The input array is never mutated.
 */
export function sortCars(cars: readonly Car[], key: SortKey): Car[] {
  const copy = [...cars];
  if (key === "none") {
    return copy;
  }
  if (key === "year") {
    return copy.sort((a, b) => a.year - b.year);
  }
  return copy.sort((a, b) =>
    a.make.localeCompare(b.make, undefined, { sensitivity: "base" }),
  );
}

/** Filter first, then sort, so ordering a narrowed list keeps the filter. */
export function filterAndSortCars(
  cars: readonly Car[],
  query: string,
  key: SortKey,
): Car[] {
  return sortCars(filterByModel(cars, query), key);
}
