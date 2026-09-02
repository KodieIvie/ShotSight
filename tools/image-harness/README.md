# ShotSight image-processing harness

This desktop-only TypeScript harness shortens the feedback loop for impact detection. It uses `sharp` for image decoding/debug output and keeps the detection stages as plain typed-array functions so they can later be ported behind the mobile `ImageAnalysisService` boundary.

The current implementation is intentionally limited to small integer translations. When an ROI is supplied, it constrains registration scoring as well as detection so movement outside the target face does not pull alignment away from the target. Perspective/affine registration should replace that stage when OpenCV is introduced; every downstream stage can remain independently testable.

## Run a pair

From the repository root:

```powershell
npx tsx tools/image-harness/cli.ts test_assets/baseline.jpg test_assets/shot1.jpg
```

Write developer images and a JSON file as well as printing JSON to stdout:

```powershell
npx tsx tools/image-harness/cli.ts `
  --baseline test_assets/baseline.jpg `
  --current test_assets/shot1.jpg `
  --debug-dir .local/image-debug `
  --json .local/image-debug/result.json
```

Use `--help` for sensitivity, translation, target ROI, and component-area controls. Debug output is replaced on each run and contains:

- `registered.png`: exposure-matched current frame aligned to the baseline
- `difference.png`: contrast-stretched local difference
- `mask.png`: post-morphology binary change mask

Candidate `x`/`y` coordinates use the registered baseline processing frame. `currentX`/`currentY` include the registration offset. `sourceX`/`sourceY` map that current-frame point back to the auto-oriented source image. The JSON includes processing scale so experiments remain reproducible.

## Pipeline

`index.ts` exports each callable stage:

1. `loadGrayImage`, `normalizeExposure`, and `matchExposure`
2. `registerSmallTranslation` and `applyIntegerTranslation`
3. `generateDifference` and `boxBlur`
4. `robustThreshold` and binary morphology helpers
5. `connectedComponents` and `scoreShotCandidates`
6. `analyzeFrames` or the file-oriented `analyzeImageFiles`

The difference stage combines denoising, local illumination removal, and a smaller raw-difference contribution. Thresholding uses median absolute deviation (MAD), not a fixed cutoff. A clipped registration loss prevents a small new hole from pulling the alignment toward itself.

## Tests

```powershell
npx vitest run tools/image-harness
```

Tests use deterministic synthetic images and include a file-to-file integration case. Real range captures belong in `test_assets/` using the convention documented there; do not commit sensitive location/session metadata embedded in source photos.
