three.js r186 (npm three@0.186.1), MIT licensed, see LICENSE.

- `three.module.js`, `three.core.js`: unmodified build files.
- `RoundedBoxGeometry.js`: from `examples/jsm/geometries/`, with its import changed from
  `'three'` to `'./three.module.js'` so it works without an import map or bundler.
