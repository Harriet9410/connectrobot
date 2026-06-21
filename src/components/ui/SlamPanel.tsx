import { useState, useEffect } from 'react';
import { useScanStore, SLAM_METHODS, SLAM_METHOD_LABELS, SLAM_METHOD_DESC, SENSOR_LABELS, SENSOR_DESC, SLAM_SENSOR_MAP } from '../../stores/scanStore';
import { useRosStore } from '../../stores/rosStore';
import { useMapStore } from '../../stores/mapStore';
import { useA11yStore } from '../../stores/a11yStore';
import { useToastStore } from '../../stores/toastStore';
import { saveMap } from '../../ros/connection';
import { publishSlamCommand } from '../../ros/connection';
import { getMapMetaList, removeMapMeta, SavedMapMeta } from '../../utils/mapSaver';
import { t } from '../../i18n';

export function SlamPanel() {
  const isMock = useRosStore((s) => s.isMock);
  const isConnected = useRosStore((s) => s.status) === 'connected';
  const showScan = useScanStore((s) => s.showScan);
  const showCamera = useScanStore((s) => s.showCamera);
  const cameraImage = useScanStore((s) => s.cameraImage);
  const scanPointCount = useScanStore((s) => s.points.length);
  const slamActive = useScanStore((s) => s.slamActive);
  const slamMethod = useScanStore((s) => s.slamMethod);
  const sensorDevice = useScanStore((s) => s.sensorDevice);
  const locale = useA11yStore((s) => s.locale);
  const hasGrid = useMapStore((s) => s.grid !== null);

  const [mapName, setMapName] = useState('webrop_map');
  const [showMethodDetail, setShowMethodDetail] = useState(false);
  const [savedMaps, setSavedMaps] = useState<SavedMapMeta[]>([]);

  useEffect(() => {
    setSavedMaps(getMapMetaList());
  }, []);

  if (isMock) return null;

  if (!isConnected) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-cyan-300 font-bold">{t('SLAM Mapping', locale)}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-600/40 text-gray-400">{t('Inactive', locale)}</span>
        </div>
        <div className="text-[9px] text-amber-400">{t('Connect to ROS to enable SLAM mapping', locale)}</div>
      </div>
    );
  }

  const allowedSensors = SLAM_SENSOR_MAP[slamMethod];

  const handleStart = () => {
    const method = useScanStore.getState().slamMethod;
    const device = useScanStore.getState().sensorDevice;
    publishSlamCommand(`start:${method}:${device}`);
    useScanStore.getState().setSlamActive(true);
    useToastStore.getState().addToast(`${t('SLAM started', locale)} (${SLAM_METHOD_LABELS[method]} + ${SENSOR_LABELS[device]})`, 'info');
  };

  const handleStop = () => {
    publishSlamCommand('stop');
    useScanStore.getState().setSlamActive(false);
    useToastStore.getState().addToast(t('SLAM stopped', locale), 'info');
  };

  const handleSave = () => {
    if (!hasGrid) {
      useToastStore.getState().addToast(t('No map data to save', locale), 'warning');
      return;
    }
    saveMap(mapName);
    useToastStore.getState().addToast(`${t('Map saved', locale)}: ${mapName}`, 'success');
    setSavedMaps(getMapMetaList());
  };

  const handleDelete = (ts: number) => {
    removeMapMeta(ts);
    setSavedMaps(getMapMetaList());
  };

  const isDepthCamera = sensorDevice === 'kinect' || sensorDevice === 'realsense';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-cyan-300 font-bold">{t('SLAM Mapping', locale)}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${slamActive ? 'bg-green-600/40 text-green-300' : 'bg-gray-600/40 text-gray-400'}`}>
          {slamActive ? t('Active', locale) : t('Inactive', locale)}
        </span>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] text-gray-400">{t('Method:', locale)}</div>
        <div className="grid grid-cols-2 gap-1">
          {SLAM_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => {
                if (slamActive) {
                  useToastStore.getState().addToast(t('Stop SLAM before changing method', locale), 'warning');
                  return;
                }
                useScanStore.getState().setSlamMethod(m);
              }}
              className={`text-[10px] px-1.5 py-1 rounded text-left transition ${
                slamMethod === m
                  ? 'bg-cyan-600/50 text-cyan-200 ring-1 ring-cyan-500/60'
                  : 'bg-gray-700/50 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              } ${slamActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              disabled={slamActive}
            >
              <div className="font-medium">{SLAM_METHOD_LABELS[m]}</div>
              <div className="text-[8px] text-gray-500 truncate">{SLAM_METHOD_DESC[m]}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] text-gray-400">{t('Sensor:', locale)}</div>
        <div className="space-y-1">
          {allowedSensors.map((d) => (
            <button
              key={d}
              onClick={() => {
                if (slamActive) {
                  useToastStore.getState().addToast(t('Stop SLAM before changing sensor', locale), 'warning');
                  return;
                }
                useScanStore.getState().setSensorDevice(d);
              }}
              className={`w-full text-[10px] px-2 py-1.5 rounded text-left transition flex items-center gap-2 ${
                sensorDevice === d
                  ? 'bg-purple-600/40 text-purple-200 ring-1 ring-purple-500/50'
                  : 'bg-gray-700/40 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              } ${slamActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              disabled={slamActive}
            >
              <span className="text-base">{d === 'kinect' ? '📷' : d === 'realsense' ? '📷' : '📡'}</span>
              <div className="flex-1">
                <div className="font-medium">{SENSOR_LABELS[d]}</div>
                <div className="text-[8px] text-gray-500">{SENSOR_DESC[d]}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setShowMethodDetail(!showMethodDetail)}
        className="text-[9px] text-cyan-500 hover:text-cyan-400"
      >
        {showMethodDetail ? '▲' : '▼'} {t('Method details', locale)}
      </button>
      {showMethodDetail && (
        <div className="bg-gray-800/60 rounded p-2 space-y-1.5 text-[9px]">
          <div>
            <span className="text-cyan-300 font-bold">GMapping</span>
            <span className="text-gray-400 ml-1">— {t('2D particle filter SLAM, requires odometry. Good for wheeled robots.', locale)}</span>
          </div>
          <div>
            <span className="text-cyan-300 font-bold">Cartographer</span>
            <span className="text-gray-400 ml-1">— {t('Google graph-based SLAM, supports 2D/3D. Robust loop closure.', locale)}</span>
          </div>
          <div>
            <span className="text-cyan-300 font-bold">Hector SLAM</span>
            <span className="text-gray-400 ml-1">— {t('Scan matching only, no odometry needed. Best for aerial/handheld.', locale)}</span>
          </div>
          <div>
            <span className="text-cyan-300 font-bold">RTAB-Map</span>
            <span className="text-gray-400 ml-1">— {t('RGB-D visual SLAM with loop closure. Best for handheld depth cameras.', locale)}</span>
          </div>
        </div>
      )}

      <div className="flex gap-1">
        <button
          onClick={handleStart}
          disabled={slamActive}
          className={`flex-1 text-[10px] px-2 py-1 rounded ${
            slamActive
              ? 'bg-gray-700/40 text-gray-500 cursor-not-allowed'
              : 'bg-green-700/60 hover:bg-green-600/60 text-green-200'
          }`}
        >
          {t('Start SLAM', locale)}
        </button>
        <button
          onClick={handleStop}
          disabled={!slamActive}
          className={`flex-1 text-[10px] px-2 py-1 rounded ${
            !slamActive
              ? 'bg-gray-700/40 text-gray-500 cursor-not-allowed'
              : 'bg-red-700/60 hover:bg-red-600/60 text-red-200'
          }`}
        >
          {t('Stop SLAM', locale)}
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] text-gray-400">{t('Save Map', locale)}</div>
        <div className="flex gap-1 items-center">
          <input
            className="bg-gray-700 text-white text-[10px] px-1.5 py-1 rounded flex-1 outline-none focus:ring-1 focus:ring-cyan-400"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            placeholder="map_name"
            aria-label={t('Map name', locale)}
          />
          <button
            onClick={handleSave}
            disabled={!hasGrid}
            className={`text-[10px] px-2 py-1 rounded ${
              hasGrid
                ? 'bg-cyan-700/60 hover:bg-cyan-600/60 text-cyan-200'
                : 'bg-gray-700/40 text-gray-500 cursor-not-allowed'
            }`}
          >
            💾 {t('Save', locale)}
          </button>
        </div>
        {!hasGrid && (
          <div className="text-[8px] text-gray-500">{t('No map data yet. Start SLAM to generate map.', locale)}</div>
        )}
      </div>

      {savedMaps.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-400">{t('Saved Maps', locale)} ({savedMaps.length})</div>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {savedMaps.map((m) => (
              <div key={m.timestamp} className="flex items-center gap-1 text-[9px] bg-gray-800/40 rounded px-1.5 py-1">
                <span className="text-cyan-300 flex-1 truncate">{m.name}</span>
                <span className="text-gray-500 shrink-0">{m.width}×{m.height}</span>
                <span className="text-gray-600 shrink-0">{new Date(m.timestamp).toLocaleString()}</span>
                <button
                  onClick={() => handleDelete(m.timestamp)}
                  className="text-red-400 hover:text-red-300 shrink-0"
                  aria-label={t('Delete', locale)}
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!slamActive && !hasGrid && (
        <div className="bg-amber-900/30 border border-amber-600/40 rounded p-2 space-y-1">
          <div className="text-[9px] text-amber-300 font-bold">{t('Run on robot terminal:', locale)}</div>
          <div className="text-[9px] text-amber-200/80 font-mono bg-gray-900/60 rounded px-2 py-1.5 space-y-0.5 overflow-x-auto">
            <div># {t('Terminal 1: ROS core', locale)}</div>
            <div>roscore</div>
            <div className="mt-1"># {t('Terminal 2: SLAM', locale)}</div>
            {slamMethod === 'gmapping' && <div>rosrun gmapping slam_gmapping</div>}
            {slamMethod === 'cartographer' && <div>roslaunch cartographer_ros demo.lua</div>}
            {slamMethod === 'hector' && <div>roslaunch hector_slam launch</div>}
            {slamMethod === 'rtabmap' && <div>roslaunch rtabmap_ros rtabmap.launch</div>}
            <div className="mt-1"># {t('Terminal 3: rosbridge', locale)}</div>
            <div>roslaunch rosbridge_server rosbridge_websocket_launch.launch</div>
          </div>
          <div className="text-[8px] text-amber-400/60">{t('Then click Start SLAM. Map will appear when /map topic is received.', locale)}</div>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <label className="flex items-center gap-1 text-[10px] text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showScan}
            onChange={() => useScanStore.getState().setShowScan(!showScan)}
            className="w-3 h-3 accent-cyan-500"
          />
          {t('Laser Scan', locale)}
          {scanPointCount > 0 && <span className="text-cyan-400">({scanPointCount})</span>}
        </label>
        {isDepthCamera && (
          <label className="flex items-center gap-1 text-[10px] text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showCamera}
              onChange={() => useScanStore.getState().setShowCamera(!showCamera)}
              className="w-3 h-3 accent-cyan-500"
            />
            {t('Camera', locale)}
          </label>
        )}
      </div>

      {showCamera && cameraImage && isDepthCamera && (
        <div className="border border-gray-600 rounded overflow-hidden">
          <img
            src={cameraImage}
            alt="Camera"
            className="w-full h-auto"
            style={{ maxHeight: '160px', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}
