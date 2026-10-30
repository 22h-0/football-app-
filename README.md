# SIDELINE · Better teams. Better games.

A responsive football/soccer team generator and tournament tracker built with React, Vite, and Tailwind CSS 4. Save your squad once, select today's available players, and generate 2–6 teams with balanced total skill. Turn the teams into a scheduled tournament, enter scores, track live standings, and share results with your group chat.

The interface uses a dark sports palette, lime accents, color-coded teams, keyboard-accessible dialogs, and layouts for phones, tablets, and desktop screens. The app has two modes: a shared website with creator accounts, and the original offline version with browser-local data.

## Shared website with creator-only editing

Only the account that creates a tournament can edit scores, goalscorers, kickoff times, sharing, or delete it. The Express/SQLite API checks ownership on every write. Group members open a read-only spectator link without signing in; its results refresh every 10 seconds. Other accounts cannot change your tournament, even by submitting API requests directly.

Use Node.js 24. Run `npm ci`, then `npm run dev:server` and `npm run dev:shared` in two terminals. The frontend proxies `/api` to the server on port 3001. For deployment, use `npm run build:shared` and `npm start`, or the supplied Dockerfile. Express serves the frontend and API together.

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, HTTPS, persistent data, and the optional Render blueprint. A hosting account is still required to obtain a public URL; no website has been deployed by preparing this code. The Render blueprint uses a paid web service and persistent disk. Upload the updated project files to your repository before connecting it to a hosting provider. Static-only hosting cannot run this shared version.

Production requires `NODE_ENV=production`, `APP_ORIGIN` set to the actual HTTPS origin, and a writable persistent `DATA_DIR`. Accounts, hashed passwords/sessions, and tournament data live in SQLite. Preserve that database across deploys and run a single application instance. Email password recovery is not implemented, so keep the creator password safe.

After deployment, sign in, create a tournament, and choose **Share viewer link**. Send that link to your group. Replacing a viewer link revokes the old link. The website can be installed using the browser's Install app/Add to Home Screen action. Its service worker caches only public app assets, never private API responses or tournament payloads.

`src/hooks/useCloudTournaments.js` handles creator state and spectator polling. `server/` contains authentication, validation, SQLite storage, and authorization tests. `public/manifest.webmanifest` and `public/sw.js` provide the installable website shell. Shared account credentials are not stored in LocalStorage.

Validation commands: `npm test` (79 client tests), `npm run test:server` (10 real HTTP/SQLite tests), and `npm run test:sharing` (4 desktop/mobile creator/viewer flows). The existing local workflow tests remain available below. `npm run build` still builds offline/local mode; use **build:shared** for the shared website.

## Goalscorers

After saving a match score, open **Goalscorers** on that fixture. Choose players from the tournament squad or type names for custom teams, set each player's goals, and save. The Golden Boot table combines totals across the tournament and shares ranks for ties. Player totals cannot exceed their team's saved score. Unknown goals can remain unassigned; a final award requires every fixture to be played and every goal assigned. Lowering a score below assigned goals requires adjusting the scorers first; clearing a result clears its scorers too. Older saved tournaments without scorer fields remain supported.

## Offline mode: open the app without installing anything

The source `index.html` needs the Vite development server; it cannot be opened directly as a local file. For a double-clickable version, use `standalone/Sideline.html`. It includes all JavaScript, styles, icons, and artwork in a single file and works offline. Download it, keep it in a stable location, and open it with a modern desktop browser.

If HTML downloads are blocked, save the identical `standalone/Sideline.txt` copy and rename it to `Sideline.html`. This offline file does not provide shared accounts or live cross-device tournaments.

To recreate that file from source:

```bash
npm ci
npm run build:standalone
```

Run `npm run test:standalone` to check the self-contained HTML with all network access offline. A browser-test route supplies only the HTML document from disk; no web server or external assets are used. This checks rendering, adding a player, saving across reloads, team generation, and manual sharing on desktop and mobile Chromium. The cloud browser's administrator policy blocks `file://` navigation, so direct file opening must be checked on your own computer.

