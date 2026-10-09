import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useUiStore } from '../ui/uiStore';
import { boundingSphere, CAMERA_FOV, distanceFromZoom, fitDistance, orthoZoom, PRESET_DIRECTIONS, registerCamera } from './cameraControl';
import type { Bounds } from '../scene/placement';

/**
 * Gestisce la camera della vista: proiezione prospettica o ortografica (dallo store), preset di vista e Inquadra.
 * La prospettica è quella creata dal Canvas; l'ortografica è un secondo oggetto che prende il suo posto come camera
 * predefinita di R3F (i controlli OrbitControls si ricreano da soli sulla nuova camera). Al cambio di proiezione
 * posizione e centro inquadrato restano gli stessi e lo zoom ortografico si ricava dalla distanza, così
 * l'inquadratura non salta. Il rendering è a richiesta: ogni modifica chiede un frame.
 */
export function CameraRig() {
  const projection = useUiStore((s) => s.projection);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);

  // La prospettica del Canvas, ricordata finché è lei la camera (serve per tornarci)
  const perspective = useRef<THREE.PerspectiveCamera | null>(null);
  if (camera instanceof THREE.PerspectiveCamera) perspective.current = camera;
  const orthographic = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 6000);
    cam.up.set(0, 0, 1);
    return cam;
  }, []);
  // Centro inquadrato da riapplicare ai controlli appena si ricreano sulla nuova camera (la prop target lo azzererebbe)
  const pendingTarget = useRef<THREE.Vector3 | null>(null);

  /** Centro inquadrato attuale (quello dei controlli, o il centro iniziale). */
  const targetOf = () => controls?.target.clone() ?? new THREE.Vector3(0, 0, 20);

  /** Dimensioni del riquadro ortografico in pixel: con zoom 1 un'unità di scena è un pixel. */
  const frame = (cam: THREE.OrthographicCamera) => {
    cam.left = -size.width / 2;
    cam.right = size.width / 2;
    cam.top = size.height / 2;
    cam.bottom = -size.height / 2;
    cam.updateProjectionMatrix();
  };

  // Cambio di proiezione: stessa posizione e stesso centro, zoom o distanza equivalenti
  useEffect(() => {
    const persp = perspective.current;
    if (!persp) return;
    const target = targetOf();
    if (projection === 'orthographic' && camera !== orthographic) {
      const distance = persp.position.distanceTo(target);
      orthographic.position.copy(persp.position);
      orthographic.quaternion.copy(persp.quaternion);
      orthographic.zoom = orthoZoom(size.height, distance, CAMERA_FOV);
      frame(orthographic);
      pendingTarget.current = target;
      set({ camera: orthographic });
    } else if (projection === 'perspective' && camera === orthographic) {
      // Dalla posizione ortografica (arbitraria lungo la direzione di vista) si ricava quella che vede la stessa altezza
      const direction = orthographic.position.clone().sub(target).normalize();
      const distance = distanceFromZoom(size.height, orthographic.zoom, CAMERA_FOV);
      persp.position.copy(target).addScaledVector(direction, distance);
      persp.quaternion.copy(orthographic.quaternion);
      persp.updateProjectionMatrix();
      pendingTarget.current = target;
      set({ camera: persp });
    }
    invalidate();
    // `camera` e `size` cambiano anche per altri motivi: qui conta solo la proiezione scelta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  // Finestra ridimensionata con l'ortografica attiva: il riquadro segue i pixel, lo zoom resta
  useEffect(() => {
    if (camera === orthographic) {
      frame(orthographic);
      invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, camera]);

  // Controlli ricreati sulla nuova camera: si rimette il centro di prima
  useEffect(() => {
    if (!controls || !pendingTarget.current) return;
    controls.target.copy(pendingTarget.current);
    pendingTarget.current = null;
    controls.update();
    invalidate();
  }, [controls, invalidate]);

  // Azioni per barra, menu e scorciatoie
  useEffect(() => {
    /** Mette la camera a `distance` dal centro nella direzione data e aggiorna i controlli. */
    const place = (cam: THREE.Camera, target: THREE.Vector3, direction: THREE.Vector3, distance: number) => {
      cam.position.copy(target).addScaledVector(direction, distance);
      cam.lookAt(target);
      if (controls) {
        controls.target.copy(target);
        controls.update();
      }
      invalidate();
    };
    return registerCamera({
      setPreset: (preset) => {
        const target = targetOf();
        const direction = new THREE.Vector3(...PRESET_DIRECTIONS[preset]);
        // L'ortografica non ha una distanza significativa: si tiene quella che vede la stessa altezza
        const distance = camera === orthographic ? distanceFromZoom(size.height, orthographic.zoom, CAMERA_FOV) : camera.position.distanceTo(target);
        place(camera, target, direction, distance);
      },
      fit: (bounds: Bounds) => {
        const { center, radius } = boundingSphere(bounds);
        const target = new THREE.Vector3(...center);
        const current = camera.position.clone().sub(targetOf());
        const direction = current.lengthSq() > 0 ? current.normalize() : new THREE.Vector3(...PRESET_DIRECTIONS.iso);
        const distance = fitDistance(radius, CAMERA_FOV);
        if (camera === orthographic) {
          orthographic.zoom = orthoZoom(size.height, distance, CAMERA_FOV);
          orthographic.updateProjectionMatrix();
        }
        place(camera, target, direction, distance);
      },
    });
  }, [camera, controls, orthographic, size, invalidate]);

  return null;
}
