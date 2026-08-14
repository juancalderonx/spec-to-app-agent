# Car Inventory Manager

## Context

Our dealership staff currently track available vehicles in a shared
spreadsheet. It is slow to scan, impossible to filter, and nobody trusts it
after lunchtime. We want a single web page that shows the current inventory,
lets staff find a vehicle quickly, and lets them add one without leaving the
page.

This is an internal tool. Nobody outside the dealership will see it, so polish
matters less than the information being correct and quick to reach.

The inventory data already exists behind the project's GraphQL API, together
with the operations needed to read it and to add to it. Use what is already
there rather than inventing a second source of truth.

## Who uses it

Sales staff on the showroom floor, mostly on a phone or a tablet while standing
next to a customer, and occasionally on a desktop machine in the back office.
The phone case is the common one and should not feel like an afterthought.

## What it must do

**Show the current inventory.** Every vehicle we have available appears on the
page, loaded from the GraphQL API when the page opens. While the data is on its
way, the user should see that something is happening rather than an empty
screen. If the request fails, say so plainly instead of showing an empty
inventory, which staff would read as "we have no cars".

**Present each vehicle as a card.** Every vehicle shows its make, model, year,
colour, and a photograph. Use the component library the project already
depends on rather than introducing another one. The cards should sit in a
layout that adapts as the screen gets narrower.

**Serve the right photograph for the screen.** Each vehicle has three image
sources: one for phones, one for tablets, and one for desktop screens. The page
must use the appropriate one for the current viewport width, so staff on the
showroom floor are not waiting on a desktop-sized image over mobile data.
The bands are:

- 640px wide or narrower — the phone image
- between 641px and 1023px — the tablet image
- 1024px or wider — the desktop image

**Let staff find a vehicle.** A customer usually asks by model name, so there
must be a way to filter the inventory down by model as the user types. Staff
also browse by age and by manufacturer, so it must be possible to sort the
inventory by year or by make. Filtering and sorting must work together: sorting
a filtered list keeps the filter applied.

**Let staff add a vehicle.** New stock arrives daily. Staff must be able to
enter a vehicle's make, model, year, and colour and submit it through the
existing GraphQL mutation. Once submitted, the new vehicle must appear in the
inventory without the user having to reload the page. Do not accept an empty
submission.

**Keep the data access reusable.** The logic that talks to the GraphQL API —
fetching the inventory, adding to it, and the loading and error states that
come with it — must live in one reusable place that the presentation layer
consumes. Components that render vehicles should not be issuing queries
themselves. We expect to build a second screen against the same data later this
quarter and we do not want to write it twice.

**Cover the important behaviour with automated tests.** At minimum: that the
inventory renders once data arrives, that filtering narrows what is shown, that
sorting reorders it, and that adding a vehicle works. Tests must run against
the project's existing mock API rather than a live network.

## Out of scope

- Editing or deleting a vehicle. Read and create only, for now.
- Any kind of sign-in. The page sits behind our internal network.
- Pagination. We carry a few dozen vehicles at a time; showing all of them is
  fine.
- Any real backend. The mock API the project already ships with is the API.

## How we will judge it

A staff member can open the page on a phone, type part of a model name, see the
list narrow, sort what remains by year, add a vehicle that has just arrived,
and watch it appear in the list — without a page reload and without a
noticeable wait for images.