File-based LocalStorage behavior varies by browser and may be tied to the file's location. Keep using the same file and browser for your saved roster. The app displays a warning if storage is unavailable. For development or a hosted website, use the commands below instead.

## 1. Set up and run the offline/local workflow

Use Node.js 22.12+ or 24 and npm. Run these commands from the existing checkout:

```bash
cd /workspace/football-app-
npm ci
npm run dev
```

Vite prints its development address in the terminal. The dev command binds to all interfaces, allowing a development environment to expose it through its supported port forwarding. To choose a fixed port:

```bash
npm run dev -- --port 5173 --strictPort
```

Build, test, and inspect the production build:

```bash
npm test
npm run build
npm run preview
```

`npm test` runs Vitest once; it does not enter watch mode. `npm run build` writes the local-mode site to `dist/`. Static hosting of this build keeps independent browser-local tournaments; use the shared deployment above for live group access and owner-only editing. `npm run preview` is for checking the built site locally, not a production server.

### Equivalent fresh-project commands

The complete implementation is already in this repository. To start a separate project with the same React/Vite/Tailwind major versions:

```bash
npm create vite@6 sideline -- --template react
cd sideline
npm install react@19 react-dom@19 lucide-react@0.468 tailwindcss@4 @tailwindcss/vite@4
npm install -D vite@^6.4.5 @vitejs/plugin-react@4 vitest@5 jsdom@26 @testing-library/react@16 @testing-library/jest-dom@6 @testing-library/user-event@14 @playwright/test
npm pkg set 'scripts.dev=vite --host 0.0.0.0' 'scripts.build=vite build' 'scripts.preview=vite preview --host 0.0.0.0' 'scripts.test=vitest run' 'scripts.test:e2e=playwright test'
```

Copy this repository's `src/`, `public/`, `scripts/`, `e2e/`, `index.html`, both Playwright configuration files, and `vite.config.js` into the new project, replacing the scaffold's starter files. Then run `npm run dev`. For exact dependency versions and repeatable installs, use this repository's `package.json` and `package-lock.json` with `npm ci` instead.

Tailwind 4 uses the `@tailwindcss/vite` plugin in `vite.config.js` and `@import "tailwindcss";` in `src/index.css`. There is no Tailwind 3 `init` command or separate PostCSS configuration to run. The stylesheet combines Tailwind theme tokens with a component layer; responsive Tailwind grid and margin utilities in the JSX control the main layouts.

## 2. File structure

```text
football-app-/
├── .devcontainer/
│   └── devcontainer.json      # Original Python devcontainer; web app uses Node
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.js      # Desktop and mobile browser test projects
├── playwright.standalone.config.js
├── scripts/
│   └── build-standalone.mjs   # Creates the self-contained downloadable HTML
├── standalone/              # Generated, ignored
│   └── Sideline.html         # Open directly without Node or a server
├── e2e/
│   ├── app.spec.js           # CRUD, persistence, generation, sharing, layout
│   ├── standalone.spec.js    # Offline standalone HTML browser checks
│   └── tournament.spec.js    # Schedule, results, winners, and cup history
├── vite.config.js            # React, Tailwind, and Vitest setup
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx              # React entry point and stylesheet import
    ├── App.jsx               # Navigation, shared state, dialogs, generation
    ├── index.css             # Theme, component styles, responsive layouts
    ├── tournament.css        # Tournament layouts and three-tab mobile navigation
    ├── components/
    │   ├── Sidebar.jsx       # Matchday/roster navigation and help
    │   ├── PlayerList.jsx    # Searchable roster and availability selection
    │   ├── PlayerCard.jsx    # Player identity, rating, selection/edit controls
    │   ├── PlayerDialog.jsx  # Add/edit form with 1–100 skill slider
    │   ├── MatchSetup.jsx    # Team count, selected-player summary, generation
    │   ├── TeamGenerator.jsx # Color-coded results and clipboard/manual sharing
    │   ├── Tournament.jsx    # Saved cups, table, fixtures, and champions
    │   ├── TournamentSetup.jsx # Teams, format, and schedule creation
    │   ├── FixtureRow.jsx    # Score entry, corrections, and kickoff editing
    │   └── Dialog.jsx        # Native modal dialog with focus restoration
    ├── hooks/
    │   ├── useRoster.js      # Persistent roster and availability state
    │   ├── useRoster.test.jsx
    │   ├── useTournaments.js # Persistent cup history, scores, active cup
    │   └── useTournaments.test.jsx
    ├── lib/
    │   ├── balanceTeams.js   # Balancing algorithm and statistics
    │   ├── balanceTeams.test.js
    │   ├── tournament.js     # Round robin, points, rankings, winner rules
    │   └── tournament.test.js
    └── test/
        └── setup.js          # Browser/test setup
```

