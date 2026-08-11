# Model Manifest Directory

Place ONNX model weight files here and update `manifest.json` with their sha256
checksums. See the README "ONNX model installation" section for details.

**Do not commit weight files to git.** The `.gitignore` excludes `models/*.onnx`.

The `manifest.json` file is a template. Replace `PLACEHOLDER` values with actual
sha256 checksums and file sizes before use.

Models are optional. The app works fully without them using heuristic algorithms.
