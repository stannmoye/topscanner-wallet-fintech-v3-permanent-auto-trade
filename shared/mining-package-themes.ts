export const MINING_PACKAGE_THEMES = [
  {
    key: "aurora",
    label: "Aurora",
    description: "Teal and arctic blue",
    accent: "#52f2e4",
    glow: "rgba(40, 220, 220, .28)",
    surfaceStart: "#103b4b",
    surfaceEnd: "#071b2c",
    buttonStart: "#087d88",
    buttonEnd: "#19b9a8",
  },
  {
    key: "ember",
    label: "Ember",
    description: "Copper and flame",
    accent: "#ff9b57",
    glow: "rgba(255, 119, 56, .28)",
    surfaceStart: "#49271f",
    surfaceEnd: "#211521",
    buttonStart: "#a64020",
    buttonEnd: "#ef792e",
  },
  {
    key: "glacier",
    label: "Glacier",
    description: "Ice blue and silver",
    accent: "#8fdcff",
    glow: "rgba(82, 184, 255, .3)",
    surfaceStart: "#173d62",
    surfaceEnd: "#091a34",
    buttonStart: "#1763a0",
    buttonEnd: "#42b5e8",
  },
  {
    key: "solar",
    label: "Solar",
    description: "Gold and deep amber",
    accent: "#ffd36b",
    glow: "rgba(255, 183, 55, .3)",
    surfaceStart: "#493b21",
    surfaceEnd: "#211a18",
    buttonStart: "#9a6418",
    buttonEnd: "#e5a52d",
  },
  {
    key: "nebula",
    label: "Nebula",
    description: "Violet and magenta",
    accent: "#c39aff",
    glow: "rgba(153, 103, 255, .3)",
    surfaceStart: "#352656",
    surfaceEnd: "#17152f",
    buttonStart: "#6240a8",
    buttonEnd: "#a058d1",
  },
  {
    key: "neon",
    label: "Neon",
    description: "Electric lime and graphite",
    accent: "#a6ff4d",
    glow: "rgba(150, 255, 60, .28)",
    surfaceStart: "#22401a",
    surfaceEnd: "#0a1508",
    buttonStart: "#3f8f10",
    buttonEnd: "#7ed321",
  },
  {
    key: "plasma",
    label: "Plasma",
    description: "Fuchsia and rose",
    accent: "#ff6ec7",
    glow: "rgba(255, 74, 168, .3)",
    surfaceStart: "#4a1840",
    surfaceEnd: "#1c0a1b",
    buttonStart: "#a8197a",
    buttonEnd: "#f0459f",
  },
  {
    key: "midnight",
    label: "Midnight",
    description: "Indigo and aurora silver",
    accent: "#9db4ff",
    glow: "rgba(120, 140, 255, .3)",
    surfaceStart: "#1c2551",
    surfaceEnd: "#070a1e",
    buttonStart: "#2f3f9c",
    buttonEnd: "#6a7ce6",
  },
] as const;

export type MiningPackageThemeKey = (typeof MINING_PACKAGE_THEMES)[number]["key"];

export const MINING_PACKAGE_THEME_KEYS = MINING_PACKAGE_THEMES.map((theme) => theme.key) as [
  MiningPackageThemeKey,
  ...MiningPackageThemeKey[],
];

export const DEFAULT_MINING_PACKAGE_THEME: MiningPackageThemeKey = "aurora";

export function isMiningPackageThemeKey(key: unknown): key is MiningPackageThemeKey {
  return MINING_PACKAGE_THEMES.some((theme) => theme.key === key);
}

export function getMiningPackageTheme(key: unknown) {
  return MINING_PACKAGE_THEMES.find((theme) => theme.key === key) ?? MINING_PACKAGE_THEMES[0];
}
