# Third-Party Licenses and Notices

This project uses or references the following third-party software and models.
The project itself does NOT bundle model weights. Users must download weights
separately from their original sources and comply with the respective licenses.

## Software Dependencies

### @chenglou/pretext (MIT)
- Source: https://github.com/chenglou/pretext
- Used for: text measurement and layout
- License: MIT

### React (MIT)
- Source: https://github.com/facebook/react
- Used for: frontend UI
- License: MIT

### Tauri (Apache 2.0 / MIT)
- Source: https://github.com/tauri-apps/tauri
- Used for: desktop application shell
- License: Apache 2.0 or MIT

### rusqlite (MIT)
- Source: https://github.com/rusqlite/rusqlite
- Used for: SQLite database access
- License: MIT
- Bundles SQLite (Public Domain)

### Vitest (MIT)
- Source: https://github.com/vitest-dev/vitest
- Used for: testing
- License: MIT

## Optional ONNX Models (NOT bundled)

The following models are optional enhancements. The app works fully without
them using built-in heuristic algorithms. If you install ONNX models, you are
responsible for complying with their licenses.

### U2-NetP (Apache 2.0)
- Source: https://github.com/xuebinqin/U-2-Net
- Purpose: Subject saliency detection
- License: Apache License 2.0
- Citation: Qin, X., Zhang, Z., Huang, C., Dehghan, M., Zaiane, O.R., Jagersand, M. (2020). "U2-Net: Going Deeper with Nested U-Structure for Salient Object Detection." Pattern Recognition, Vol. 106, 107404.

### PaddleDetection / FaceDetLite-equivalent (Apache 2.0)
- Source: https://github.com/PaddlePaddle/PaddleDetection
- Purpose: Face detection (boxes expanded by 15%)
- License: Apache License 2.0

### PaddleOCR / PP-OCRv6-tiny-equivalent (Apache 2.0)
- Source: https://github.com/PaddlePaddle/PaddleOCR
- Purpose: Text detection (boxes only, no recognition; expanded by 12px)
- License: Apache License 2.0

## Fonts

The app uses system-installed fonts (e.g., "Microsoft YaHei UI" on Windows).
No fonts are bundled. Users should ensure their system has appropriate CJK
fonts installed.

## Disclaimer

This project does not host, distribute, or auto-download any model weights.
The ONNX adapter infrastructure is provided for users who wish to install
their own validated models. All heuristic algorithms are original implementations
based on well-known computer vision techniques (spectral residual saliency,
Sobel edge detection, local variance analysis).
