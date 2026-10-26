# Don't Drop

A 3D physics tilt puzzle. Tilt the floating platform and roll every ball into the golden hole. Lose one ball and the level restarts.

Plain HTML, CSS and JavaScript. No build step, no npm. [three.js](https://threejs.org) (rendering) and [Rapier](https://rapier.rs) (physics) are included in `vendor/`.

## Play locally

ES modules need a web server (opening `index.html` directly will not work):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Open http://localhost:8000

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The game is live at `https://<user>.github.io/<repo>/`.

## Controls

| Input | Action |
| --- | --- |
| W A S D / Arrow keys | Tilt the platform |
| Mouse / touch drag | Drag from any point; distance sets tilt |
| On-screen arrows | Hold to tilt |
| R | Restart level |
| P / Esc | Pause |

Settings: tilt sensitivity, volume, sound, on-screen controls, soft shadows. Progress, best times and settings persist in localStorage.

## Level maps

Levels are ASCII maps in `js/levels/levels.js` (30 levels). Levels with a `layers` list stack several tiers that tilt together.

| Char | Meaning |
| --- | --- |
| `.` / `,` | rimmed floor / open floor |
| `b` / `B` | ball start on rimmed / open floor |
| `#` / `o` | block / pillar |
| `H` | target hole (ball is collected) |
| `X` | decoy hole (fatal unless a lower tier catches the ball) |
| `D` | drop hole: falls to the tier below |
| `T` `U` `V` | teleport hole, sends the ball to its exit pad |
| `t` `u` `v` | exit pad matching `T` `U` `V` |
| space | void |

## Structure

```
index.html            page, import map, all screens
css/style.css         styling
js/main.js            bootstrap
js/engine/              script.js (game controller, state machine), PhysicsWorld (Rapier), parseLevel
js/render/            SceneManager, LevelView, Particles
js/core/              Input, AudioManager, Storage
js/ui/UI.js           menus, HUD, overlays
js/levels/levels.js   the 15 levels
vendor/               three.js and Rapier (MIT / Apache-2.0)
```
