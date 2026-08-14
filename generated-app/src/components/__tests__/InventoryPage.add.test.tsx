import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockedProvider } from "@apollo/client/testing";
import { InventoryPage } from "@/components/InventoryPage";
import { ADD_CAR, GET_CARS } from "@/graphql/queries";

/** The inventory the query answers with before anything is added. */
const seededCars = [
  {
    __typename: "Car",
    id: "car-1",
    make: "Toyota",
    model: "Corolla",
    year: 2019,
    color: "Blue",
    mobile: "https://images.test/corolla-mobile.jpg",
    tablet: "https://images.test/corolla-tablet.jpg",
    desktop: "https://images.test/corolla-desktop.jpg",
  },
  {
    __typename: "Car",
    id: "car-2",
    make: "Honda",
    model: "Civic",
    year: 2021,
    color: "Red",
    mobile: "https://images.test/civic-mobile.jpg",
    tablet: "https://images.test/civic-tablet.jpg",
    desktop: "https://images.test/civic-desktop.jpg",
  },
];

/** What the mutation returns for the vehicle the staff member enters. */
const addedCar = {
  __typename: "Car",
  id: "car-3",
  make: "Ford",
  model: "Fiesta",
  year: 2024,
  color: "Silver",
  mobile: "https://images.test/fiesta-mobile.jpg",
  tablet: "https://images.test/fiesta-tablet.jpg",
  desktop: "https://images.test/fiesta-desktop.jpg",
};

const inventoryFixture = {
  request: { query: GET_CARS },
  result: { data: { cars: seededCars } },
};

/**
 * Three fixtures: the initial read, the mutation, and a second read holding the
 * new vehicle so the page shows it whether the hook updates the cache or
 * refetches the inventory.
 */
const addFixtures = [
  inventoryFixture,
  {
    request: {
      query: ADD_CAR,
      variables: {
        make: "Ford",
        model: "Fiesta",
        year: 2024,
        color: "Silver",
      },
    },
    result: { data: { addCar: addedCar } },
  },
  {
    request: { query: GET_CARS },
    result: { data: { cars: [...seededCars, addedCar] } },
  },
];

/**
 * Scopes queries to the add-vehicle form, so its model field is not confused
 * with the model filter that sits alongside it on the page.
 */
function addVehicleForm(): ReturnType<typeof within> {
  const submit = screen.getByRole("button", { name: /add/i });
  const form = submit.closest("form");
  if (form === null) {
    throw new Error("expected the add-vehicle submit button to sit in a form");
  }
  return within(form);
}

/** Narrows a labelled control to the input whose value a person can read. */
function textField(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("expected the labelled control to be a text input");
  }
  return element;
}

function renderPage(mocks: typeof addFixtures): RenderResult {
  return render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <InventoryPage />
    </MockedProvider>,
  );
}

describe("adding a vehicle to the inventory", () => {
  it("shows the submitted vehicle in the grid without a reload", async () => {
    const user = userEvent.setup();
    renderPage(addFixtures);

    expect(await screen.findByText(/Corolla/)).not.toBeNull();

    const form = addVehicleForm();
    await user.type(form.getByLabelText(/make/i), "Ford");
    await user.type(form.getByLabelText(/model/i), "Fiesta");

    const year = form.getByLabelText(/year/i);
    await user.clear(year);
    await user.type(year, "2024");

    const color = form.getByLabelText(/colou?r/i);
    await user.clear(color);
    await user.type(color, "Silver");

    await user.click(form.getByRole("button", { name: /add/i }));

    // The new vehicle joins the inventory in place, and the vehicles that were
    // already there are still listed.
    expect(await screen.findByText(/Fiesta/)).not.toBeNull();
    expect(screen.getByText(/Silver/)).not.toBeNull();
    expect(screen.getByText(/Corolla/)).not.toBeNull();
    expect(screen.getByText(/Civic/)).not.toBeNull();
  });

  it("rejects a submission with no vehicle details", async () => {
    const user = userEvent.setup();
    // Only the inventory read is mocked: a submission that got through would
    // have no fixture to match.
    renderPage([inventoryFixture]);

    expect(await screen.findByText(/Corolla/)).not.toBeNull();

    const form = addVehicleForm();
    const make = textField(form.getByLabelText(/make/i));
    const model = textField(form.getByLabelText(/model/i));
    await user.clear(make);
    await user.clear(model);

    await user.click(form.getByRole("button", { name: /add/i }));

    // The empty entry is refused: the blank fields stay blank rather than being
    // cleared by a successful submission.
    await waitFor(() => {
      expect(make.value).toBe("");
    });
    expect(model.value).toBe("");

    // And the inventory is untouched — no blank vehicle was appended.
    expect(screen.getByText(/Corolla/)).not.toBeNull();
    expect(screen.getByText(/Civic/)).not.toBeNull();
    expect(screen.queryByText(/Fiesta/)).toBeNull();
  });
});
