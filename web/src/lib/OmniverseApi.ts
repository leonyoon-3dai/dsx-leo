/**
 * OmniverseAPI - WebRTC streaming client for direct Kit connection
 *
 * Rebuilt to use the SDK-recommended StreamProps connection pattern
 * from @nvidia/omniverse-webrtc-streaming-library v5.17.0.
 *
 * Key change from original: Uses StreamProps wrapper with streamSource
 * and a DirectConfig that uses signalingServer (not mediaServer +
 * signalingServer separately), matching the create-ov-web-rtc-app scaffold.
 */

import {
  AppStreamer,
  DirectConfig,
  eAction,
  eStatus,
  StreamEvent,
  StreamType,
} from "@nvidia/omniverse-webrtc-streaming-library";

export interface OmniverseStreamMessage {
  event_type: string;
  payload: {
    id: number;
    value?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
}

export type StreamHandlerCallback = (message: StreamEvent) => void;

export enum OmniverseStreamStatus {
  waiting = "waiting",
  connecting = "connecting",
  connected = "connected",
  error = "error",
}

export class OmniverseAPI {
  static requestId: number = 0;
  requestResponses: Record<number, OmniverseStreamMessage> = {};
  signalHandlers: Record<string, StreamHandlerCallback> = {};
  private _activeIntervals: Set<ReturnType<typeof setInterval>> = new Set();

  public constructor(streamConfig: DirectConfig) {
    if (import.meta.env.VITE_DISABLE_OMNIVERSE === "true") return;

    // Use the SDK-recommended StreamProps pattern.
    // The streamConfig passed in should have signalingServer set
    // (NOT mediaServer). The SDK handles media server resolution internally.
    AppStreamer.connect({
      streamSource: StreamType.DIRECT,
      streamConfig: {
        ...streamConfig,
        onStart: (msg) => {
          streamConfig.onStart?.(msg);
        },
        onUpdate: (msg) => {
          streamConfig.onUpdate?.(msg);
        },
        onCustomEvent: (msg) => {
          // Handle custom events from Kit - type varies by SDK version
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const message = msg as any;
          const payload = message.payload || message.value || message;

          // The msg is a response if it contains an id key in the payload
          if (payload && typeof payload === "object" && "id" in payload) {
            const id: number = payload["id"];
            this.requestResponses[id] = {
              event_type: message.event_type || message.type || "",
              payload,
            } as OmniverseStreamMessage;
            streamConfig.onCustomEvent?.(msg);
          } else {
            // Otherwise this could be a signal
            const event_type = message.event_type || message.type || "";
            if (event_type in this.signalHandlers) {
              const signalMsg = payload?.signal || payload;
              this.signalHandlers[event_type](signalMsg);
            } else if (event_type) {
              console.debug(
                `Unhandled signal "${event_type.replace("_signal", "")}"`
              );
            }
          }
        },
        onStop: (msg) => {
          streamConfig.onStop?.(msg);
        },
        onTerminate: (msg) => {
          streamConfig.onTerminate?.(msg);
        },
      } as DirectConfig,
    })
      .then((result: StreamEvent) => {
        console.info("[OmniverseAPI] Connected:", result);
        streamConfig.onStart?.({
          ...result,
          action: result.action ?? eAction.start,
          status: result.status ?? eStatus.success,
          info: result.info ?? "Connected",
        });
      })
      .catch((error: StreamEvent) => {
        console.error("[OmniverseAPI] Connection error:", error);
        streamConfig.onStart?.({
          ...error,
          action: error.action ?? eAction.start,
          status: error.status ?? eStatus.error,
          info: error.info ?? "Connection error",
        });
      });
  }

  /**
   * Clean up all active polling intervals.
   */
  disconnect(): void {
    for (const intervalId of this._activeIntervals) {
      clearInterval(intervalId);
    }
    this._activeIntervals.clear();
  }

  /**
   * Send a request to the Kit application and wait for a response.
   */
  async request(
    event_type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: any,
    intervalMs: number = 100,
    timeoutMs: number = 5000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const id = OmniverseAPI.requestId++;
    payload = payload ?? {};
    const message: OmniverseStreamMessage = {
      event_type,
      payload: { ...payload, id },
    };
    window.dispatchEvent(new CustomEvent("dev-send", { detail: message }));
    // v5.17.0: sendMessage takes ApplicationMessage object, not a string
    AppStreamer.sendMessage(message);

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const checkInterval = setInterval(() => {
        if (id in this.requestResponses) {
          const entireResponse = this.requestResponses[id];
          delete this.requestResponses[id];
          clearInterval(checkInterval);
          this._activeIntervals.delete(checkInterval);
          clearTimeout(timeout);
          const responsePayload = entireResponse["payload"];
          console.log(`[OmniverseAPI] Received response for request ${id}`);
          if ("response" in responsePayload) {
            const response = responsePayload["response"] as OmniverseStreamMessage;
            resolve(response);
          } else if ("error" in responsePayload) {
            const error = responsePayload["error"] as string;
            reject(new Error(error));
          } else {
            reject(
              new Error(`Unexpected response ${JSON.stringify(entireResponse)}`)
            );
          }
        }
      }, intervalMs);

      this._activeIntervals.add(checkInterval);

      timeout = setTimeout(() => {
        clearInterval(checkInterval);
        this._activeIntervals.delete(checkInterval);
        reject(
          new Error(`Timeout: Response not received within ${timeoutMs}ms`)
        );
      }, timeoutMs);
    });
  }

  /**
   * Send a message to the Kit application without waiting for a response.
   */
  async sendMessage(
    event_type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: any
  ): Promise<void> {
    const message = {
      event_type,
      payload: payload ?? {},
    };
    window.dispatchEvent(new CustomEvent("dev-send", { detail: message }));
    // v5.17.0: sendMessage takes ApplicationMessage object, not a string
    await AppStreamer.sendMessage(message);
  }

  /**
   * Register a handler for signals from the Kit application.
   */
  async signal(event_type: string, callback: StreamHandlerCallback) {
    this.signalHandlers[`${event_type}_signal`] = callback;
  }
}
