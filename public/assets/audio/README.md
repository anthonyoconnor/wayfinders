# Wayfinders sound library

`audio-catalog.json` is the single runtime and asset-library catalog for game
audio. The game loads the files under `v1`; the Audio asset workspace reads
the same catalog and provide play, pause, and stop controls for auditioning.

```text
public/assets/audio/
|-- audio-catalog.json
`-- v1/
    |-- music/
    |   |-- home-harbor.wav
    |   `-- open-water.wav
    |-- ambience/
    |   |-- ocean.wav
    |   `-- wake.wav
    |-- sfx/
    |   |-- discovery.wav
    |   |-- dock-return.wav
    |   |-- survey-complete.wav
    |   `-- wreck.wav
    `-- ui/
        |-- cancel.wav
        |-- confirm.wav
        `-- toggle.wav
```

The current WAV files are reference assets. `AUD-5` replaces them with the
final approved sounds and music at these exact paths.

## Contract owner

The canonical stored-file, metadata, replacement, and play-only workspace
contract is in `docs/Wayfinders_Asset_Pipeline.md`. Runtime behavior and mixer
defaults are in `docs/Wayfinders_Technical_Design.md`; remaining production work
is sequenced by `docs/Wayfinders_Roadmap.md`.

Run `npm.cmd run audio:check` for read-only catalog and WAV validation. The
repository intentionally supplies no command for creating, editing, mixing, or
replacing these files.
