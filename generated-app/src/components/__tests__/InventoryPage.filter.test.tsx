import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockedProvider } from "@apollo/client/testing";

import { InventoryPage } from "@/components/InventoryPage";
import { GET_CARS } from "@/graphql/queries";
import type { Car } from "@/types";

type CarFixture = Car & { __typename: "Car" };

const cars: CarFixture[] = [
  {
    __typename: "Car",
    id: "car-1",
    make: "Honda",
    model: "Civic",
    year: 2020,
    color: "Blue",
    mobile: "https://images.test/civic-mobile.jpg",
    tablet: "https://images.test/civic-tablet.jpg",
    desktop: "https://images.test/civic-desktop.jpg",
  },
  {
    __typename: "Car",
    id: "car-2",
    make: "Toyota",
    model: "Corolla",
    year: 2018,
    color: "White",
    mobile: "https://images.test/corolla-mobile.jpg",
    tablet: "https://images.test/corolla-tablet.jpg",
    desktop: "https://images.test/corolla-desktop.jpg",
  },
  {
    __typename: "Car",
    id: "car-3",
    make: "Ford",
    model: "Mustang",
    year: 2022,
    color: "Red",
    mobile: "https://images.test/mustang-mobile.jpg",
    tablet: "https://images.test/mustang-tablet.jpg",
    desktop: "https://images.test/mustang-desktop.jpg",
  },
];

const fixtures = [
  { request: { query: GET_CARS }, result: { data: { cars } } },
  { request: { query: GET_CARS }, result: { data: { cars } } },
];

/**
 * Finds the control a person types a model name into. Prefers a search field or
 * a control whose accessible name speaks of filtering, and falls back to a
 * model-labelled control that is not part of the add-a-vehicle form.
 */
function resolveModelFilterInput(): HTMLElement {
  const preferred = [
    ...screen.queryAllByRole("searchbox"),
    ...screen.queryAllByRole("textbox", { name: /filter|search/i }),
  ];
  const first = preferred[0];
  if (first !== undefined) {
    return first;
  }

  const modelLabelled = screen.queryAllByLabelText(/model/i);
  const outsideForm = modelLabelled.filter(
    (element) => element.closest("form") === null,
  );
  const candidate = outsideForm[0] ?? modelLabelled[0];
  if (candidate === undefined) {
    throw new Error("expected an input for filtering the inventory by model");
  }
  return candidate;
}

describe("InventoryPage model filter", () => {
  it("keeps vehicles whose model matches what was typed and removes the rest", async () => {
    const user = userEvent.setup();

    render(
      <MockedProvider mocks={fixtures} addTypename={false}>
        <InventoryPage />
      </MockedProvider>,
    );

    await screen.findByText(/Civic/i);
    expect(screen.queryAllByText(/Corolla/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Mustang/i).length).toBeGreaterThan(0);

    await user.type(resolveModelFilterInput(), "Civ");

    await waitFor(() => {
      expect(screen.queryAllByText(/Corolla/i)).toHaveLength(0);
    });

    expect(screen.queryAllByText(/Mustang/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Civic/i).length).toBeGreaterThan(0);
  });
});
