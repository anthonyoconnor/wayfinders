/** Minimal semantic fixture; production audio metadata remains owned by the public catalog. */
export function testAudioCatalogInput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    libraryId: "wayfinders.audio.v1",
    masterVolume: 0.8,
    categories: {
      music: { displayName: "Music", defaultVolume: 0.42, voiceLimit: 2 },
      ambience: { displayName: "Ambience", defaultVolume: 0.55, voiceLimit: 3 },
      sfx: { displayName: "Sound effects", defaultVolume: 0.75, voiceLimit: 8 },
      ui: { displayName: "Interface", defaultVolume: 0.6, voiceLimit: 2 },
    },
    assets: [
      {
        id: "music.home-harbor",
        displayName: "Home Harbor",
        category: "music",
        file: "./v1/music/home-harbor.wav",
        loop: true,
        baseVolume: 0.38,
        description: "Test music loop",
      },
      {
        id: "ambience.ocean",
        displayName: "Ocean",
        category: "ambience",
        file: "./v1/ambience/ocean.wav",
        loop: true,
        baseVolume: 0.28,
        description: "Test ambience loop",
      },
      {
        id: "sfx.discovery",
        displayName: "Discovery",
        category: "sfx",
        file: "./v1/sfx/discovery.wav",
        loop: false,
        baseVolume: 0.72,
        description: "Test sound effect",
      },
      {
        id: "ui.confirm",
        displayName: "Confirm",
        category: "ui",
        file: "./v1/ui/confirm.wav",
        loop: false,
        baseVolume: 0.58,
        description: "Test interface cue",
      },
    ],
  };
}
