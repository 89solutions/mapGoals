# mapGoals

Provides a visual representation of a personal goal journey, for example weight loss.
The user enters two points, such as home and Las Vegas, and a goal value, e.g. 20lbs.
As they record losses, the app updates their current position on the map.

**Example:** the route is 100 miles and the goal is to lose 30lbs. After logging 15lbs
(50% of the goal), the marker sits 50 miles (50%) along the route.

## Features

- **Goal**: a description ("Lose 30lbs in weight"), a target amount and a unit (lbs, kg, £, pages and so on).
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

Leaflet 1.9.4 is bundled in `vendor/leaflet`. Map tiles come from OpenStreetMap, place search from Nominatim, and road routes from OSRM, so those features need an internet connection.

## Tests

```bash
npm test
```

The tests cover the distance and progress maths in `js/geo.js`, including the 100-mile / 15-of-30lbs example above.

## Project layout

```
index.html        UI
css/style.css     styles
js/geo.js         pure geometry/progress maths (browser + Node)
js/app.js         map, UI, geocoding, routing, persistence
vendor/leaflet/   Leaflet map library (BSD-2-Clause)
test/             Node unit tests
```
