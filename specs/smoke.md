# Inventory Board

## Context

Before the full tool is built, the floor manager wants the smallest possible
thing that proves the inventory can be seen at all: one page, one list, no
controls. If this does not work, nothing built on top of it will.

## Who uses it

The same sales staff, on the same phones. Nothing about the audience changes —
only how little the page does.

## What it must do

**Show the current inventory.** Every vehicle we have available appears on the
page, loaded from the GraphQL API the project already provides when the page
opens. Use what is already there rather than inventing a second source of
truth.

**Say what is happening while it loads.** The user should see that the page is
working rather than an empty screen.

**Say so plainly when it fails.** If the request does not come back, the page
must say the inventory could not be loaded. An empty page would be read as "we
have no vehicles", which is a different and much worse claim.

**Show enough of each vehicle to recognise it.** Its make, its model and its
year. Use the component library the project already depends on rather than
introducing another one.

**Cover the one behaviour that matters with an automated test.** That the
inventory renders once the data has arrived. The test must run against the
project's existing mock API rather than a live network.

## Out of scope

- Searching, filtering or sorting. This page only lists.
- Adding, editing or deleting. Read only.
- Images of any kind. Text is enough to prove the data arrived.
- Any real backend. The mock API the project already ships with is the API.

## How we will judge it

Someone opens the page and sees every vehicle currently in stock, each one
identifiable, without a reload and without touching anything.
