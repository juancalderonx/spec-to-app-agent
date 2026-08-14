import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockedProvider } from "@apollo/client/testing";

import { GET_CARS } from "@/graphql/queries";
import { InventoryPage } from "@/components/InventoryPage";

type User = ReturnType<typeof userEvent.setup>;

/**
 * Delivered deliberately out of order for both sort keys, so that any sorted
 * rendering differs from the order the API handed back.
 *
 * delivered:      Civic, Fiesta, Corolla
 * by year:        Civic (2019), Corolla (2021), Fiesta (2023)
 * by make:        Fiesta (Ford), Civic (Honda), Corolla (Toyota)
 */
const cars = [
  {
    __typename: "Car",
    id: "car-1",
    make: "Honda",
    model: "Civic",
    year: 2019,
    color: "Red",
    mobile: "https://images.test/civic-mobile.jpg",
    tablet: "https://images.test/civic-tablet.jpg",
    desktop: "https://images.test/civic-desktop.jpg",
  },
  {
    __typename: "Car",
    id: "car-2",
    make: "Ford",
    model: "Fiesta",
    year: 2023,
    color: "Green",
    mobile: "https://images.test/fiesta-mobile.jpg",
    tablet: "https://images.test/fiesta-tablet.jpg",
    desktop: "https://images.test/fiesta-desktop.jpg",
  },
  {
    __typename: "Car",
    id: "car-3",
    make: "Toyota",
    model: "Corolla",
    year: 2021,
    color: "Blue",
    mobile: "https://images.test/corolla-mobile.jpg",
    tablet: "https://images.test/corolla-tablet.jpg",
    desktop: "https://images.test/corolla-desktop.jpg",
  },
];

const models = ["Civic", "Fiesta", "Corolla"];

const deliveredOrder = ["Civic", "Fiesta", "Corolla"];
const yearOrders = [
  ["Civic", "Corolla", "Fiesta"],
  ["Fiesta", "Corolla", "Civic"],
];
const makeOrders = [
  ["Fiesta", "Civic", "Corolla"],
  ["Corolla", "Civic", "Fiesta"],
];
const filteredOrders = [
  ["Civic", "Corolla"],
  ["Corolla", "Civic"],
];

// The inventory query is offered twice: once for the initial fetch, once in
// case the page re-issues it rather than reading the cache.
const fixtures = [
  { request: { query: GET_CARS }, result: { data: { cars } } },
  { request: { query: GET_CARS }, result: { data: { cars } } },
];

/**
 * The models that are visible, in the order a person reads them down the page.
 * Derived from visible text only, so it says nothing about how the cards look.
 */
function renderedOrder(): string[] {
  const text = document.body.textContent ?? "";
  return models
    .map((model) => ({ model, at: text.indexOf(model) }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => left.at - right.at)
    .map((entry) => entry.model);
}

function renderPage(): User {
  const user = userEvent.setup();
  render(
    <MockedProvider mocks={fixtures} addTypename={false}>
      <InventoryPage />
    </MockedProvider>,
  );
  return user;
}

async function waitForInventory(): Promise<void> {
  await waitFor(() => {
    expect(renderedOrder()).toHaveLength(models.length);
  });
}

function filterInput(): HTMLElement {
  const candidates = [
    ...screen.queryAllByRole("textbox", { name: /filter|search/i }),
    ...screen.queryAllByRole("searchbox", { name: /filter|search/i }),
    ...screen.queryAllByRole("textbox", { name: /model/i }),
    ...screen.queryAllByRole("searchbox", { name: /model/i }),
    ...screen.queryAllByRole("textbox"),
  ];
  const input = candidates[0];
  if (input === undefined) {
    throw new Error("expected an input for filtering the inventory by model");
  }
  return input;
}

async function chooseListedOption(user: User, option: RegExp): Promise<void> {
  const item = await waitFor(() => {
    const listed = [
      ...screen.queryAllByRole("option", { name: option }),
      ...screen.queryAllByRole("menuitem", { name: option }),
    ];
    const first = listed[0];
    if (first === undefined) {
      throw new Error(`expected a sort option matching ${String(option)}`);
    }
    return first;
  });
  await user.click(item);
}

async function openAndChoose(
  user: User,
  trigger: HTMLElement,
  option: RegExp,
): Promise<void> {
  if (trigger instanceof HTMLSelectElement) {
    const listed = screen.queryAllByRole("option", { name: option });
    const chosen = listed[0];
    if (chosen === undefined) {
      throw new Error(`expected a sort option matching ${String(option)}`);
    }
    await user.selectOptions(trigger, chosen);
    return;
  }
  await user.click(trigger);
  await chooseListedOption(user, option);
}

/** Drives whatever control the page offers for sorting, by option name. */
async function sortBy(user: User, option: RegExp): Promise<void> {
  const namedSelect = screen.queryAllByRole("combobox", {
    name: /sort|order/i,
  })[0];
  if (namedSelect !== undefined) {
    await openAndChoose(user, namedSelect, option);
    return;
  }

  const directControl = [
    ...screen.queryAllByRole("button", { name: option }),
    ...screen.queryAllByRole("radio", { name: option }),
  ][0];
  if (directControl !== undefined) {
    await user.click(directControl);
    return;
  }

  const namedButton = screen.queryAllByRole("button", {
    name: /sort|order/i,
  })[0];
  if (namedButton !== undefined) {
    await openAndChoose(user, namedButton, option);
    return;
  }

  const anySelect = screen.queryAllByRole("combobox")[0];
  if (anySelect !== undefined) {
    await openAndChoose(user, anySelect, option);
    return;
  }

  throw new Error(`expected a control for sorting by ${String(option)}`);
}

describe("InventoryPage sorting", () => {
  it("reorders the cards when sorting by year", async () => {
    const user = renderPage();
    await waitForInventory();

    const asDelivered = renderedOrder();
    expect(asDelivered).toEqual(deliveredOrder);

    await sortBy(user, /year/i);

    await waitFor(() => {
      expect(yearOrders).toContainEqual(renderedOrder());
    });
    expect(renderedOrder()).not.toEqual(asDelivered);
  });

  it("reorders the cards when sorting by make", async () => {
    const user = renderPage();
    await waitForInventory();

    const asDelivered = renderedOrder();

    await sortBy(user, /make/i);

    await waitFor(() => {
      expect(makeOrders).toContainEqual(renderedOrder());
    });
    expect(renderedOrder()).not.toEqual(asDelivered);
  });

  it("keeps the model filter applied when the filtered list is sorted", async () => {
    const user = renderPage();
    await waitForInventory();

    await user.type(filterInput(), "C");

    await waitFor(() => {
      expect(renderedOrder()).not.toContain("Fiesta");
    });

    await sortBy(user, /year/i);

    await waitFor(() => {
      expect(filteredOrders).toContainEqual(renderedOrder());
    });
    expect(renderedOrder()).not.toContain("Fiesta");
  });
});