## 3. Using the app

1. Open **Player roster** to add, edit, or remove players. Give every player a name and a whole-number skill rating from 1 to 100. Use the same rating scale for everyone. Deleting a player requires confirmation.
2. Open **Matchday**, select the available players, and choose 2–6 teams. Search helps find players; **Select all** and **Clear selection** apply to the whole roster.
3. Click **Generate teams**. Results show each team's players, total skill, average skill, and the difference between the highest and lowest total.
4. Use **Shuffle again** to try another arrangement, or **Edit lineup** to change availability. **Copy teams for WhatsApp** copies readable text to paste into any messaging app.

The starter roster contains 16 example players, with 12 initially available. Edit or remove these examples to make the squad your own. New players are automatically selected for the next match. The roster supports up to 100 players; names are trimmed and limited to 40 characters. Each team needs at least one available player.

### Tournaments, fixtures, and results

Open **Tournaments → New tournament**, or choose **Create tournament** underneath your generated teams. Use the balanced teams (with player snapshots) or enter 2–6 custom team names. Names must be distinct.

- Choose one round robin (each pair plays once) or home & away (each pair plays twice). Odd team counts include a clearly marked resting team each round.
- Optionally set the first date and kickoff, match length, and break duration. The app schedules all matches sequentially on one pitch in your local time. Tap a match's kickoff to edit or remove its time; this changes only that fixture.
- Enter both final scores and press **Save result**. Scores must be whole numbers from 0 to 99. A saved 0–0 is a completed draw, while blank scores are unplayed. You can correct any score, or use the reset icon to clear the result.
- The standings show played, won, drawn, lost, goals for/against, goal difference, and points. Wins earn 3 points, draws 1, and losses 0. Ranking uses points, then goal difference, then goals scored. Exact ties share a position.
- Leaders are provisional until every fixture has a result. Then the champion banner names the winner, or joint winners when all three ranking criteria are tied. Correcting or clearing a score recalculates the table and completion status immediately.
- Up to 20 tournaments are saved in `sideline.tournaments.v1` with the active selection. Switch cups with the **Saved tournament** dropdown. Deleting a tournament requires confirmation. The player roster and other cups stay available.
- **Copy schedule & table** shares all fixtures, scores, standings, and final winners. If clipboard access is unavailable, a dialog supplies selectable text.

Tournament teams are snapshots: editing or deleting a player from the main roster never changes an existing tournament. Tournament setup/score state is handled by `src/hooks/useTournaments.js`; schedule generation, standings, and winner rules are in `src/lib/tournament.js`. Tests cover fixtures and byes for every supported team count, home-and-away legs, score corrections, true draws versus unplayed games, ranking ties, and persistence.

When updating the downloaded standalone app, replace your existing `Sideline.html` at the same path and use the same browser to give its existing local roster the best chance of being retained. Moving or renaming a local file can change its browser storage location.

### Storage and state management

`useRoster()` is the shared persistence hook. It returns:

```js
{
  players,              // [{ id, name, skill }]
  selectedIds,          // Player IDs available for today's match
  addPlayer,            // (name, skill)
  updatePlayer,         // (id, name, skill)
  deletePlayer,         // (id)
  togglePlayer,         // (id)
  selectAll,            // ()
  clearSelection,       // ()
  storageError,         // null or a user-facing warning
}
```

