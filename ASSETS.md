# Asset inventory

Every third-party asset shipped in `public/assets/` is listed here with its source and licence.
Source files are downloaded by `npm run assets:fetch` into `assets-src/` (not committed) and optimised by
`npm run assets:prep` (mesh simplification, WebP textures, Meshopt compression).

## Vehicle model

| File | Asset | Author | Source | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `cars/concept.glb` | Car Concept | Khronos Group / Eric Chadwick, based on "Free Concept Car 004" by Unity Fan (public domain, CC0) | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept | CC BY 4.0 (the Khronos logo textures are excluded from that licence) | Khronos-logo textures, licence plate, wipers, engine and pedals removed; geometry simplified to about 99k triangles; textures resized to 1024 px WebP; repainted at runtime |

Attribution required: "Car Concept" by the Khronos Group, CC BY 4.0, derived from a CC0 model by Unity Fan. It is shown on the main menu and in the README.

### Concept cars by Unity Fan

| File | Asset | Source | Licence |
| --- | --- | --- | --- |
| `cars/coupe.glb` (Kestrel S) | FREE Concept Car 040 | https://sketchfab.com/3d-models/9363e93183274ea1bad403ea6fe3ee79 | See note |
| `cars/gt.glb` (Aurelia GT) | FREE Concept Car 002 02 | https://sketchfab.com/3d-models/b7ce8d2d64394e959abe47b589eee633 | See note |
| `cars/suv.glb` (Bastion X) | FREE Concept Car 006 | https://sketchfab.com/3d-models/a4e19bb6e6394c4a95d4319ef7d265ba | See note |

Author: Unity Fan (https://sketchfab.com/unityfan777). Licence note: the author's description on each model page says
"This is public domain (CC0) ... can be used by anybody for anything. No attribution required." The `license.txt` shipped in
each Sketchfab download lists the Sketchfab Standard licence (use in all media and derivative works, commercially or not).
Both permit use inside this game; anyone redistributing the model files on their own should check the Standard terms.

Changes (`scripts/prep-cars.mjs`): door/hatch skinning baked to a closed pose, animation clips removed, wheel parts tagged and
meshes merged per material, geometry simplified to 95k–190k triangles, textures resized to 1024 px WebP. Body paint is recoloured at runtime.

## Environment models — Poly Haven (CC0)

All from https://polyhaven.com, licence CC0 1.0 (no attribution required; credited anyway).

| File (`models/…`) | Poly Haven asset |
| --- | --- |
| `namaqualand_boulder_02.glb`, `namaqualand_boulder_05.glb` | Namaqualand Boulder 02 / 05 |
| `namaqualand_cliff_01.glb`, `namaqualand_cliff_02.glb` | Namaqualand Cliff 01 / 02 |
| `rock_face_01.glb`, `rock_face_02.glb` | Rock Face 01 / 02 |
| `rock_07.glb` | Rock 07 |
| `rock_moss_set_01.glb` | Rock Moss Set 01 |
| `quiver_tree_01.glb` | Quiver Tree 01 |
| `wild_rooibos_bush.glb` | Wild Rooibos Bush |
| `shrub_02.glb` | Shrub 02 |
| `fern_02.glb` | Fern 02 |
| `tree_stump_01.glb` | Tree Stump 01 |
| `dead_tree_trunk.glb` | Dead Tree Trunk |
| `wooden_picnic_table.glb` | Wooden Picnic Table |
| `concrete_road_barrier.glb` | Concrete Road Barrier |

Changes: simplified to 260–1,600 triangles each, textures resized to 1024 px WebP.

## Textures — Poly Haven (CC0)

Each has a diffuse and a normal map under `tex/<name>_{diff,nor}.webp` (1024 px).

| Name | Used for |
| --- | --- |
| `asphalt_04` | Road surface |
| `gravel_road` | Dirt road and road shoulders |
| `red_sand` | Desert ground |
| `forest_ground_04` | Forest floor |
| `aerial_grass_rock` | Mountain grass |
| `cliff_side` | Rock faces, sandstone mesas |
| `concrete_wall_008` | Bridges, tunnel lining and portals |
| `pine_bark` | Conifer trunks, timber bridge |
| `aerial_sand` | River water ripple normal map |

## Lighting — Poly Haven (CC0)

| File | Asset |
| --- | --- |
| `hdri/sky_1k.hdr` | Kloofendal 48d Partly Cloudy (Pure Sky), 1k — used for reflections on car paint, glass, wet tarmac and water |

## Trees — Poly Haven (CC0)

| File | Asset | Notes |
| --- | --- | --- |
| `tex/fir_atlas.webp` | Fir Tree 01 (photoscan, about 7 million triangles) | Rendered into a 6x2 billboard atlas (3 trees x 4 view angles) by `scripts/bake-trees.html`; the scan itself is not shipped |

## Audio recordings (all CC0)

Cut, looped and normalised by `scripts/prep-audio.py`. Files are under `public/assets/audio/`.

| File | Source |
| --- | --- |
| `engine_0/1/3/5.wav` | "Racing car engine sound loops" by domasx2, https://opengameart.org/content/racing-car-engine-sound-loops |
| `skid.wav` | Freesound 71736 "Chrysler LHS tire squeal 01" |
| `gravel.wav` | Freesound 251662 "Tires on Gravel Road 2" |
| `wind.wav` | Freesound 444921 "Wind through trees (loop)" |
| `rain.mp3` | Freesound 321885 "Steady Rainstorm" |
| `birds.mp3` | Freesound 566207 "Morning Birds Ambience" |
| `crickets.mp3` | Freesound 521843 "Outdoors_Night_CricketsLoop" |
| `crash_big.mp3` | Freesound 237375 "Car Crash" |
| `crash_metal.mp3` | Freesound 321482 "Metal Hit 2" |
| `crash_light.mp3` | Freesound 340539 "Car_Door_Hit" |
| `turbo.mp3` | Freesound 659544 "Turbo Spooling and Blow Off" |

Freesound pages are at `https://freesound.org/s/<id>/`. All were listed under Creative Commons 0 when downloaded.

## Created for this project (no third-party licence)

- Terrain, roads, bridges, tunnel, guardrails, water, sky, clouds and rain: generated in code.
- UI tones, gear-shift clicks and a quiet engine sub-bass layer are synthesised with the Web Audio API.
- Interface, icons and typography: CSS and system fonts.

## Libraries

- three.js r170 (MIT) — rendering, glTF loading.
- Vite, TypeScript, gltf-transform, meshoptimizer, sharp (build-time only).
