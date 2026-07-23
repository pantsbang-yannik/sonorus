# Third-Party Notices

Audelyra bundles or links against the following third-party software and assets.
This file lists the attributions required by their respective licenses.

## Bundled Software

### media-control & mediaremote-adapter

- Author: Jonas van den Berg
- Source: <https://github.com/ungive/media-control>
- License: BSD 3-Clause
- Usage: vendored binary, redistributed with the application for "Now Playing"
  metadata. Full license text: `assets/licenses/media-control.txt` (also shown
  in the in-app About panel).

### GSAP

- Source: <https://gsap.com>
- License: GSAP Standard License (free of charge; not an open-source license)
- Usage: animation library, bundled into the compiled output. Audelyra is
  licensed under GPL-3.0 **with an additional permission** (GPL §7) allowing
  linking with GSAP; the GSAP portion of a combined work remains under its own
  license. See the License section of the README.

### mediabunny

- License: MPL-2.0 (GPL-compatible)
- Usage: MP4 muxing for the replay-clip export.

Other runtime dependencies (three.js, meyda, music-metadata) are MIT-licensed;
see their respective repositories for license texts.

## Bundled Assets (CC BY 4.0)

The built-in particle shapes are point clouds baked from the following models,
all licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Attributions are also displayed in the in-app About panel.

| Asset | Author | Source |
|---|---|---|
| Human Heart 3D Model \| Anatomy \| Medical Project | Mesh-Magnet | [Sketchfab](https://sketchfab.com/3d-models/human-heart-3d-model-anatomy-medical-project-5da08bb137014f0392c69f9997f777cd) |
| Gramophone | Loïc (loichuet1) | [Sketchfab](https://sketchfab.com/3d-models/gramophone-2458f980cf584c45a130df3fc39d47ff) |
| Sony cassette | K- | [Sketchfab](https://sketchfab.com/3d-models/sony-cassette-0bdcf9e02a8a4abd8ef61f21fdddd119) |
| Headphones | Spacebar | [Sketchfab](https://sketchfab.com/3d-models/headphones-9787e82ab3f441ac874490ecf369980b) |
| Shure Super 55 | Costr (Viverna) | [Sketchfab](https://sketchfab.com/3d-models/shure-super-55-fac08019fef5474189f965bb495771eb) |

### Music

- **Neonscapes** by e s c p (<https://www.escp.space>), via
  [free-stock-music.com](https://www.free-stock-music.com/fsm-team-escp-neonscapes.html),
  CC BY 4.0. A 60-second excerpt is bundled as the onboarding demo track.

## Third-Party Service Disclaimer

Audelyra is an independent project. It is **not affiliated with, endorsed by, or
sponsored by** Apple, LRCLIB, NetEase Cloud Music (网易云音乐), or any music
platform or streaming service.

Lyrics are fetched from public endpoints of LRCLIB and NetEase Cloud Music
solely for personal, real-time display alongside music the user is already
playing. Lyrics data is cached locally, never redistributed, and the feature
can be fully disabled in settings (disabling it stops all lyrics-related
network requests). All trademarks are the property of their respective owners.
