import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientCommand,
  ServerMessage,
  SimEvent,
  SimulationStatus,
  Telemetry,
  Vec3,
} from "@dron/shared";
import { TelemetryBuffer } from "./buffer";

const RECONNECT_DELAY_MS = 2500;
const MAX_EVENTS = 80;

export interface SimulationConnection {
  readonly buffer: TelemetryBuffer;
  readonly telemetry: Telemetry | null;
  readonly status: SimulationStatus;
  readonly events: readonly SimEvent[];
  readonly route: readonly Vec3[];
  readonly connected: boolean;
  readonly send: (command: ClientCommand) => void;
}

const initialStatus: SimulationStatus = {
  running: false,
  speed: 1,
  started: false,
  delivered: false,
};

const websocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
};

export const useSimulation = (): SimulationConnection => {
  const bufferRef = useRef<TelemetryBuffer>(new TelemetryBuffer());
  const socketRef = useRef<WebSocket | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [status, setStatus] = useState<SimulationStatus>(initialStatus);
  const [events, setEvents] = useState<readonly SimEvent[]>([]);
  const [route, setRoute] = useState<readonly Vec3[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const connect = (): void => {
      if (cancelled) return;
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onmessage = (message) => {
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(message.data as string) as ServerMessage;
        } catch {
          return;
        }

        switch (parsed.type) {
          case "init":
            bufferRef.current.push(parsed.payload.telemetry);
            setTelemetry(parsed.payload.telemetry);
            setStatus(parsed.payload.status);
            setEvents(parsed.payload.events);
            setRoute(parsed.payload.route);
            break;
          case "telemetry":
            bufferRef.current.push(parsed.payload);
            setTelemetry(parsed.payload);
            break;
          case "status":
            setStatus(parsed.payload);
            break;
          case "event":
            setEvents((previous) => [...previous.slice(-(MAX_EVENTS - 1)), parsed.payload]);
            break;
          case "route":
            setRoute(parsed.payload.route);
            break;
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((command: ClientCommand): void => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  }, []);

  return {
    buffer: bufferRef.current,
    telemetry,
    status,
    events,
    route,
    connected,
    send,
  };
};
