# mapGoals

Provides a visual representation of a personal goal journey, for example weight loss.
The user enters two points, such as home and Las Vegas, and a goal value, e.g. 20lbs.
As they record losses, the app updates their current position on the map.

**Example:** the route is 100 miles and the goal is to lose 30lbs. After logging 15lbs
(50% of the goal), the marker sits 50 miles (50%) along the route.

## Features

- **Goal**: a description ("Lose 30lbs in weight"), a target amount and a unit chosen from a dropdown:
  - **Weight**: pounds (lbs), kilograms, stones, grams, ounces
  - **Money**: Pounds Sterling (£), US Dollars ($), Euros (€), Canadian and Australian Dollars, Japanese Yen
  - **Distance**: miles, kilometres
  - **Time**: hours, minutes
  - **Other**: type your own unit, for example "pages" or "push-ups"
- **Flexible amounts**: type amounts however is natural. `3.52`, `£3.52`, `52p`, `£1,250.75`, `€4,50` (decimal comma),
  `2st 5lb`, `1.2kg` and `-1` all work. A unit typed in the box overrides the entry's unit dropdown.
- **Unit conversion**: progress can be logged in any unit compatible with the goal, for example kilograms
  or stones towards a lbs goal, or euros towards a £ goal. The log shows each entry as entered, plus its
  converted value (`+€10.00 ≈ +£8.60`). Weights convert exactly. Currencies use the latest European Central Bank rates
  from [Frankfurter](https://frankfurter.dev), cached for 12 hours, and fall back to approximate built-in rates when offline.
  Money totals are added up in pence/cents, so they are exact to the penny.
  Changing the goal unit converts the target, for example 30 lbs becomes 2 st 2 lb.
- **Journey**: set the start and destination by searching for a place, or by clicking the map. Drag the pins to adjust them.
  - *As the crow flies*: a great-circle line, which is the true shortest distance.
  - *By road*: a driving route from the public OSRM service. If no route is found, the app falls back to a straight line.
  - Show distances in miles or kilometres.
- **Progress log**: add dated entries with an optional note. Use negative amounts for setbacks, and delete entries you no longer want.
- **Map position**: the 🏃 marker moves along the route in proportion to your progress. The part of the route you've covered is drawn solid. The panel shows the distance travelled and remaining, and the place you're currently near.
- Everything is saved in your browser's `localStorage`. There is no account or server.

## Running it

It's a static site with no build step. Serve the folder with any static web server:

```bash
npm start            # npx http-server on http://localhost:8080
# or
python3 -m http.server 8080
```

You can also open `index.html` directly.

Leaflet 1.9.4 is bundled in `vendor/leaflet`. Map tiles come from OpenStreetMap, place search from Nominatim, road routes from OSRM and exchange rates from Frankfurter, so those features need an internet connection.

## Tests

```bash
npm test
```

The tests cover the distance and progress maths in `js/geo.js`, including the 100-mile / 15-of-30lbs example above.
They also cover parsing, conversion and formatting of amounts in `js/units.js`, such as `£3.52`, `52p` and `2st 5lb`.

## Project layout

```
index.html        UI
css/style.css     styles
js/geo.js         pure geometry/progress maths (browser + Node)
js/units.js       unit definitions, amount parsing, conversion, formatting
js/app.js         map, UI, geocoding, routing, persistence
vendor/leaflet/   Leaflet map library (BSD-2-Clause)
test/             Node unit tests
```
