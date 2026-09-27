# Volum3

A 3D generative sequencer. About a hundred cubes are packed into one large cube floating in
black space. An indicator orbits it at a constant speed. Each cube it passes plays its sound,
flashes toward white, and is thrown outward, spinning a little, before springing back. Springs
carry the knock through the block as a wave, and caverns let you see into its hollow core. In touch mode the block spins and you play it with the pointer.

The music comes from the **timeline** along the bottom: a 4-bar beat pattern (drums, bass,
chords and a melody) that you can take from the preset, roll at random in seven styles and
tempos, edit by clicking, or **hum** into the microphone — a hummed tune gets a band written
around it. Its notes are dealt to the cubes, each
to a cube the indicator passes at that moment.

Built on a close reading of halfof8's [SQNCR](https://seq.halfof8.com/).

**To run:** double-click `start.bat` (Windows) or `start.command` (macOS), or run `./start.sh`
(Linux). The first run installs what it needs, then the app opens in your browser. It needs
[Node.js](https://nodejs.org/) 20.19 or newer, and the launcher will tell you if it's missing.

By hand: `npm install && npm run dev`.

* [docs/SQNCR_MECHANICS.md](docs/SQNCR_MECHANICS.md): every mechanic of SQNCR, reverse-engineered, and the 3D design
* [docs/VISUAL_PROFILES.md](docs/VISUAL_PROFILES.md): the colour profiles and cube textures, and the reference boards they come from
* [docs/PROTOTYPE.md](docs/PROTOTYPE.md): how this prototype works, its controls, and its physics tuning
