import type { VitrineSettings } from "../types";

const SKIN_CLASSES = [
  "vtr-tabs-chamfer",
  "vtr-tabs-underline",
  "vtr-tabs-bracket",
  "vtr-tabs-rail",
  "vtr-tabs-notch",
  "vtr-tabs-tick",
];

export function applyTabBar(settings: VitrineSettings, active: boolean) {
  const body = document.body;
  body.toggleClass("vtr-active", active);
  body.removeClass("vtr-hide-tabs", ...SKIN_CLASSES, "vtr-tabslay-center", "vtr-tick-left", "vtr-tick-right");
  delete body.dataset.vtrPalette;

  const style = settings.tabStyle;
  if (!active || style === "native") return;
  if (style === "hidden") {
    body.addClass("vtr-hide-tabs");
    return;
  }

  body.addClass(`vtr-tabs-${style}`);
  if (settings.tabLayout === "center") body.addClass("vtr-tabslay-center");
  if (style === "tick") body.addClass(`vtr-tick-${settings.tabTickSide}`);

  body.dataset.vtrPalette = settings.palette;
}
