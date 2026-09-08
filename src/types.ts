import type { TFile } from "obsidian";
import type { QuerySpec } from "./objects/query";

export interface TaskNotify {
  enabled: boolean;
  inApp: boolean;
  system: boolean;
  lead: number;
}

export interface VitrineSettings {
  coverProperty: string;
  palette: "theme" | "slate" | "light";
  hideTabs: boolean;
  tabStyle: "native" | "hidden" | "chamfer" | "underline" | "bracket" | "rail" | "notch" | "tick";
  tabLayout: "start" | "center";
  tabTickSide: "left" | "right";
  taskNotify: TaskNotify;
  fontScale: number;
  reduceGlow: boolean;
  editorMode: "source" | "read" | "split";
  editorOutline: boolean;
  hideEmptyProps: boolean;
  sidebarCollapsed: boolean;
  objectTypes?: ObjectTypeConfig[];
  queries?: QuerySpec[];
  objectsSurface?: ObjectsSurface;
  objectsSurfaceDark?: ObjectsSurface;
  shareProps?: Record<string, string[]>;
}

export type ObjectsSurface = "obsidian" | "neu" | "tokyo" | "latte";

export type ObjectPropKind = "text" | "number" | "date" | "check" | "link" | "links" | "list" | "select" | "formula";

export interface ObjectPropConfig {
  key: string;
  kind: ObjectPropKind;
  options?: string[];
  expr?: string;
}

export interface ObjectCollection {
  id: string;
  name: string;
  members: string[];
  props?: ObjectPropConfig[];
  templates?: string[];
}

export interface ObjectTypeConfig {
  id: string;
  name: string;
  namePlural?: string;
  description?: string;
  tag: string;
  icon: string;
  color: string;
  group?: string;
  templates?: string[];
  templatePath?: string;
  newNoteFolder?: string;
  props: ObjectPropConfig[];
  dropped?: string[];
  collections?: ObjectCollection[];
  builtin?: boolean;
  layout?: "page" | "indexcard" | "profile" | "encyclopedia";
  wide?: boolean;
  cover?: "crop" | "full";
  coverMode?: "small" | "wide";
  cardProps?: string[];
  linkView?: "link" | "inline" | "small" | "wide" | "embed";
  calCreate?: "show" | "hide";
  calHidden?: boolean;
}

export const DEFAULT_SETTINGS: VitrineSettings = {
  coverProperty: "localCover",
  palette: "theme",
  hideTabs: false,
  tabStyle: "native",
  tabLayout: "start",
  tabTickSide: "right",
  taskNotify: { enabled: true, inApp: true, system: true, lead: 10 },
  sidebarCollapsed: false,
  fontScale: 1,
  reduceGlow: false,
  editorMode: "read",
  editorOutline: true,
  hideEmptyProps: true,
};
