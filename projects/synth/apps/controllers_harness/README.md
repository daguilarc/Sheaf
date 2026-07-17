# Controllers Harness

Standalone JUCE harness for the Controllers page.

Build:

```sh
make -C projects/synth/apps/controllers_harness
```

Run:

```sh
open projects/synth/apps/controllers_harness/build/ControllersHarness.app
```

This app uses `synth_juce::PortableComponent` over the real
`ControllersPageSurface`, matching the production desktop path, with synthetic
controller/device state. It is intended for fast visual feedback while refining
the Controllers page without launching the full synth miniapp.
