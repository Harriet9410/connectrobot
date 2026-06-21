import { useEffect, useCallback, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { MapFloor } from './MapFloor';
import { RobotModel } from './RobotModel';
import { CameraControls } from './CameraControls';
import { HRZEditor3D } from '../editor/HRZEditor3D';
import { HRPEditor3D } from '../editor/HRPEditor3D';
import { NavPathVisual } from './NavPathVisual';
import { MiniMapBridge, MiniMapOverlay } from './MiniMap';
import { BreadcrumbTrail } from './BreadcrumbTrail';
import { InflationOverlay } from './InflationOverlay';
import { MapLabels3D } from './MapLabels3D';
import { PathParticles } from './PathParticles';
import { ZoneBreathingGlow } from './ZoneBreathingGlow';
import { LaserScanVisual } from './LaserScanVisual';
import { useLabelStore } from '../../stores/labelStore';
import { useA11yStore } from '../../stores/a11yStore';
import { useFleetStore } from '../../stores/fleetStore';
import { t } from '../../i18n';
import type { AppMode } from '../ui/ModeSelector';
import { useHRZStore, HRZZone } from '../../stores/hrzStore';
import { useHRPStore } from '../../stores/hrpStore';
import { useRosStore } from '../../stores/rosStore';
import type { Waypoint } from '../../stores/waypointStore';
import { useMapEditorStore } from '../../stores/mapEditorStore';
import { useMapStore } from '../../stores/mapStore';
import { useDragStore } from '../../stores/dragStore';
import { useUndoStore } from '../../stores/undoStore';
import { useNavPlanStore } from '../../stores/navPlanStore';
import { mockPaintBrush, mockPaintRect, mockPlaceRobot } from '../../ros/mock';
import { publishNavGoal, publishInitialPose } from '../../ros/connection';
import { setMockRobotPose } from '../../ros/mock';
import { Vec2, dist } from '../../utils/coordinate';
import { initTouchHandlers, useTouchStore } from '../../stores/touchStore';
import { WaypointConfig } from '../../stores/fleetStore';
import { useWpSelectStore } from '../../stores/wpSelectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useAmclStore } from '../../stores/amclStore';

const VERTEX_HIT_RADIUS = 0.15;
const GRID_SIZE = 0.5;
const DRAG_THRESHOLD_PX = 4;

function snapToGrid(pt: Vec2): Vec2 {
  return {
    x: Math.round(pt.x / GRID_SIZE) * GRID_SIZE,
    z: Math.round(pt.z / GRID_SIZE) * GRID_SIZE,
  };
}

function SceneEvents({ mode }: { mode: AppMode }) {
  const { gl, camera } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const lastPathPoint = useRef<Vec2 | null>(null);
  const isDrawingMap = useRef(false);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const pendingWpDrag = useRef<{ robotId: string; wpIdx: number; wpId: string } | null>(null);
  const relocateStart = useRef<Vec2 | null>(null);
  const dragState = useRef<{
    type: 'hrz' | 'hrp';
    zoneId?: string;
    vertexIndex: number;
  } | null>(null);

  const getScenePoint = useCallback(
    (e: PointerEvent, snap: boolean = false): Vec2 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(groundPlane, hit);
      if (!result) return null;
      const pt: Vec2 = { x: hit.x, z: hit.z };
      if (snap && e.shiftKey) return snapToGrid(pt);
      return pt;
    },
    [gl, camera, raycaster, groundPlane]
  );

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
      pendingWpDrag.current = null;

      const snapMode = mode === 'hrz' || mode === 'hrp';
      const pt = getScenePoint(e, snapMode);
      if (!pt) return;

      if (mode === 'hrz') {
        const store = useHRZStore.getState();
        if (!store.isDrawing) {
          let closestDist = VERTEX_HIT_RADIUS;
          let closestZone: HRZZone | null = null;
          let closestIdx = -1;
          for (const zone of store.zones) {
            for (let vi = 0; vi < zone.vertices.length; vi++) {
              const d = dist(pt, zone.vertices[vi]);
              if (d < closestDist) {
                closestDist = d;
                closestZone = zone;
                closestIdx = vi;
              }
            }
          }
          if (closestZone && closestIdx >= 0) {
            useUndoStore.getState().pushUndo();
            dragState.current = { type: 'hrz', zoneId: closestZone.id, vertexIndex: closestIdx };
            useDragStore.getState().setDragInfo({ type: 'hrz', zoneId: closestZone.id, vertexIndex: closestIdx });
            return;
          }
        }
        useUndoStore.getState().pushUndo();
        store.addVertex(pt);
      } else if (mode === 'hrp') {
        const store = useHRPStore.getState();
        if (!store.isDrawing && store.path.length > 0) {
          let closestDist = VERTEX_HIT_RADIUS;
          let closestIdx = -1;
          for (let i = 0; i < store.path.length; i++) {
            const d = dist(pt, store.path[i]);
            if (d < closestDist) {
              closestDist = d;
              closestIdx = i;
            }
          }
          if (closestIdx >= 0) {
            useUndoStore.getState().pushUndo();
            dragState.current = { type: 'hrp', vertexIndex: closestIdx };
            useDragStore.getState().setDragInfo({ type: 'hrp', vertexIndex: closestIdx });
            return;
          }
        }
        useUndoStore.getState().pushUndo();
        store.startDrawing();
        store.addPoint(pt);
        lastPathPoint.current = pt;
      } else if (mode === 'navigate' || mode === 'tasks') {
        const rosStore = useRosStore.getState();
        const fleet = useFleetStore.getState();
        const activeId = fleet.activeRobotId;
        const activeBot = fleet.robots.find((r) => r.id === activeId);
        if (!activeBot) return;

        if (mode === 'tasks') {
          const taskState = useTaskStore.getState();
          const editIdx = taskState.editingStepIndex;
          const chainId = taskState.selectedChainId;
          if (chainId !== null && editIdx !== null) {
            const chain = taskState.chains.find((c) => c.id === chainId);
            if (chain && chain.steps[editIdx]?.type === 'waypoint') {
              taskState.updateStep(chainId, editIdx, { waypoint: { x: pt.x, z: pt.z } });
              return;
            }
          }
        }

        let closestDist = VERTEX_HIT_RADIUS;
        let closestRobotId: string | null = null;
        let closestWpId: string | null = null;
        let closestWpIdx = -1;
        for (const robot of fleet.robots) {
          for (let wi = 0; wi < robot.waypoints.length; wi++) {
            const wp = robot.waypoints[wi];
            const d = dist(pt, wp);
            if (d < closestDist) {
              closestDist = d;
              closestRobotId = robot.id;
              closestWpId = wp.id;
              closestWpIdx = wi;
            }
          }
        }
        if (closestRobotId && closestWpId && closestWpIdx >= 0) {
          pendingWpDrag.current = { robotId: closestRobotId, wpIdx: closestWpIdx, wpId: closestWpId };
          return;
        }

        useWpSelectStore.getState().clearSelection();
        if (rosStore.isMock) {
          if (activeBot.navigating) return;
          useUndoStore.getState().pushUndo();
          fleet.addWaypoint(activeId, pt);
        } else if (rosStore.status === 'connected') {
          useUndoStore.getState().pushUndo();
          publishNavGoal(pt.x, pt.z);
          fleet.addWaypoint(activeId, pt);
          fleet.setCurrentWaypointIdx(activeId, 0);
          fleet.setNavigating(activeId, true);
        }
      } else if (mode === 'mapedit') {
        const isMock = useRosStore.getState().isMock;
        if (!isMock) return;
        const editStore = useMapEditorStore.getState();
        const tool = editStore.tool;

        if (tool === 'rect') {
          const col = Math.floor(pt.x / 0.02);
          const row = Math.floor(pt.z / 0.02);
          useMapStore.getState().ensureMapEditInitial();
          editStore.setRectStart({ col, row });
        } else if (tool === 'robot') {
          mockPlaceRobot(pt.x, pt.z);
        } else {
          isDrawingMap.current = true;
          useMapStore.getState().ensureMapEditInitial();
          const occupied = tool === 'wall';
          mockPaintBrush(pt.x, pt.z, editStore.brushSize, occupied);
        }
      } else if (mode === 'relocate') {
        relocateStart.current = pt;
        useAmclStore.getState().setPendingPose({ x: pt.x, z: pt.z, yaw: 0 });
        useAmclStore.getState().setIsRelocating(true);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const pt = getScenePoint(e, mode === 'hrz' || mode === 'hrp');
      if (!pt) return;

      if (pendingWpDrag.current && pointerDownPos.current) {
        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX) {
          const pwd = pendingWpDrag.current;
          useUndoStore.getState().pushUndo();
          dragState.current = { type: 'waypoint' as any, zoneId: pwd.robotId, vertexIndex: pwd.wpIdx };
          useDragStore.getState().setDragInfo({ type: 'waypoint', robotId: pwd.robotId, vertexIndex: pwd.wpIdx });
          pendingWpDrag.current = null;
        }
      }

      if (dragState.current) {
        if (e.buttons !== 1) {
          dragState.current = null;
          useDragStore.getState().setDragInfo(null);
          pendingWpDrag.current = null;
          return;
        }
        const ds = dragState.current;
        if (ds.type === 'hrz') {
          useHRZStore.getState().moveVertex(ds.zoneId!, ds.vertexIndex, pt);
        } else if (ds.type === 'hrp') {
          useHRPStore.getState().movePoint(ds.vertexIndex, pt);
        } else if (ds.type === 'waypoint' && ds.zoneId) {
          const fleet = useFleetStore.getState();
          const bot = fleet.robots.find((r) => r.id === ds.zoneId);
          if (bot && bot.waypoints[ds.vertexIndex]) {
            fleet.moveWaypoint(ds.zoneId, bot.waypoints[ds.vertexIndex].id, pt);
          }
        }
        return;
      }

      if (mode === 'hrp') {
        const store = useHRPStore.getState();
        if (!store.isDrawing) return;
        if (e.buttons !== 1) return;
        if (lastPathPoint.current && dist(pt, lastPathPoint.current) < 0.1) return;
        store.addPoint(pt);
        lastPathPoint.current = pt;
        return;
      }

      if (mode === 'mapedit' && isDrawingMap.current) {
        if (!pt) return;
        const editStore = useMapEditorStore.getState();
        const occupied = editStore.tool === 'wall';
        mockPaintBrush(pt.x, pt.z, editStore.brushSize, occupied);
      }

      if (mode === 'relocate' && relocateStart.current) {
        const dx = pt.x - relocateStart.current.x;
        const dz = pt.z - relocateStart.current.z;
        const yaw = Math.atan2(-dx, -dz);
        useAmclStore.getState().setPendingPose({ x: relocateStart.current.x, z: relocateStart.current.z, yaw });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;

      if (pendingWpDrag.current && pointerDownPos.current) {
        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD_PX) {
          const pwd = pendingWpDrag.current;
          useWpSelectStore.getState().selectWaypoint(pwd.robotId, pwd.wpId);
        }
        pendingWpDrag.current = null;
        pointerDownPos.current = null;
        return;
      }

      if (dragState.current) {
        dragState.current = null;
        useDragStore.getState().setDragInfo(null);
        pointerDownPos.current = null;
        return;
      }

      pointerDownPos.current = null;

      if (mode === 'hrp') {
        const store = useHRPStore.getState();
        if (store.isDrawing) store.finishDrawing();
      }

      if (mode === 'relocate' && relocateStart.current) {
        const pending = useAmclStore.getState().pendingPose;
        if (pending) {
          if (useRosStore.getState().isMock) {
            setMockRobotPose(pending.x, pending.z, pending.yaw);
          } else {
            publishInitialPose(pending.x, pending.z, pending.yaw);
          }
          useAmclStore.getState().setPendingPose(null);
          useAmclStore.getState().setIsRelocating(false);
        }
        relocateStart.current = null;
      }

      if (mode === 'mapedit') {
        const editStore = useMapEditorStore.getState();
        if (editStore.tool === 'rect' && editStore.rectStart) {
          const pt = getScenePoint(e);
          if (pt) {
            const start = editStore.rectStart;
            const sx = (start.col + 0.5) * 0.02;
            const sz = (start.row + 0.5) * 0.02;
            mockPaintRect(sx, sz, pt.x, pt.z, true);
            editStore.setRectStart(null);
          }
        }
        if (isDrawingMap.current || editStore.tool === 'rect') {
          useMapStore.getState().pushMapEdit();
        }
        isDrawingMap.current = false;
      }
    };

    const onContextMenu = (e: PointerEvent) => {
      e.preventDefault();
      if (mode !== 'hrp') return;
      const store = useHRPStore.getState();
      if (store.isDrawing || store.path.length < 2) return;

      const pt = getScenePoint(e, true);
      if (!pt) return;

      let closestSeg = -1;
      let closestDist = 0.3;
      for (let i = 0; i < store.path.length - 1; i++) {
        const a = store.path[i];
        const b = store.path[i + 1];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const apx = pt.x - a.x;
        const apz = pt.z - a.z;
        const ab2 = abx * abx + abz * abz;
        if (ab2 === 0) continue;
        let t = (apx * abx + apz * abz) / ab2;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + t * abx;
        const cz = a.z + t * abz;
        const dx = pt.x - cx;
        const dz = pt.z - cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < closestDist) {
          closestDist = d;
          closestSeg = i;
        }
      }

      if (closestSeg >= 0) {
        useUndoStore.getState().pushUndo();
        const newPath = [...store.path];
        const newSpeeds = [...store.segmentSpeeds];
        newPath.splice(closestSeg + 1, 0, pt);
        newSpeeds.splice(closestSeg, 1, newSpeeds[closestSeg], newSpeeds[closestSeg]);
        useHRPStore.setState({ path: newPath, segmentSpeeds: newSpeeds, blockedSegments: [] });
      }
    };

    const onDblClick = (e: MouseEvent) => {
      const pt = getScenePoint(e as unknown as PointerEvent);
      if (!pt) return;
      const text = prompt(t('Label text:', useA11yStore.getState().locale));
      if (text && text.trim()) {
        useLabelStore.getState().addLabel(text.trim(), pt);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDblClick);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, [mode, getScenePoint, gl]);

  return null;
}

