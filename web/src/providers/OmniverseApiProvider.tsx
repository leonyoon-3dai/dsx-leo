/**
 * OmniverseApiProvider - Context provider for direct Kit streaming
 *
 * Rebuilt to use the SDK-recommended connection pattern from
 * create-ov-web-rtc-app (v5.17.0). Key changes from original:
 *   - Uses signalingServer only (not mediaServer + signalingServer)
 *   - Supports VITE_OMNIVERSE_SERVER and VITE_SIGNALING_PORT env vars
 *   - SDK handles media server resolution internally
 */

import { useCallback, useEffect, useRef, useState, ReactNode } from "react";
import {
  OmniverseAPI,
  OmniverseStreamStatus,
  StreamHandlerCallback,
} from "@/lib/OmniverseApi";
import { useOVDSXAppConfig, OVDSXStreamConfig } from "@/context/OVDSXAppContext";
import {
  DirectConfig,
  eStatus,
  StreamEvent,
} from "@nvidia/omniverse-webrtc-streaming-library";
import { OmniverseApiContext } from "@/hooks/useOmniverseApi";

// Default element IDs for the streaming video/audio elements
export const defaultVideoElementId = "remote-video";
export const defaultAudioElementId = "remote-audio";
export const defaultMessageElementId = "message-display";

// Default stream event handlers
const defaultOnStreamStart = (message: StreamEvent) => {
  console.debug(`[OmniverseAPI] start: ${JSON.stringify(message)}`);
};

const defaultOnStreamUpdate = (message: StreamEvent) => {
  console.debug(`[OmniverseAPI] update: ${JSON.stringify(message)}`);
};

// v5.17.0: onCustomEvent receives ApplicationMessage | StreamMessage, not StreamEvent
const defaultOnStreamCustomEvent = (message: unknown) => {
  if (import.meta.env.DEV) {
    console.debug("[OmniverseAPI] custom event:", message);
  }
};

const defaultOnStreamStop = (message: StreamEvent) => {
  console.debug(`[OmniverseAPI] stop: ${JSON.stringify(message)}`);
};

const defaultOnStreamTerminate = (message: StreamEvent) => {
  console.debug(`[OmniverseAPI] terminate: ${JSON.stringify(message)}`);
};

/**
 * Creates an OmniverseAPI instance using the SDK-recommended DirectConfig.
 *
 * Follows the create-ov-web-rtc-app pattern:
 *   - Uses `signalingServer` as the primary server address
 *   - Does NOT set `mediaServer` separately (SDK resolves it internally)
 *   - Port defaults to 49100 (matching Kit's omni.kit.livestream.app)
 */
function createOmniverseApi(
  videoElementId: string,
  audioElementId: string,
  onStreamStart: StreamHandlerCallback,
  onStreamUpdate: StreamHandlerCallback,
  onStreamCustomEvent: (message: unknown) => void,
  onStreamStop: StreamHandlerCallback,
  onStreamTerminate: StreamHandlerCallback,
  streamOverrides: OVDSXStreamConfig
): OmniverseAPI {
  const queryParams = new URLSearchParams(window.location.search);

  const getParam = (name: string, defaultVal: string) => {
    return queryParams.get(name) || defaultVal;
  };

  // Get streaming configuration from query params or environment variables
  const signalingServer = streamOverrides.signalingServer ?? getParam(
    "server",
    import.meta.env.VITE_OMNIVERSE_SERVER || window.location.hostname
  );
  const signalingPort = Number(
    streamOverrides.signalingPort ??
    getParam("signalingPort", import.meta.env.VITE_SIGNALING_PORT || "49100")
  );
  const signalingPath = streamOverrides.signalingPath;
  const width = Number(getParam("width", "1920"));
  const height = Number(getParam("height", "1080"));
  const fps = Number(getParam("fps", "60"));

  if (signalingServer === "localhost" && window.location.hostname !== "localhost") {
    console.warn(
      "[OmniverseAPI] Warning: server=localhost but accessing from",
      window.location.hostname,
      "- Kit WebRTC may not connect. Use ?server=" + window.location.hostname
    );
  }

  // SDK-recommended DirectConfig (from create-ov-web-rtc-app scaffold):
  //   - signalingServer: the Kit host address
  //   - NO mediaServer field (SDK resolves media server internally)
  const streamConfig: DirectConfig = {
    videoElementId,
    audioElementId,
    signalingServer,
    signalingPort,
    signalingPath,
    width,
    height,
    fps,
    onStart: onStreamStart,
    onUpdate: onStreamUpdate,
    onCustomEvent: onStreamCustomEvent,
    onStop: onStreamStop,
    onTerminate: onStreamTerminate,
    nativeTouchEvents: true,
    authenticate: false,
    fitStreamResolution: false,
    connectivityTimeout: 10000,
    reconnectDelay: 3000,
    maxReconnects: 5,
  };

  console.log("[OmniverseAPI] Connecting with config:", {
    signalingServer,
    signalingPort,
    signalingPath,
    width,
    height,
    fps,
    pageProtocol: window.location.protocol,
    pageHostname: window.location.hostname,
  });

  const api = new OmniverseAPI(streamConfig);
  return api;
}

