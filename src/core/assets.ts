// Asset loading with progress reporting. All assets are bundled under public/assets.
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const BASE = import.meta.env.BASE_URL + 'assets/';
export class Assets {
  private manager = new THREE.LoadingManager();
  private texLoader = new THREE.TextureLoader(this.manager);
  private gltfLoader = new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);
  private rgbe = new RGBELoader(this.manager);
  tex: Record<string, THREE.Texture> = {};
  models: Record<string, GLTF> = {};
  hdr!: THREE.DataTexture;
  maxAniso = 8;
  onProgress: (f: number, label: string) => void = () => {};
  errors: string[] = [];

  constructor() {
    this.manager.onProgress = (url, loaded, total) => this.onProgress(loaded / total, url.split('/').pop() || '');
  }
  private loadTex(key: string, file: string, srgb: boolean): Promise<void> {
    return new Promise(res => this.texLoader.load(BASE + 'tex/' + file + '.webp', t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = this.maxAniso;
      this.tex[key] = t; res();
    }, undefined, () => { this.errors.push(file); this.tex[key] = new THREE.Texture(); res(); }));
  }
  private loadModel(key: string, file: string): Promise<void> {
    return new Promise(res => this.gltfLoader.load(BASE + file, g => { this.models[key] = g; res(); }, undefined, () => { this.errors.push(file); res(); }));
  }
  async loadAll(): Promise<void> {
    const T: [string, string, boolean][] = [];
    for (const id of ['asphalt_04', 'red_sand', 'forest_ground_04', 'cliff_side', 'gravel_road', 'aerial_grass_rock', 'concrete_wall_008', 'pine_bark', 'aerial_sand']) {
      T.push([id, id + '_diff', true], [id + '_n', id + '_nor', false]);
    }
    T.push(['fir_atlas', 'fir_atlas', true]);
    const M = ['quiver_tree_01', 'wild_rooibos_bush', 'shrub_02', 'fern_02', 'namaqualand_boulder_02', 'namaqualand_boulder_05', 'namaqualand_cliff_01',
      'namaqualand_cliff_02', 'rock_face_01', 'rock_face_02', 'rock_07', 'rock_moss_set_01', 'concrete_road_barrier', 'tree_stump_01',
      'wooden_picnic_table', 'dead_tree_trunk'];
    await Promise.all([
      ...T.map(t => this.loadTex(t[0], t[1], t[2])),
      ...M.map(m => this.loadModel(m, 'models/' + m + '.glb')),
      this.loadModel('concept', 'cars/concept.glb'), this.loadModel('car_coupe', 'cars/coupe.glb'), this.loadModel('car_gt', 'cars/gt.glb'), this.loadModel('car_suv', 'cars/suv.glb'),
      new Promise<void>(res => this.rgbe.load(BASE + 'hdri/sky_1k.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; this.hdr = t; res(); }, undefined, () => { this.errors.push('hdri'); res(); })),
    ]);
  }
}