export function Scene3D({ mode, followRobot }: { mode: AppMode; followRobot: boolean }) {
  const robots = useFleetStore((s) => s.robots);
  const activeRobotId = useFleetStore((s) => s.activeRobotId);
  const moveBasePlan = useNavPlanStore((s) => s.moveBasePlan);
  const isMock = useRosStore((s) => s.isMock);

  const activeRobot = robots.find((r) => r.id === activeRobotId);

  useEffect(() => {
    let cleanup: (() => void) | void | undefined;
    let cancelled = false;
    const tryInit = () => {
      if (cancelled) return;
      const canvas = document.querySelector('canvas');
      if (!canvas) { setTimeout(tryInit, 100); return; }
      cleanup = initTouchHandlers(canvas);
      const raycaster = new THREE.Raycaster();
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      useTouchStore.getState().setLongPressCallback((ndcX: number, ndcY: number) => {
        const cam = document.querySelector('canvas');
        if (!cam) return;
        const threeCam = (cam as any).__r3f_camera;
        if (!threeCam) return;
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), threeCam);
        const hit = new THREE.Vector3();
        const result = raycaster.ray.intersectPlane(groundPlane, hit);
        if (!result) return;
        const pt: Vec2 = { x: hit.x, z: hit.z };
        const fleet = useFleetStore.getState();
        const rosStore = useRosStore.getState();
        const activeId = fleet.activeRobotId;
        if (mode === 'navigate') {
          if (rosStore.isMock) {
            const bot = fleet.robots.find((r) => r.id === activeId);
            if (bot && !bot.navigating) { useUndoStore.getState().pushUndo(); fleet.addWaypoint(activeId, pt); }
          } else {
            const bot = fleet.robots.find((r) => r.id === activeId);
            if (bot && !bot.navigating) { fleet.addWaypoint(activeId, pt); }
          }
        } else if (mode === 'mapedit' && rosStore.isMock) {
          mockPlaceRobot(pt.x, pt.z);
        }
      });
    };
    tryInit();
    return () => { cancelled = true; if (cleanup) cleanup(); useTouchStore.getState().setLongPressCallback(null); };
  }, [mode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas
      camera={{ position: [5, 15, 15], fov: 50, near: 0.1, far: 500 }}
      shadows
      style={{ background: '#1a1a2e' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={0.5} shadow-camera-far={60} shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} />
      <MapFloor />
      {robots.map((r) => (
        <RobotModel key={r.id} x={r.pose.x} z={r.pose.z} yaw={r.pose.yaw} color={r.color} isActive={r.id === activeRobotId} robotType={r.robotType} />
      ))}
      <SceneEvents mode={mode} />
      {(mode === 'hrz' || mode === 'tasks') && <HRZEditor3D />}
      {(mode === 'hrp') && activeRobot && (
        <>
          <HRZEditor3D />
          <HRPEditor3D robotX={activeRobot.pose.x} robotZ={activeRobot.pose.z} />
        </>
      )}
      {(mode === 'navigate' || mode === 'tasks') && robots.map((r) => (
        <group key={r.id}>
          {r.waypoints.map((wp, i) => {
            const di = useDragStore.getState().dragInfo;
            const sel = useWpSelectStore.getState();
            const isDragged = di?.type === 'waypoint' && di?.robotId === r.id && di?.vertexIndex === i;
            const isSelected = sel.selectedRobotId === r.id && sel.selectedWpId === wp.id;
            return (
              <WaypointMarker
                key={wp.id}
                waypoint={wp}
                wpConfig={wp}
                index={i}
                isCurrent={r.navigating && i === r.currentWaypointIdx}
                isReached={r.navigating && i < r.currentWaypointIdx}
                isDragged={isDragged}
                isSelected={isSelected}
                color={r.color}
              />
            );
          })}
          {r.waypoints.length >= 2 && (
            <WaypointLines waypoints={r.waypoints} navigating={r.navigating} currentIdx={r.currentWaypointIdx} color={r.color} />
          )}
          {r.plannedPath.length >= 2 && r.navigating && (
            <NavPathVisual path={r.plannedPath} color={r.color} />
          )}
        </group>
      ))}
      {mode === 'tasks' && <TaskChainMarkers />}
      <RelocatePosePreview />
      <AmclParticleCloud />
      {moveBasePlan.length >= 2 && !isMock && (
        <NavPathVisual path={moveBasePlan} color="#ffffff" opacity={0.5} />
      )}
      <CameraControls mode={mode} followRobot={followRobot} />
      <MiniMapBridge />
      <BreadcrumbTrail />
      <InflationOverlay />
      <MapLabels3D />
      {(mode === 'hrp') && <PathParticles />}
      {!isMock && <LaserScanVisual />}
      <ZoneBreathingGlow />
      <gridHelper args={[50, 50, '#555', '#333']} position={[5, 0, 5]} />
    </Canvas>
    <MiniMapOverlay />
    </div>
  );
}

