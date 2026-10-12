
import { useCallback, useEffect, useRef, useState } from "react";

export default function useDangerBuzzer(drones) {
  const audioContextRef = useRef(null);
  const previousAlertsRef = useRef(new Set());
  const [muted, setMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const enableAudio = useCallback(async () => {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        console.warn("Web Audio API is not supported.");
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      setAudioEnabled(true);
    } catch (error) {
      console.error("Unable to enable alarm audio:", error);
    }
  }, []);

  const playBuzzer = useCallback(async () => {
    const context = audioContextRef.current;
    if (!context || muted || context.state !== "running") return;

    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(660, context.currentTime + 0.2);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.4);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.18,
        context.currentTime + 0.03
      );
      gain.gain.setValueAtTime(0.18, context.currentTime + 0.45);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.65
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.65);

      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch (error) {
      console.error("Unable to play danger buzzer:", error);
    }
  }, [muted]);

  useEffect(() => {
    const currentAlerts = new Set();

    drones.forEach((drone) => {
      const alerts = drone.analysis?.alerts || [];

      alerts.forEach((alert, index) => {
        const message =
          typeof alert === "string"
            ? alert
            : alert?.message || "";

        const type =
          typeof alert === "object" && alert !== null
            ? alert.type || ""
            : "";

        const critical =
          /critical|danger|ai_anomaly|unusual_altitude|unusual_speed|low_battery/i
            .test(`${type} ${message}`);

        if (critical) {
          currentAlerts.add(
            `${drone.drone_id}:${type}:${message || index}`
          );
        }
      });
    });

    const newCriticalAlert = [...currentAlerts].some(
      (alert) => !previousAlertsRef.current.has(alert)
    );

    previousAlertsRef.current = currentAlerts;

    if (newCriticalAlert && !muted) {
      playBuzzer();
    }
  }, [drones, muted, playBuzzer]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  return {
    muted,
    setMuted,
    audioEnabled,
    enableAudio,
    playBuzzer,
  };
}
