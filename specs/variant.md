# Vinyl Record Collection

## Context

Our shop keeps its second-hand vinyl stock on index cards in a shoebox behind
the counter. When a customer asks whether we have a particular pressing, one of
us kneels down and flicks through the box. We want that box on a screen.

This is a shop-floor tool. It has to be fast to scan and readable from an arm's
length away across the counter.

The collection data already exists behind the project's GraphQL API, together
with the operations needed to read it. Use what is already there rather than
inventing a second source of truth.

## Who uses it

Two shop assistants, working on a tablet mounted next to the till and
occasionally on the shop's desktop machine. Customers sometimes read the screen
over the counter, so the display should be legible rather than dense.

## What it must do

**Show the collection.** Every record in stock appears on the page, loaded from
the GraphQL API when the page opens. Show the user that data is loading rather
than an empty screen, and if the request fails, say so plainly instead of
rendering an empty collection.

**Present each record as a card.** Every record shows its title, the artist, the
year it was released, its genre, and its sleeve artwork. Use the component
library the project already depends on rather than introducing another one.

**Serve the right sleeve image for the screen.** Each record has three image
sources: one for phones, one for tablets, and one for desktop screens. Use the
appropriate one for the current viewport width. The bands are:

- 640px wide or narrower — the phone image
- between 641px and 1023px — the tablet image
- 1024px or wider — the desktop image

**Let assistants find a record.** Customers ask by artist far more often than by
title, so there must be a way to filter the collection down by artist as the
user types. It must also be possible to sort by release year or by title.
Filtering and sorting must work together.

**Let assistants narrow by decade.** Browsing customers ask for "something from
the seventies" more often than they ask for a specific record. Alongside the
artist filter, there must be a way to restrict the collection to a single
decade. The two filters must be combinable: an artist filter and a decade
filter applied together narrow to records matching both.

**Show a single record in detail.** Selecting a record opens a detailed view of
just that record, fetched on its own rather than reused from the list. The
detail view shows everything the card shows, at a larger size. The user must be
able to get back to the full collection from there.

**Keep the data access reusable.** The logic that talks to the GraphQL API —
fetching the collection, fetching a single record, and the loading and error
states that come with it — must live in one reusable place that the
presentation layer consumes. Components that render records should not be
issuing queries themselves.

**Cover the important behaviour with automated tests.** At minimum: that the
collection renders once data arrives, that the artist filter narrows what is
shown, that the decade filter narrows what is shown, that the two combine, and
that sorting reorders the result. Tests must run against the project's existing
mock API rather than a live network.

## Out of scope

- Adding, editing, or deleting a record. This release is read-only; stock is
  still entered on the index cards and transcribed weekly.
- Prices and stock counts. Those live in the till system and stay there.
- Any kind of sign-in.
- Pagination.
- Any real backend. The mock API the project already ships with is the API.

## How we will judge it

An assistant can open the page on the counter tablet, type an artist's name,
narrow the result to a single decade, sort what remains by release year, open
one record to read its details, and return to the full collection — all without
a page reload.