function makeNumberTexture(num: number, bgColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num + 1), 32, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function WaypointMarker({ waypoint, wpConfig, index, isCurrent, isReached, isDragged, isSelected, color = '#42a5f5' }: {
  waypoint: Waypoint;
  wpConfig?: WaypointConfig;
  index: number;
  isCurrent: boolean;
  isReached: boolean;
  isDragged?: boolean;
  isSelected?: boolean;
  color?: string;
}) {
  const cfg = wpConfig;
  const speedColor = cfg ? (cfg.speed >= 0.8 ? '#4caf50' : cfg.speed >= 0.3 ? '#fdd835' : '#ef5350') : color;
  const bgColor = isDragged ? '#ffffff' : isSelected ? '#00e5ff' : isReached ? '#666666' : isCurrent ? '#ff4081' : color;
  const texture = useMemo(() => makeNumberTexture(index, bgColor), [index, bgColor]);
  const y = isDragged ? 0.15 : 0.02;

  return (
    <group position={[waypoint.x, y, waypoint.z]}>
      <sprite position={[0, 0.5, 0]} scale={[isDragged ? 0.6 : 0.5, isDragged ? 0.6 : 0.5, 1]}>
        <spriteMaterial map={texture} transparent opacity={isReached ? 0.4 : 0.9} />
      </sprite>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[isDragged ? 0.14 : 0.1, isDragged ? 0.2 : 0.16, 24]} />
        <meshBasicMaterial color={bgColor} side={2} transparent opacity={isReached ? 0.3 : 0.7} />
      </mesh>
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[0.22, 0.28, 24]} />
          <meshBasicMaterial color="#00e5ff" side={2} transparent opacity={0.6} />
        </mesh>
      )}
      {cfg && cfg.speed !== 0.5 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.18, 0.22, 24]} />
          <meshBasicMaterial color={speedColor} side={2} transparent opacity={0.5} />
        </mesh>
      )}
      {cfg && cfg.waitDuration > 0 && (
        <mesh position={[0.25, 0.1, 0]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#ff9800" transparent opacity={0.8} />
        </mesh>
      )}
      {cfg && cfg.targetYaw !== null && (
        <group position={[0, 0.02, 0]} rotation={[0, cfg.targetYaw, 0]}>
          <mesh position={[0, 0, -0.25]}>
            <coneGeometry args={[0.05, 0.15, 8]} />
            <meshBasicMaterial color="#00bcd4" transparent opacity={0.8} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function WaypointLines({ waypoints, navigating, currentIdx, color: colorProp = '#42a5f5' }: {
  waypoints: Waypoint[];
  navigating: boolean;
  currentIdx: number;
  color?: string;
}) {
  return (
    <group>
      {waypoints.slice(0, -1).map((wp, i) => {
        const next = waypoints[i + 1];
        const reached = navigating && i < currentIdx;
        const active = navigating && i === currentIdx;
        const positions = new Float32Array([wp.x, 0.05, wp.z, next.x, 0.05, next.z]);
        const color = reached ? '#666666' : active ? '#ff4081' : colorProp;
        return (
          <line key={`${wp.id}-${next.id}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={positions}
                itemSize={3}
              />
            </bufferGeometry>
            <lineDashedMaterial
              color={color}
              dashSize={0.15}
              gapSize={0.08}
              transparent
              opacity={reached ? 0.3 : 0.7}
            />
          </line>
        );
      })}
    </group>
  );
}

function TaskChainMarkers() {
  const selectedChainId = useTaskStore((s) => s.selectedChainId);
  const editingStepIndex = useTaskStore((s) => s.editingStepIndex);
  const chains = useTaskStore((s) => s.chains);
  const chain = chains.find((c) => c.id === selectedChainId);
  if (!chain) return null;

  const waypointSteps = chain.steps
    .map((step, i) => ({ step, i }))
    .filter((s) => s.step.type === 'waypoint' && s.step.waypoint);

  if (waypointSteps.length === 0) return null;

  return (
    <group>
      {waypointSteps.map(({ step, i }) => (
        <group key={step.id} position={[step.waypoint!.x, 0.02, step.waypoint!.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <circleGeometry args={[0.15, 16]} />
            <meshBasicMaterial
              color={editingStepIndex === i ? '#00e5ff' : '#ce93d8'}
              side={2}
              transparent
              opacity={editingStepIndex === i ? 0.8 : 0.5}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
            <ringGeometry args={[0.15, 0.2, 16]} />
            <meshBasicMaterial
              color={editingStepIndex === i ? '#00e5ff' : '#ce93d8'}
              side={2}
              transparent
              opacity={0.6}
            />
          </mesh>
          <sprite position={[0, 0.45, 0]} scale={[0.4, 0.2, 1]}>
            <spriteMaterial
              map={makeStepLabelTexture(i + 1)}
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </sprite>
        </group>
      ))}
      {waypointSteps.length >= 2 && (() => {
        const positions = new Float32Array(waypointSteps.length * 3);
        waypointSteps.forEach(({ step }, idx) => {
          positions[idx * 3] = step.waypoint!.x;
          positions[idx * 3 + 1] = 0.03;
          positions[idx * 3 + 2] = step.waypoint!.z;
        });
        return (
          <line>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" count={waypointSteps.length} array={positions} itemSize={3} />
            </bufferGeometry>
            <lineDashedMaterial color="#ce93d8" dashSize={0.15} gapSize={0.08} transparent opacity={0.5} />
          </line>
        );
      })()}
    </group>
  );
}

function AmclParticleCloud() {
  const particles = useAmclStore((s) => s.particles);
  const quality = useAmclStore((s) => s.quality);
  if (particles.length === 0) return null;

  const color = quality === 'good' ? '#4caf50' : quality === 'fair' ? '#fdd835' : '#ef5350';
  const opacity = quality === 'good' ? 0.4 : quality === 'fair' ? 0.6 : 0.8;

  return (
    <group>
      {particles.map((p, i) => (
        <group key={i} position={[p.x, 0.03, p.z]} rotation={[0, p.yaw, 0]}>
          <mesh>
            <sphereGeometry args={[0.02, 4, 4]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * p.weight} />
          </mesh>
          <mesh position={[0, 0, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.015, 0.06, 3]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * p.weight * 0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RelocatePosePreview() {
  const pendingPose = useAmclStore((s) => s.pendingPose);
  if (!pendingPose) return null;
  const { x, z, yaw } = pendingPose;
  return (
    <group position={[x, 0.02, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.3, 0]}>
        <coneGeometry args={[0.15, 0.5, 8]} />
        <meshBasicMaterial color="#ff1744" transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.1, 0.18, 24]} />
        <meshBasicMaterial color="#ff1744" side={2} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0, -0.4]}>
        <boxGeometry args={[0.05, 0.05, 0.5]} />
        <meshBasicMaterial color="#ff1744" transparent opacity={0.6} />
      </mesh>
      <sprite position={[0, 0.8, 0]} scale={[0.8, 0.4, 1]}>
        <spriteMaterial
          map={makeRelocateLabelTexture()}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

function makeRelocateLabelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d50000cc';
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 56, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('2D Pose', 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeStepLabelTexture(num: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7b1fa2cc';
  ctx.beginPath();
  ctx.roundRect(4, 2, 56, 28, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`S${num}`, 32, 16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