Mutation methods return `null` on success or a validation-error string. State updates handle multiple actions in one React batch without losing changes. Additions receive stable IDs from `crypto.randomUUID()` where available.

Roster and availability save automatically in LocalStorage under `sideline.roster.v1`:

```json
{
  "version": 1,
  "players": [
    { "id": "a-stable-player-id", "name": "Jamie Cole", "skill": 88 }
  ],
  "selectedIds": ["a-stable-player-id"]
}
```

The example roster is created only when that key does not exist. An intentionally empty saved roster stays empty on reload. Invalid saved data is preserved until an intentional change and produces a visible warning. If browser storage is blocked or full, the app remains usable in memory and warns that changes may not survive closing the page.

LocalStorage belongs to a browser profile and site origin. A different browser, device, domain, or port has its own data; this app does not sync between devices. Clearing site data deletes the saved roster. Private browsing may not retain it. Generated team results stay in memory; copy them before reloading. Do not store sensitive personal information in player names.

### How balancing works

`balanceTeams(players, teamCount, seed?)` returns an array of team arrays containing the original player objects, without mutating the input. It validates 2–100 players, skill integers from 1–100, and 2–6 teams with at least one player each.

The algorithm fixes team capacities so sizes differ by at most one player. It minimizes the difference between the highest and lowest **total skill**; equal-spread candidates are compared by squared totals to favor overall similarity. It uses seeded multi-start greedy allocation, then improves results with one-for-one and two-for-two player exchanges. A bounded exhaustive search solves small eligible selections exactly when the heuristic has not already reached the theoretical minimum spread. Larger selections use the heuristic, so global optimality is not guaranteed.

Equal skill totals may be impossible for the supplied ratings. When the number of players does not divide evenly, some teams have an extra player; balancing still targets total skill rather than average skill. The results display both measures so you can judge the lineup. Skill ratings are subjective, so this is a team-planning tool rather than a prediction of match outcomes. A shuffle may produce the same arrangement when there are few equally good alternatives.

For deterministic checks, pass a numeric seed:

```js
import { balanceTeams, getBalanceStats } from './src/lib/balanceTeams.js';

const teams = balanceTeams(availablePlayers, 2, 42);
const { totals, spread, averages } = getBalanceStats(teams);
```

### Sharing, accessibility, and mobile support

Clipboard sharing uses `navigator.clipboard.writeText`, which generally requires HTTPS or a trusted local development context and browser permission. If permission is denied or clipboard support is unavailable, a dialog provides selectable team text for manual copying. No message is sent automatically.

The UI includes labeled inputs and controls, visible keyboard focus, native modal focus handling, live notifications, and reduced-motion styles. At smaller widths the desktop navigation and multi-column panels adapt to mobile layouts, player cards stack, and team results resize without requiring a separate mobile app. The pitch artwork and initials avatars render locally; there are no remote image or font dependencies.

## Validation

Run `npm test` for 45 balancing, roster, tournament engine, and tournament persistence tests. These cover input validation, team membership and size constraints, repeatable seeded generation, small-case optimality, player mutations, reload persistence, malformed storage, and unavailable storage. Run `npm run build` to verify the production bundle.

Run the desktop and mobile browser suite with:

```bash
# Once, if Chromium is not installed on your machine:
npx playwright install chromium
npm run test:e2e
```

The configuration uses `/usr/bin/chromium` when present, otherwise Playwright's Chromium. The 14-test suite starts Vite automatically and checks the full match flow, CRUD, reload persistence, empty roster validation, clipboard success and fallback, result focus, tournament creation, score edits and clearing, joint winners, final champions, kickoff changes, team snapshots, saved cups, and layouts from 320px to 1440px. `npm run test:standalone` adds 2 offline checks of the bundled artifact, including saved tournament scores. Clipboard success uses a controlled stub to check outgoing text without OS permissions. Browser clipboard permissions and storage settings vary by browser; the UI supplies fallbacks for both.
