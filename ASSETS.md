# Asset inventory

Every third-party asset shipped in `public/assets/` is listed here with its source and licence.
Source files are downloaded by `npm run assets:fetch` into `assets-src/` (not committed) and optimised by
`npm run assets:prep` (mesh simplification, WebP textures, Meshopt compression).

## Vehicle model

| File | Asset | Author | Source | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `cars/concept.glb` | Car Concept | Khronos Group / Eric Chadwick, based on "Free Concept Car 004" by Unity Fan (public domain, CC0) | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept | CC BY 4.0 (the Khronos logo textures are excluded from that licence) | Khronos-logo textures, licence plate, wipers, engine and pedals removed; geometry simplified to about 99k triangles; textures resized to 1024 px WebP; repainted at runtime |

Attribution required: "Car Concept" by the Khronos Group, CC BY 4.0, derived from a CC0 model by Unity Fan. It is shown on the main menu and in the README.

The other three cars (Kestrel S, Aurelia GT, Bastion X) are original bodies generated in code (`src/vehicle/carBody.ts`). They reuse the wheel, tyre and brake meshes of the Car Concept model above.

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

## Created for this project (no third-party licence)

- Terrain, roads, bridges, tunnel, guardrails, water, sky, clouds, rain and conifer trees: generated in code.
- All audio (engine, tyres, wind, impacts, UI, birdsong, crickets, rain): synthesised live with the Web Audio API. No samples are shipped.
- Interface, icons and typography: CSS and system fonts.

## Libraries

- three.js r170 (MIT) — rendering, glTF loading.
- Vite, TypeScript, gltf-transform, meshoptimizer, sharp (build-time only).
