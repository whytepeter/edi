---
name: trip-planner
description: >
  Plans a trip with the user: a day-by-day itinerary with travel times, bookings and costs in a
  table, calendar events for the fixed parts, and a packing checklist that fits the weather. Use
  when the user asks to plan a trip, holiday, weekend away or business travel, build an
  itinerary, or make a packing list.
license: Proprietary
metadata:
  title: Trip Planner
  author: Fewerlabs
  version: "1.0"
  category: "Travel"
  icon: pin
  examples: "Plan 4 days in Lisbon in October | Make a packing list for a work trip to London | Put my flight and hotel on my calendar"
  apps: googlecalendar gmail
---

# Trip Planner

A plan the user could hand to a friend: realistic days, what's booked, what it costs, what to
bring.

## 1. The basics (ask once, only what's missing)

Where, when (dates), who's going, the purpose (work, rest, sightseeing), budget level, and must-do
things. Check their calendar with `calendar_events` for the dates, and their email (if Gmail is
connected) for existing bookings to build around.

## 2. Research

`web_search` and `web_fetch` for: the weather for those dates, getting around (and between
airport and stay), opening days of the must-sees, and a few well-reviewed options near where
they're staying. Prefer official sites for hours and prices.

## 3. The plan

`workspace_show` as a document: a short overview, then each day with morning / afternoon /
evening, travel time between places, and one rain-day swap. Add a table of bookings and costs
(what, when, price, booked or not, link).

## 4. Calendar and packing (reviewed)

- Offer to add the fixed parts (flights, hotel check-in, reservations, meetings) with
  `calendar_create`, one event each, with confirmation numbers in the notes.
- Packing: `workspace_show` as a checklist based on the weather, length and activities, plus
  documents (passport, visas, adapters for the destination).
- Offer reminders for check-in and leaving for the airport with `reminders_create`.

## Don't

- Don't book, pay or enter personal details anywhere; give the links and let the user book.
- Don't cram the days: leave room for rest and getting lost.
