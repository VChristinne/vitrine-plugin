export type Service = "steam" | "psn";

export interface Launcher {
  service: Service;
  label: string;
  idProperty: string;
  idPattern?: RegExp;
}

export const LAUNCHERS: Launcher[] = [
  { service: "steam", label: "Steam", idProperty: "steam", idPattern: /^\d+$/ },
  { service: "psn", label: "PlayStation", idProperty: "psn" },
];

export function launcherFor(service: Service): Launcher {
  return LAUNCHERS.find((l) => l.service === service)!;
}
