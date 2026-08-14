import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MockedProvider } from "@apollo/client/testing";

import { InventoryPage } from "@/components/InventoryPage";
import { GET_CARS } from "@/graphql/queries";
import { seedCars } from "@/mocks/data";

/**
 * The inventory the mock API is seeded with, shaped as the GraphQL response the
 * page reads. Mocking above the network keeps the run off any live connection
 * while still asserting against the same vehicles the mock API serves.
 */
const carsResult = seedCars.map((car) => ({ ...car, __typename: "Car" as const }));

const fixtures = [
  {
    request: { query: GET_CARS },
    result: { data: { cars: carsResult } },
  },
];

/** Everything a person can read on the page right now. */
function pageText(): string {
  return document.body.textContent ?? "";
}

describe("InventoryPage rendering the inventory", () => {
  it("shows a loading state first, then every seeded vehicle", async () => {
    expect(seedCars.length).toBeGreaterThan(0);

    render(
      <MockedProvider mocks={fixtures} addTypename={false}>
        <InventoryPage />
      </MockedProvider>,
    );

    const indicator =
      screen.queryByRole("progressbar") ?? screen.queryByText(/loading/i);
    if (indicator === null) {
      throw new Error(
        "expected a loading indicator while the inventory request was in flight",
      );
    }

    await waitFor(() => {
      const text = pageText();
      for (const car of seedCars) {
        expect(text).toContain(car.make);
        expect(text).toContain(car.model);
        expect(text).toContain(String(car.year));
        expect(text).toContain(car.color);
      }
    });

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