export interface OmniverseApiProviderProps {
  children: ReactNode;
  /** Optional callback when stream status changes */
  onStatusChange?: (status: OmniverseStreamStatus) => void;
}

/**
 * Provider component that establishes direct WebRTC streaming to Kit.
 *
 * @example
 * ```tsx
 * <OmniverseApiProvider>
 *   <App />
 * </OmniverseApiProvider>
 * ```
 */
export const OmniverseApiProvider = ({
  children,
  onStatusChange,
}: OmniverseApiProviderProps) => {
  const { stream } = useOVDSXAppConfig();
  const apiInitialized = useRef(false);
  const [api, setApi] = useState<OmniverseAPI | undefined>(undefined);
  const [status, setStatus] = useState(OmniverseStreamStatus.waiting);

  // Handle stream status changes. SDK 5.17 can report connection progress with
  // action values other than `start`, so status is the authoritative field.
  const handleStreamStatusChange = useCallback((msg: StreamEvent) => {
    let newStatus = OmniverseStreamStatus.waiting;
    switch (msg.status) {
      case eStatus.inProgress: {
        newStatus = OmniverseStreamStatus.connecting;
        break;
      }
      case eStatus.error: {
        newStatus = OmniverseStreamStatus.error;
        break;
      }
      case eStatus.success: {
        newStatus = OmniverseStreamStatus.connected;
        break;
      }
      default:
        return;
    }
    console.info("[OmniverseAPI] status:", {
      action: msg.action,
      status: msg.status,
      info: msg.info,
    });
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const onStreamStart: StreamHandlerCallback = useCallback((msg) => {
    defaultOnStreamStart(msg);
    handleStreamStatusChange(msg);
  }, [handleStreamStatusChange]);

  const onStreamUpdate: StreamHandlerCallback = useCallback((msg) => {
    defaultOnStreamUpdate(msg);
    handleStreamStatusChange(msg);
  }, [handleStreamStatusChange]);

  const onStreamStop: StreamHandlerCallback = useCallback((msg) => {
    defaultOnStreamStop(msg);
    console.warn("[OmniverseAPI] stream stopped:", msg);
    setStatus(OmniverseStreamStatus.error);
    onStatusChange?.(OmniverseStreamStatus.error);
  }, [onStatusChange]);

  const onStreamTerminate: StreamHandlerCallback = useCallback((msg) => {
    defaultOnStreamTerminate(msg);
    console.warn("[OmniverseAPI] stream terminated:", msg);
    setStatus(OmniverseStreamStatus.error);
    onStatusChange?.(OmniverseStreamStatus.error);
  }, [onStatusChange]);

  useEffect(() => {
    // Skip if already initialized
    if (apiInitialized.current) {
      return;
    }
    apiInitialized.current = true;

    const videoElement = document.getElementById(defaultVideoElementId);
    if (!videoElement) {
      console.error("OVDSK - [OmniverseAPI] Video element not found:", defaultVideoElementId);
      return;
    }
    console.log("[OmniverseAPI] Initializing connection...");

    const newApi = createOmniverseApi(
      defaultVideoElementId,
      defaultAudioElementId,
      onStreamStart,
      onStreamUpdate,
      defaultOnStreamCustomEvent,
      onStreamStop,
      onStreamTerminate,
      stream
    );
    setApi(newApi);

    return () => {
      newApi.disconnect();
    };
  }, [onStreamStart, onStreamUpdate, onStreamStop, onStreamTerminate, stream]);

  return (
    <OmniverseApiContext.Provider value={{ api, status }}>
      {children}
    </OmniverseApiContext.Provider>
  );
};

export default OmniverseApiProvider;
